# Notificaciones push — diseño del recordatorio diario (tipo 4)

**Estado (2026-10-02): diseño aprobado por Luis; paso 1 de 3 hecho.**
- **Paso 1 hecho:** `sql/2026-10-02d_push_recordatorio_funciones.sql`, ensayado
  y aplicado con los scripts; `push-events` con el tipo `daily_reminder`,
  desplegada; Fase 11, test 11 (12 comprobaciones, 57/57 en total).
- **Paso 2 (2026-10-02):** ensayo de permisos de `pg_cron` — el esquema `cron`
  no da acceso a `anon`/`authenticated`/`PUBLIC` (8 operaciones bloqueadas,
  `database.md`). Aprobados por Luis: el guardarraíl (una hora simulada exige
  `user_ids` no vacío), la liberación del aviso si falla el lote entero en
  Expo (para el reintento de las 21:00) y programar la tarea **después de las
  21:59 de Madrid**, para que la primera ejecución real que pueda enviar algo
  sea el día siguiente a las 20:00. SQL: `sql/2026-10-02e_pg_cron_instalar.sql`
  y `sql/2026-10-02f_pg_cron_tareas.sql`.
- **Paso 3 (primeras ejecuciones reales y prueba manual):** pendiente.
- **Decisión de Luis sobre el punto 5:** el resumen de validaciones sin votar
  queda **fuera**, como quinta pieza aparte, hasta que se decidan cuántas
  horas esperar y a qué hora enviarlo.
- **Nota de implementación:** en los tests, los tokens falsos se registran
  después de que se procesen los avisos "hábito asignado" del montaje. Si no,
  Expo los rechaza y la función los desactiva antes de comprobar el
  recordatorio. Es la última pieza del plan
(`push-notifications-plan.md`, etapa 6). Se mantiene el patrón de las
anteriores (`push-etapa3-diseno.md`, `push-etapa3b-diseno.md`): funciones
SQL testeables, la Edge Function `push-events` ampliada, el secreto en Vault
y la deduplicación en `notification_log`.

**Decisiones ya tomadas (2026-09-30):**
- a las **20:00 hora local** de cada usuario;
- solo si le quedan hábitos pendientes **hoy**, con la misma lógica que la
  pantalla de inicio (HomeScreen);
- nada a quien ya lo completó todo;
- la zona horaria es la de cada token (`push_tokens.time_zone`).

**Comprobado el 2026-10-02 (solo lectura):**
- `pg_cron` 1.6.4 está **disponible y ya precargado** en el servidor
  (`shared_preload_libraries` lo incluye), pero **no instalado**.
- `habits.recurrence` hoy solo tiene `daily` (3 hábitos); la app maneja
  además `once`, `weekly_x` y `monthly_x`.
- Los 2 tokens activos están en `Europe/Madrid`.

```
pg_cron (cada hora, minuto 0 UTC) ─► push_cron_tick() ─pg_net─► push-events {type: 'daily_reminder'}
                                                                 │
                                    push_reminder_candidates(now) ◄┘  ¿a quién le toca ahora y le queda algo?
                                                                 │
                                    notify() común ──► notification_log (1 por usuario y día local) ──► Expo
```

---

## 1. Instalación de `pg_cron` y su protección

**Instalación** (la indicada por Supabase):

```sql
create extension pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
```

- **¿Hace falta algo de Luis en el dashboard?** En principio no.
  - La extensión ya está precargada, y `postgres` pudo crear `pg_net` de la
    misma forma.
  - El ensayo con `sql-ensayo.sh` lo confirmará antes de aplicar nada.
  - **Si el ensayo falla por permisos**, la alternativa es que Luis la active
    en Dashboard → Integrations → Cron. Sería un paso suyo, en un mensaje
    aparte y antes del mío, según la regla de `workflow.md`.
- **Desinstalar `pg_cron` borra todas sus tareas.** No es un problema, porque
  la tarea se vuelve a crear con el SQL versionado.

**Quién puede programar o modificar tareas:**
- Cada tarea se ejecuta **con el rol que la programó**, aquí `postgres`.
- `cron.job` tiene RLS en `pg_cron`: cada rol solo ve y modifica sus propias
  tareas.
- `anon` y `authenticated` no ejecutan SQL libre, y el esquema `cron` no está
  expuesto en la API (solo `public` y `graphql_public`).
- **Lo comprobaré en el ensayo, igual que con `pg_net`:** qué permisos deja
  la instalación a `anon`, `authenticated` y `PUBLIC` sobre el esquema `cron`,
  sus tablas y `cron.schedule`/`cron.unschedule`.
  - Si alguno queda concedido por nosotros, se revoca en el mismo SQL.
  - Si viene de `supabase_admin`, como pasó con `net`, se documenta como
    riesgo conocido.
  - En los dos casos, la Fase 11 amplía el test 7: la API rechaza el esquema
    `cron` y ninguna función de `public` ejecutable por clientes usa
    `cron.*`.
