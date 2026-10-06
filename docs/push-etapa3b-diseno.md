# Notificaciones push — diseño de los avisos "hábito asignado" y "resultado de la validación"

**Estado (2026-10-06): implementado; prueba manual con dos dispositivos
superada el 2026-10-02** (`manual-testing.md`, bloque 3c). Decisiones de Luis: relleno de las 2 asignaciones existentes
(sí), hueco del resumen hasta la etapa del cron (aceptado), un solo fichero
SQL (`sql/2026-10-02c_push_events_asignado_resultado.sql`, ensayado con
`sql-ensayo.sh` y aplicado con `sql-aplica.sh`). Función `push-events`
reorganizada con un envío común y desplegada; Fase 11 ampliada a 45 tests.
Al implementarlo, el orden real fue: desplegar la función (sin cambios para
"pendiente de validar", Fase 11 30/30) → ensayo → aplicación → tests 9-10:
las llamadas directas de los tipos nuevos necesitan sus funciones SQL, que
iban en el mismo fichero que los triggers.

Texto original del diseño: Continúa la etapa 3 (`push-etapa3-diseno.md`, ya
aplicada para "pendiente de validar") con los otros dos avisos por evento.
El recordatorio diario (`pg_cron`) queda para una etapa aparte, al final.

**Misma arquitectura que "pendiente de validar":**
1. Una función SQL de destinatarios, solo `service_role`, con la barrera de
   empresa (el destinatario y el hábito, de la misma empresa).
2. Un trigger `AFTER INSERT` que lee `push_webhook_secret` de Vault y llama
   con `pg_net` a la misma Edge Function `push-events`. Si falla algo, solo
   deja un `WARNING`: nunca bloquea la escritura.
3. `push-events` ampliada con dos tipos nuevos, compartiendo el envío
   (`notification_log` → `push_deliveries` → Expo → tickets).
4. La deduplicación, con los índices únicos parciales de `notification_log`
   que ya existen desde la etapa 1.

Comprobado en la base el 2026-10-02 (solo lectura):

- **`habit_assignments` y `habit_validations` solo admiten INSERT desde los
  clientes.** No hay policies de UPDATE en ninguna de las dos, ni de DELETE en
  `habit_validations`. **Un voto, una vez emitido, no cambia.**
- `habit_validations` tiene `UNIQUE (habit_log_id, validator_id)`, un voto
  por persona y log, y su policy de INSERT exige ser validador del hábito, o
  admin si el hábito no tiene ninguno, de la misma empresa.
- Hay **2 asignaciones reales** (de 2 hábitos) y **0** filas `habit_assigned`
  en `notification_log`.

---

## 1. "Hábito asignado" (`habit_assigned`)

**Evento:** solo `AFTER INSERT ON habit_assignments FOR EACH ROW`. No existe
UPDATE: una "reasignación" siempre es borrar e insertar.

**Al editar un hábito se reinsertan todas las asignaciones.** AdminScreen y
la web borran todas las filas de `habit_assignments` y `habit_validators` del
hábito y vuelven a insertar las nuevas. Así que cada edición dispara el
trigger una vez por asignado, también para quien ya lo estaba. Se evita
reavisar así:

- La función inserta el aviso en `notification_log` y se apoya en
  `notification_log_assigned_uniq (recipient_id, habit_id) WHERE type =
  'habit_assigned'`. Si ya existe (error `23505`), esa persona **ya fue
  avisada de ese hábito** y no se le envía nada. Es el mismo mecanismo que
  "pendiente de validar".
- Al editar, a los que ya estaban no les llega nada y a los nuevos sí.
- **Trampa: las asignaciones anteriores al despliegue.** Sus asignados no
  tienen fila en `notification_log`, así que la primera edición de ese
  hábito les avisaría como si fuera nuevo. Solución: el SQL incluye un
  **relleno** (*backfill*) que crea una fila `habit_assigned` por cada
  asignación existente. Llevará `data = {"backfill": true}` y título y texto
  marcados como relleno, y no se envía nada. Hoy son 2 filas, y es una
  escritura sobre datos reales, incluida en el SQL que apruebas.
- **Consecuencia aceptada:** si a alguien se le quita un hábito y más
  adelante se le vuelve a asignar, **no** se le avisa la segunda vez, porque
  el índice es para siempre. Para distinguir ese caso de una edición haría
  falta que las pantallas guardaran solo las diferencias (ya anotado como
  opcional en el plan).

**Destinatarios:** `push_recipients_for_assignment(p_assignment_id)` devuelve
el `user_id` de la asignación, solo si:
- el hábito existe y está activo (`is_active`);
- el perfil es de la misma empresa que el hábito;
- **no es quien hizo la asignación.** El trigger manda `auth.uid()` como
  `actor_id`: es el usuario de la petición de la app, o `null` si viene de
  SQL o de la clave de servicio. Así, un admin que se asigna un hábito a sí
  mismo no recibe aviso.

**Payload del trigger:** `{type: 'habit_assigned', assignment_id, actor_id}`.
El `actor_id` es lo único que la función no puede releer de la base. Se fía
de él porque solo puede enviarlo quien conoce el secreto de Vault.

**Una carrera a tener en cuenta:** la función se ejecuta tras el commit y
relee la asignación. Si una edición la borró entretanto, no la encuentra y no
avisa (`skipped`). Si se reinsertó, el trigger de la reinserción la cubre.

**Mensaje** (por dispositivo, en su idioma):
- ES: «Nuevo hábito» / «{Admin} te ha asignado «{hábito}».»
- EN: «New habit» / «{Admin} assigned you “{habit}”.»
- Sin actor (hecho desde SQL): «Te han asignado «{hábito}».»
- `data: {type: 'habit_assigned', habit_id}`: la app ya abre Inicio con este
  tipo (probado en la etapa 2).

**Al crear un hábito con N asignados** salen N llamadas, una por fila.
Sobra con el volumen actual. Agruparlas (`FOR EACH STATEMENT` con tablas de
transición) queda como mejora si hiciera falta.

## 2. "Resultado de la validación" (`validation_result`)

**Decisión ya tomada (2026-09-30):** un único aviso **resumido** por log,
para el autor. Se envía cuando han votado todos los validadores. Los logs en
los que alguno no llega a votar se cubrirían con una pasada a las 20:00.

**Evento:** `AFTER INSERT ON habit_validations FOR EACH ROW`, es decir, cada
voto. No hace falta escuchar UPDATE ni DELETE porque los votos no cambian.

**Cómo se sabe que "ya han votado todos": no lo decide el trigger, sino la
función, en cada voto.**
- El trigger solo avisa a `push-events` con `{type: 'validation_result',
  log_id}`.
- La función, ya después del commit, llama a
  `push_validation_result_for_log(p_log_id)`, que devuelve una fila con el
  `recipient_id` (el autor), `validated_count`, `rejected_count` y `ready`.
- **Votantes esperados** = `push_recipients_for_validation(log_id)`: los
  validadores del hábito, o los admins si no tiene ninguno, sin el autor y de
  la misma empresa. Es la función de "pendiente de validar", reutilizada para
  que las dos reglas no puedan divergir.
- **`ready`** = hay al menos un votante esperado y **todos** tienen voto en
  `habit_validations` para ese log.
- Si `ready` es falso (falta alguien), no se hace nada y el siguiente voto lo
  vuelve a evaluar.
- **Barrera de empresa:** el autor tiene que ser de la empresa del hábito.

**Votos simultáneos.** Si los dos últimos validadores votan a la vez, cada
voto tiene su transacción y su llamada. Cada llamada sale después de su
propio commit, así que **al menos la segunda ve los dos votos**: no se pierde
el aviso. Si las dos los ven, el índice `notification_log_result_uniq
(log_id)` deja pasar solo una (la otra recibe `23505` y no envía).

**Resultado que se comunica.** Las pantallas actuales (HomeScreen,
HabitStatsScreen) consideran el log **validado si tiene al menos un voto
`validated`**. El aviso usa la misma regla y añade los recuentos:
- Validado: ES «Resultado de la validación» / ««{hábito}»: validado (2 a
  favor, 1 en contra).»; EN «Validation result» / «“{habit}”: validated (2
  for, 1 against).»
- Rechazado (ningún voto a favor): ««{hábito}»: no validado (2 en contra).»
  / «“{habit}”: not validated (2 against).»
- Con singular y plural según el número.
- `data: {type: 'validation_result', log_id, habit_id}`: la app ya abre
  Estadísticas de ese hábito con este tipo (probado en la etapa 2).

**Caso límite:** un admin que completa un hábito suyo sin validadores puede
votar su propio log (la policy de INSERT lo permite). Ese voto cuenta en el
resumen, pero no para `ready`, porque el autor no es votante esperado. Si es
el único admin, no hay votantes esperados y no sale ningún aviso, que es lo
correcto: no tiene sentido avisarse a uno mismo.

### Qué pasa con la pasada de las 20:00

**Depende de piezas que no existen:** `pg_cron` no está instalado, y la
pasada de las 20:00 era la del recordatorio diario (etapa 6, función
`daily-reminder`), que se ha dejado para el final.

**Propuesta para desacoplarlo e implementar ya:**
1. **Ahora:** solo el camino "han votado todos", que es completo por sí
   mismo y no necesita cron.