- **El secreto no va en la tarea.** `cron.job.command` se guarda en texto
  plano, así que la tarea solo ejecuta `select public.push_cron_tick();`.
  Esa función (`SECURITY DEFINER`, sin ejecución para clientes) lee
  `push_webhook_secret` de Vault y llama con `pg_net` a `push-events`, igual
  que los triggers.
- **Limpieza:** `cron.job_run_details` no se limpia solo. Una segunda tarea
  diaria borrará lo que tenga más de 7 días (`delete from
  cron.job_run_details where end_time < now() - interval '7 days'`), como
  recomienda Supabase. `net._http_response` ya se limpia sola a las 6 horas.

**Tareas:**

| Nombre | Programación (UTC) | Orden |
|---|---|---|
| `push-reminder-tick` | `0 * * * *` (cada hora en punto) | `select public.push_cron_tick();` |
| `cron-cleanup` | `30 3 * * *` | borrar `cron.job_run_details` de más de 7 días |

## 2. La consulta horaria: "¿a quién le toca ahora?"

En cada ejecución, `push_reminder_candidates(p_now)` calcula para cada
usuario con algún token activo:

1. **Su zona horaria:** la de su token **usado más recientemente**
   (`last_seen_at`). Si un usuario tiene el iPhone en Madrid y una tablet
   configurada en Londres, manda la del dispositivo que usó por última vez.
   El aviso se envía a **todos** sus tokens activos.
2. **Su hora local:** `p_now at time zone tz`. Le toca si la **hora local
   está entre las 20:00 y las 21:59**, es decir, `extract(hour) in (20, 21)`.
   La hora 21 es un reintento: si la ejecución de las 20 falló (la función no
   respondió, un despliegue a medias…), la de las 21 lo envía. Si la de las
   20 funcionó, la deduplicación (punto 4) bloquea el segundo. Por la
   decisión tomada, el aviso sale a las 20:00 y solo excepcionalmente a las
   21:00.
3. **Su día local:** `(p_now at time zone tz)::date`, que es la clave de la
   deduplicación.
4. **Que le quede algo:** `pending_habits_for_user(...)` > 0 (punto 3).
5. **Que aún no tenga recordatorio** ese día local en `notification_log`.

**Por qué no salta ni duplica a nadie:**
- **Zonas con medias horas** (India +5:30, Nepal +5:45): la ejecución corre
  cada hora en punto UTC y la franja local de las 20 dura 60 minutos, así que
  exactamente una ejecución cae dentro, por ejemplo a las 20:30 en India. Se
  envía a las 20:30 o 20:45 locales en vez de a las 20:00, que es aceptable.
- **Cambios de hora (DST):** se calcula con `at time zone` y la base de datos
  de zonas de Postgres, nunca con un desfase fijo. En Europa el cambio es a
  las 02:00/03:00 locales, lejos de las 20:00:
  - el día de 23 horas (marzo) y el de 25 (octubre) tienen exactamente una
    franja de 20:00 a 20:59;
  - si alguna zona repitiera la hora 20, el índice único por día local impide
    el segundo aviso;
  - si alguna zona se la saltara (ninguna lo hace a esa hora), la franja de
    las 21 lo cubriría.
- **Sin dependencia del reloj del servidor:** `pg_cron` programa en UTC, que
  no tiene cambios de hora.
- **Cambio de zona horaria entre ejecuciones** (un viaje): el día local se
  calcula con la zona de ese momento. En el peor caso, ese día recibe dos
  recordatorios (uno por cada fecha local) o ninguno. Es aceptable.

**Escala:** cada hora se recorren todos los usuarios con token activo; es el
límite ya documentado en el plan. Con el volumen actual (2 tokens) no es un
problema. Si algún día lo fuera, se filtraría en SQL por las zonas que en ese
momento están en su franja de las 20 antes de calcular los pendientes.

## 3. "Hábitos pendientes hoy" en hora local

`pending_habits_for_user(p_user_id, p_time_zone, p_now)` devuelve los
hábitos pendientes y replica HomeScreen
(`screens/HomeScreen.js`, `fetchData`):