2. **Hueco conocido mientras no haya cron:** los logs en los que algún
   votante esperado **no vota nunca** no reciben resumen. Lo mismo pasa si
   cambian los validadores después de que hayan votado los demás, porque
   ningún voto nuevo vuelve a evaluarlo. Hoy el autor sigue viendo el
   resultado en la app, como antes. Lo documentaría en el plan y en
   `manual-testing.md`, como los demás huecos.
3. **En la etapa del cron, una pasada propia,** independiente del
   recordatorio:
   - una función SQL `logs_due_for_result_summary(p_min_age interval)`
     devolvería los logs con al menos un voto, sin aviso de resultado y con
     más de N horas;
   - `push-events` tendría un tipo `validation_result_sweep` que les manda el
     resumen con los votos que haya.
   - Puede ejecutarse a las 20:00 de cada usuario, junto con el recordatorio,
     o cada pocas horas. Se decide en esa etapa.
   - La deduplicación por log garantiza que el resumen nunca sale dos veces,
     ni siquiera si el último voto llega justo durante la pasada.

## 3. Cambios en `push-events`

- **Se reorganiza en un envío común,** `notify(type, avisos, data)`. Inserta
  en `notification_log` (y trata `23505` como "ya avisado"), busca los tokens
  activos, crea las filas de `push_deliveries`, envía a Expo en lotes de 100,
  guarda los tickets y desactiva los tokens `DeviceNotRegistered`.
  "Pendiente de validar" pasa a usarlo sin cambiar su comportamiento: la
  Fase 11 actual lo garantiza.
- **Tres manejadores,** uno por tipo, que solo leen datos y deciden
  destinatarios y textos: `validation_pending` (el actual), `habit_assigned`
  y `validation_result`.
- **`dry_run`** para los tres.
- **Validación de entrada:** los uuid de cada tipo. `actor_id` puede ser
  `null`.

## 4. SQL (un fichero, ya con la salvaguarda nueva)

`sql/2026-10-0X_push_events_tipos_1_3.sql`, **sin** `begin`/`commit`,
ensayado con `scripts/sql-ensayo.sh` y aplicado con `scripts/sql-aplica.sh`,
cada paso con tu aprobación:

- `push_recipients_for_assignment(uuid, uuid)` y
  `push_validation_result_for_log(uuid)`: `SECURITY DEFINER`, `STABLE`, solo
  `service_role`.
- `notify_push_habit_assigned()` y `notify_push_validation_result()`:
  funciones de trigger con el mismo patrón que
  `notify_push_validation_pending()`. Sin ejecución para clientes.
- Los triggers `habit_assignments_push_assigned` y
  `habit_validations_push_result`, los dos `AFTER INSERT FOR EACH ROW`.
- El relleno de `notification_log` para las asignaciones existentes (sección
  1).

**Orden propuesto:**
1. Desplegar la función ampliada, que sigue funcionando sin los triggers
   nuevos.
2. Probar los dos tipos con llamadas directas.
3. Aplicar el SQL con los triggers.
4. Prueba de punta a punta.

Si prefieres que los triggers vayan en un segundo fichero, como en
"pendiente de validar", se separan.

## 5. Pruebas (con datos `zztest-`, antes de aplicar a lo real)

**Ampliar la Fase 11** (los mismos montajes de empresa A/B y la misma
función):

- **Asignado:**
  - destinatarios: el asignado sí; nadie de otra empresa; un hábito inactivo
    no; el propio actor no;
  - `dry_run` con los textos ES/EN y la variante sin actor;
  - envío real con tokens falsos: un aviso y sus entregas;
  - **editar el hábito** (borrar y reinsertar las asignaciones, como
    AdminScreen) no reavisa a los que ya estaban y sí avisa a uno nuevo;
  - el relleno: una asignación anterior no se reavisa al editar;
  - de punta a punta con el trigger: el admin asigna con su cliente → un
    aviso solo para el asignado.
- **Resultado:**
  - con 2 validadores, tras el primer voto no hay aviso (`ready = false`) y
    tras el segundo hay exactamente uno, para el autor, con los recuentos
    correctos;
  - todo en contra → «no validado»;
  - un hábito sin validadores, con el voto del admin → aviso;
  - nunca a nadie de otra empresa;
  - dos llamadas para el mismo log → un solo aviso;
  - de punta a punta con el trigger: los dos validadores votan con su propio
    cliente → un único aviso para el autor.
- **Catálogo:** los dos triggers existen, son `AFTER INSERT` y sus funciones
  no son ejecutables por clientes. El test 7 (`net`) ya cubre las funciones
  nuevas.
- **Manual** (`manual-testing.md`, con dos dispositivos como en la prueba de
  "pendiente de validar"):
  - Luis asigna un hábito a Lucia → a Lucia le llega «Nuevo hábito», y al
    tocarlo se abre Inicio;
  - Luis vota el log de Lucia → a Lucia le llega el resultado, y al tocarlo
    se abren las Estadísticas del hábito.