| HomeScreen | Función SQL |
|---|---|
| Hábitos con fila en `habit_assignments` para el usuario, de **su** empresa, `is_active` | Igual: `habit_assignments` ⋈ `habits` con `company_id = profiles.company_id` e `is_active` |
| `expires_at` nulo o posterior a ahora | `expires_at is null or expires_at > p_now` |
| `once`: desaparece si tiene **algún** log | Se excluye si existe cualquier log del usuario para ese hábito |
| "Hecho hoy": algún log con `created_at >= hoy a las 00:00` (hora del teléfono) | Algún log con `created_at` en **[inicio del día local, inicio del día local siguiente)** |
| `weekly_x`: meta cumplida si los logs desde el **lunes 00:00 local** ≥ `weekly_target` (1 si es nulo) | Igual, con el lunes local: `date_trunc('week', día local)` (las semanas ISO empiezan en lunes) |
| `monthly_x`: meta cumplida si los logs del **mes local** ≥ `monthly_target` (1 si es nulo) | Igual, con `date_trunc('month', día local)` y el inicio del mes siguiente |
| Pendiente = ni hecho hoy ni meta (semanal/mensual) cumplida | Igual |
| Cuenta cualquier log, sea cual sea su estado o sus votos | Igual |

**Los límites del día se calculan en la zona del usuario y se comparan como
instantes:**

```sql
dia_local    := (p_now at time zone p_time_zone)::date;
inicio_dia   := dia_local::timestamp at time zone p_time_zone;        -- timestamptz
fin_dia      := (dia_local + 1)::timestamp at time zone p_time_zone;
-- hecho hoy:  created_at >= inicio_dia and created_at < fin_dia
```

**El índice UTC.** Ya está documentado (`database.md`, `habit_logs`) que
`habit_logs_one_per_day` usa el **día UTC**, mientras que la app cuenta
"hoy" en hora local.
- **Esta función no usa ese índice ni ninguna fecha UTC.** No hace
  `date(created_at)` ni `created_at::date`. Compara `created_at`, un
  instante, con los límites del día **local** convertidos a instantes. Un log
  a las 00:30 de Madrid (22:30 UTC del día anterior) cuenta para el día local
  correcto, igual que en HomeScreen.
- Lo mismo con la semana y el mes: se calculan sobre la fecha local y se
  convierten a instantes con la misma zona.
- **Lo que esta función no arregla:** la discrepancia del índice sigue ahí
  para **insertar** logs. Por ejemplo, un log a las 23:30 de Madrid (21:30
  UTC) y otro a la 01:00 del día siguiente (23:00 UTC del mismo día UTC) son
  días distintos para el usuario, pero el índice rechaza el segundo. Es un
  hallazgo previo e independiente del push; propongo tratarlo aparte.
- El recordatorio solo **lee**: no puede empeorarlo ni depender de él.

**Texto** (en el idioma de cada dispositivo):
- ES «Recordatorio» / «Te queda 1 hábito por completar hoy.» o «Te quedan
  {n} hábitos por completar hoy.»
- EN «Reminder» / «You have 1 habit left for today.» o «You have {n} habits
  left for today.»
- `data: {type: 'daily_reminder'}`: la app ya abre Inicio con este tipo
  (probado en la etapa 2).

## 4. Deduplicación

Igual que en los otros tres tipos:
- un aviso lógico por destinatario en `notification_log`, con
  `type = 'daily_reminder'` y `local_date` = su día local (el CHECK
  `notification_log_shape` ya la exige para este tipo);
- el índice `notification_log_reminder_uniq (recipient_id, local_date)` es la
  barrera. La función inserta con el envío común (`notify()`) y trata `23505`
  como "ya avisado": a ese usuario no se le envía.

Además, los candidatos ya excluyen a quien tiene recordatorio ese día, para
no recorrerlo de balde. La barrera de verdad es el índice: protege también
frente a dos ejecuciones simultáneas, la franja de las 21 o una llamada
manual.

## 5. ¿Entra aquí el resumen de validaciones sin votar?

**Recomendación: dejarlo fuera, como quinta pieza inmediatamente después,
reutilizando el `push_cron_tick` de esta etapa.**

- Con esta etapa el mecanismo ya existe (cron horario → `push-events`). El
  resumen sería un manejador más (`validation_result_sweep`) llamado en el
  mismo tick y su función SQL `logs_due_for_result_summary(p_min_age)`. Es
  una pieza pequeña.
- Pero necesita una decisión propia que no está tomada: cuántas horas esperar
  a que voten todos antes de enviar el resumen parcial, y si va a las 20:00
  locales del autor o en cualquier hora.
- Mantenerlo aparte deja esta etapa centrada en una sola cosa, que encima
  depende del tiempo y es más delicada de probar, con sus propios tests y su
  propia prueba real.
- Mientras tanto, el hueco sigue documentado en `manual-testing.md`.

## 6. Pruebas sin esperar a las 20:00 reales

**Mecanismo: el instante "ahora" es un parámetro.** Ninguna función decide
con `now()` por dentro:

- `pending_habits_for_user(user, tz, p_now)` y
  `push_reminder_candidates(p_now)` reciben el instante.
- `push_cron_tick()` pasa `now()`. Es lo único que usa la hora real, y no
  decide nada.
- `push-events` acepta en el cuerpo un `now` opcional, que **solo usan los
  tests** (la llamada exige el secreto), y un **`user_ids`** opcional que
  limita los candidatos a esos usuarios.

**`user_ids` es obligatorio en toda llamada de prueba.** Con un `now`
inventado, a cualquier usuario real que en ese instante estuviera en su
franja de las 20 le llegaría un recordatorio de verdad, y además le
"gastaría" el de ese día. Los tests siempre pasan solo los ids `zztest-`. El
tick de `pg_cron` nunca manda `now` ni `user_ids`.

**Ampliación de la Fase 11 (test 11):**
- **Franja horaria:** con un usuario en `Asia/Tokyo` (UTC+9),
  `p_now = 11:00 UTC` (20:00 JST) → candidato; `10:00 UTC` (19:00) → no;
  `13:00 UTC` (22:00) → no. Con `Asia/Kolkata` (UTC+5:30),
  `p_now = 15:00 UTC` (20:30 IST) → candidato.
- **Cambio de hora:** con `Europe/Madrid`, se recorren **todas las horas UTC
  de 48 h** alrededor del 25/10/2026 (fin del horario de verano) y del
  29/03/2026 (inicio). Por cada día local hay exactamente una hora en la
  franja de las 20 y una en la de las 21, con la fecha local correcta, y
  ninguna se repite ni falta.
- **Pendientes, con logs en instantes elegidos:** con un usuario en
  `America/New_York`:
  - un log a las **03:30 UTC** del día D+1 (23:30 local del día D) cuenta
    como hecho **el día D**, mientras que un cálculo con fecha UTC diría D+1.
    Es el test que demuestra que no se arrastra la discrepancia del índice;
  - `daily` con y sin log hoy;
  - `once` con log de otro día: no pendiente;
  - `weekly_x` con 2 de 3 esta semana local (pendiente) y con 3 de 3 (no),
    con un log del domingo anterior que no debe contar para la semana;
  - `monthly_x` igual, por mes;
  - hábito caducado o inactivo: no cuenta;
  - hábito de otra empresa: no cuenta.
- **Envío de punta a punta**, llamando a `push-events` con
  `{type: 'daily_reminder', now, user_ids}`:
  - el usuario con pendientes recibe **un** aviso con el recuento;
  - el que lo tiene todo hecho, ninguno;
  - una segunda llamada (la franja de las 21) no repite;
  - con tokens falsos, como en los demás tests.
- **Catálogo:** `pg_cron` instalado; las tareas `push-reminder-tick` (`0 * *
  * *`) y `cron-cleanup` existen y son de `postgres`; la tarea solo ejecuta
  `select public.push_cron_tick();`, sin el secreto en `cron.job.command`;
  `push_cron_tick` y las funciones nuevas no son ejecutables por clientes;
  el esquema `cron` no es alcanzable desde la API (test 7).
- **Lo que no se puede automatizar:** que `pg_cron` dispare a la hora real.
  Después de aplicar, Code comprobará en `cron.job_run_details` y en
  `net._http_response` las primeras ejecuciones horarias reales: cada hora,
  una ejecución y una respuesta `200`. Para usuarios que no están a las 20,
  la respuesta será `{candidates: 0}`.
- **Manual** (`manual-testing.md`): a las 20:00, con algún hábito pendiente,
  llega «Te quedan N hábitos…» y tocarlo abre Inicio. Un día con todo
  completado antes de las 20:00, no llega nada.

## 7. SQL y orden de aplicación (cada paso con aprobación)

Dos ficheros sin `begin`/`commit`, con `sql-ensayo.sh` y `sql-aplica.sh`:

1. **`…_push_reminder_funciones.sql`:** `pending_habits_for_user`,
   `push_reminder_candidates` y `push_cron_tick`, todas `SECURITY DEFINER` y
   solo `service_role`. `push_cron_tick` además no la ejecuta ningún cliente.
   No instala nada ni programa nada.
   - Después: `push-events` ampliada con `daily_reminder`, desplegada, y el
     test 11 completo **sin cron**, con `now` simulado.
2. **`…_push_reminder_cron.sql`:** instala `pg_cron` y programa las dos
   tareas.
   - El ensayo comprueba los permisos de `cron` (punto 1) antes de pedirte el
     "aplica".
   - Después: las fases 0-11, la comprobación de las primeras ejecuciones
     reales y la prueba manual de las 20:00.
