# Tests de backend — HabitApp

## 🔴 Vulnerabilidad crítica encontrada y corregida — 2026-09-17

Durante el diseño de la Fase 4 (permisos y RLS) se encontró una **escalada de
privilegios real, explotable en producción**, antes de escribir ningún test.

**Qué la causaba:** la policy `"users can update own profile"` en `profiles`
(`USING: auth.uid() = id`, `WITH CHECK: auth.uid() = id`) permite a cualquier
usuario autenticado editar su propia fila, pero **ninguna de las dos
cláusulas comprueba qué columnas cambian** — solo que sigues editando tu
propio `id`. No había ningún trigger en `profiles`, y `authenticated` (e
incluso `anon`) tenían `GRANT UPDATE` sobre la tabla completa, sin
restricción por columna. Resultado: cualquier usuario autenticado podía
ejecutar `profiles.update({ role: 'admin' })` sobre sí mismo y quedar
promocionado a admin, o `profiles.update({ company_id: <otra empresa> })` y
saltar a cualquier otra empresa sin pasar por ningún código de activación.

**Por qué pasó desapercibido en 3 rondas de auditoría RLS anteriores de esta
misma sesión:** cada fix se centró en "qué puede hacer un admin sobre OTROS
perfiles" (añadir `is_admin() AND company_id = my_company_id()` a una policy
nueva) — la policy original de "edita tu propia fila", que ya existía desde
el principio y nunca necesitó tocarse para esos fixes, se quedó exactamente
igual de abierta que siempre.

**Fix aplicado:** un trigger `BEFORE UPDATE` que bloquea el cambio de `role`
o `company_id` salvo que quien ejecuta la operación sea admin
(`is_admin()`, evaluado sobre el rol *anterior* al cambio):

```sql
create or replace function public.prevent_self_role_company_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.company_id is distinct from old.company_id)
     and not is_admin() then
    raise exception 'No tienes permisos para cambiar role o company_id';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_self_role_company_escalation();
```

**Verificado contra la base de datos real** (no solo leído el SQL) antes de
darlo por bueno, con usuarios de test desechables:
- Un usuario normal intentando `role='admin'` sobre sí mismo → rechazado, confirmado en BD que no cambió.
- Un usuario normal intentando cambiar su propio `company_id` → rechazado, confirmado en BD que no cambió.
- Un admin cambiando el `role` de OTRO miembro de su empresa (flujo real de `AdminScreen.js`/`Members.jsx`) → **sigue funcionando exactamente igual**, el trigger no lo bloquea.
- El propio admin tocando su `role`/`full_name` → **no queda bloqueado por error**, `is_admin()` se evalúa correctamente sobre su rol vigente.

**Protección permanente:** el Test 0 de `test-04-permisos.js` (ver sección 4)
existe específicamente para detectar si esta vulnerabilidad se reintroduce en
el futuro — por ejemplo, si alguien vuelve a tocar la policy de `profiles` o
elimina el trigger sin saber por qué existe.

## 1. Qué es esto y por qué existe

Scripts de test de backend que corren contra el **Supabase real de producción** —
este proyecto no tiene un entorno de desarrollo separado, así que no hay otra
base de datos contra la que probar. Están pensados para poder ejecutarse tantas
veces como haga falta, en cualquier momento, sin dejar residuos y sin tocar
nunca los datos reales de la familia que usa la app.

No usan Jest ni ningún framework de test runner: son scripts de Node planos,
ejecutados con `node tests/xxx.js`, con asserts propios (`assertEqual`/
`assertRejected` en `test-helpers.js`) que imprimen claramente qué se esperaba
y qué se obtuvo cuando algo falla. Se decidió así por simplicidad — añadir
Jest solo tendría sentido si el número de tests creciera lo bastante como para
necesitar su reporting/paralelización, y de momento no es el caso.

Prueban el comportamiento real de la aplicación llamando a las mismas RPCs de
Supabase que usa la app (`handle_new_user_registration`, `check_activation_code`,
`handle_activation_registration`, ...) y, cuando hace falta comprobar RLS,
autenticándose como un usuario de test real — nunca reinventan la lógica de
alta ni asumen cómo se comporta una política, la comprueban.

## 2. Requisitos previos

- **Node 20+** (probado en 20.20.2). Si usas Node 22+, no necesitas nada
  especial; si usas Node 20, hace falta el paquete `ws` (ver más abajo).
- `npm install` desde la raíz del repo — instala `ws` como `devDependency`,
  necesario porque `@supabase/supabase-js` requiere WebSocket nativo (solo
  disponible de forma nativa desde Node 22) para poder inicializar su cliente
  de Realtime, aunque estos tests no usen Realtime para nada. Sin `ws`,
  `require('@supabase/supabase-js')` falla al arrancar con un error explícito
  pidiendo justo esto.
- Un fichero **`.env` en la raíz del repo** (no en `tests/`) con:
  ```
  SUPABASE_SERVICE_ROLE_KEY=<la service_role key del proyecto>
  ```
  Se encuentra en el dashboard de Supabase → Project Settings → API →
  `service_role` (secret). **Nunca hardcodeada en el código, nunca commiteada**
  — `.env` está en `.gitignore` (verificado además contra todo el historial de
  git, no solo el estado actual, la primera vez que se añadió esta clave).

  **Por qué esta clave es especialmente sensible:** a diferencia de la anon key
  (pública, la misma que usa cualquier instalación de la app), la service role
  key **salta todas las políticas RLS de la base de datos** — cualquier script
  con esta clave puede leer y escribir cualquier fila de cualquier tabla, de
  cualquier usuario, sin ninguna restricción. Es exactamente lo que hace falta
  para crear/borrar usuarios reales vía la Admin API de Supabase (`auth.admin.
  createUser`/`deleteUser`, imposibles con la anon key) y para que
  `cleanupTestData()` pueda borrar en cascada sin pelearse con RLS. Si esta
  clave se filtrara, quien la tenga tendría acceso total y sin restricciones a
  todos los datos de todos los usuarios de HabitApp — de ahí la regla
  permanente de que **solo** los scripts dentro de `tests/` pueden leerla
  (nunca `lib/supabase.js`, `screens/`, ni código de la web), y de ahí que
  `cleanupTestData()` tenga su propia barrera de seguridad interna (punto 5)
  en vez de confiar únicamente en RLS, que aquí no protege nada.

## 3. Cómo ejecutar cada fase

```bash
node tests/test-01-alta.js       # Fase 1: alta de admin y de miembro
node tests/test-02-habitos.js    # Fase 2: hábitos, asignación, validadores
node tests/test-03-rachas.js     # Fase 3: rachas y recompensas
node tests/test-04-permisos.js   # Fase 4: permisos y RLS (profiles, aislamiento)
```

Cada script, en este orden:
1. Llama a `cleanupTestData()` al empezar (por si quedó algo de un run anterior
   que falló antes de llegar a su propia limpieza final).
2. Ejecuta sus tests, imprimiendo `✓`/`✗` por cada aserción según ocurre.
3. Llama a `cleanupTestData()` al terminar, dentro de un `finally` — se ejecuta
   pase lo que pase, incluso si algún test falló o lanzó una excepción.
4. Imprime un resumen final:
   ```
   == Resumen: N/M pasaron ==
   ```
   Si `N < M`, además imprime la lista de qué mensajes fallaron y termina con
   `process.exitCode = 1` (para que un CI, si algún día lo hay, detecte el
   fallo por el código de salida). Si el script entero revienta antes de
   llegar al resumen (una excepción no controlada — típicamente un error de
   conexión o un cambio de esquema no contemplado), se imprime `ERROR FATAL` y
   también sale con código 1.

## 4. Índice de fases

### Fase 1 — `test-01-alta.js` (8 tests)

Alta de admin (modo "crear grupo") y alta de miembro (modo "activar con
código"), y la condición real que decide si a un admin recién creado se le
lleva a la pestaña Familia.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 (×3 aserciones) | `handle_new_user_registration` crea `profiles.role='admin'`, `profiles.company_id` apuntando a una `companies` nueva, y esa company con `plan='familiar'` | Es el RPC de alta más usado de la app (todo signup en modo "crear grupo" pasa por aquí) — si algo lo rompe, nadie puede registrarse |
| 2 | Un admin con 0 hábitos activos cumple la condición de "necesita configurar su familia" | Réplica exacta de `HomeScreen.js:184-212` |
| 3 (×2 aserciones) | `handle_activation_registration` mete al segundo usuario en la MISMA company que el admin, con `role='usuario'` | Confirma que el flujo de invitación por código realmente une al usuario al grupo correcto y con el rol correcto (no `'user'` — ver punto 7) |
| 4a | Añadir un segundo miembro **no** apaga la condición de "necesita configurar su familia" | Contradice la intuición inicial de que la condición dependía del nº de miembros — ver punto 7 |
| 4b | Crear un hábito activo real **sí** la apaga | Es el disparador real: `HomeScreen.js` cuenta `habits` activos de la company, no miembros |

**No incluye** el test 5 originalmente previsto (`authFlags.skipNextRedirect`) — ver punto 6.

### Fase 2 — `test-02-habitos.js` (10 tests)

Hábitos, asignación (`habit_assignments`) y validadores (`habit_validators`),
centrado en el comportamiento real de sus políticas RLS — las mismas que se
endurecieron en la auditoría de seguridad de este mismo proyecto.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 (×3 aserciones) | El admin crea un hábito en su propia empresa; `is_active` queda `true` (no `NULL`) y `recurrence` tiene el default `'daily'` | `habits.is_active` **no tiene default de columna** — si un INSERT lo omite, queda `NULL`, y toda condición que compara `is_active = true` (incluida la del test 4b de la Fase 1) lo trata como inactivo sin ningún error visible |
| 2 | Un miembro normal NO puede crear un hábito directamente (rechazado por RLS) | Confirma que `habits` INSERT exige `is_admin()`, tal como quedó tras el fix de la ronda 2 de RLS |
| 3 | El admin asigna al miembro a un hábito (`habit_assignments`) | Camino "feliz" normal, el que usa `AdminScreen.js` al crear/editar un hábito |
| 4 | Un miembro normal **SÍ** puede auto-asignarse a un hábito de su empresa | Ver hallazgo en el punto 7 — la policy real no exige ser admin para `habit_assignments` INSERT, solo que el hábito sea de tu empresa |
| 5 | El admin añade al miembro como validador (`habit_validators`) | Camino "feliz" normal |
| 6 | Un miembro normal NO puede añadirse a sí mismo como validador (rechazado por RLS) | A diferencia de `habit_assignments`, `habit_validators` INSERT sí exige `is_admin()` — asimetría real entre las dos tablas, no un descuido de este test |
| 7 | Un admin de OTRA empresa no puede asignar a nadie a un hábito ajeno (rechazado por RLS) | Confirma el aislamiento multi-tenant (`company_id = my_company_id()`) en `habit_assignments` |
| 8 | Nada en la base de datos impide que el mismo usuario sea asignado Y validador del mismo hábito a la vez | Ver hallazgo en el punto 7 — es una regla solo de UI, no de datos |

### Fase 3 — `test-03-rachas.js` (18 tests)

Rachas (`calculateStreak`) y recompensas recursivas/históricas, sobre
**réplicas locales** de las funciones reales — no se pueden `require()`
directamente porque viven en pantallas de React Native (`HabitDetailScreen.js`,
`HomeScreen.js`) que importan módulos de RN/Expo que no corren en Node plano.
Mismo patrón ya usado en la Fase 1 (`adminNeedsFamilySetup`). Si esas pantallas
cambian su lógica de cálculo, hay que actualizar las réplicas de
`test-03-rachas.js` a mano — no hay forma de que un cambio ahí se detecte solo.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 | Racha diaria: 3 días consecutivos (hoy, ayer, anteayer) => racha=3 | Caso base de `calculateStreak` (`HabitDetailScreen.js:41-77`) |
| 2 | Racha diaria con un hueco (día 1 hecho, día 2 saltado, día 3=hoy) => racha=**1**, no 3 ni 2 | El enunciado original pedía "no asumir el valor tras la rotura, comprobarlo" — trazando el algoritmo a mano: el hueco corta la cuenta justo al llegar a él, así que solo cuenta el tramo pegado a hoy |
| 3 | `weekly_x` (target=3): semana en curso sin cumplir aún (ignorada por el periodo de gracia) + 2 semanas completas que cumplen + 1 semana más atrás que no cumple => racha=2 | Cubre a la vez "cumplir mantiene", "no llegar rompe" **y** el periodo de gracia real (ver punto 7) — antes eran ideas separadas, aquí es un único escenario coherente |
| 4 | `monthly_x` (target=2): análogo a nivel mes => racha=2 | Mismo patrón que el test 3, a nivel mensual |
| 6 | Construir racha=3 sin insertar ningún voto en `habit_validations`, confirmar que `calculateStreak` la cuenta igual (racha=3) | La racha sube al completar (INSERT en `habit_logs`), no al validar — confirmado que no hay ninguna dependencia oculta de `habit_validations` |
| 7 | Recompensa simple: total=3, `streak_target=3` => `floor(3/3)=1` conseguida | "Conseguida" es cálculo de cliente puro, sin persistencia — ver punto 7 |
| 8 (×2 aserciones) | Total=6, `streak_target=3` => conseguida ×2 | Confirma la recursividad de la fórmula (`floor(total/target)`, no solo "¿se llegó alguna vez?") |
| 9 (×4 aserciones) | Construir total=3 (conseguida ×1), "romper" la racha actual con un hueco de varios días, construir 3 días más => total=6, conseguida ×2 — Y la racha ACTUAL sigue siendo solo 3 | Confirma que `calculateTotalCompleted` (histórico, para recompensas) y `calculateStreak` (racha actual, para el contador visible) son cosas **distintas** — el histórico no se resetea aunque la racha sí |
| 10 (×3 aserciones) | Dos recompensas en el mismo hábito (`target=3` y `target=7`) con total=5: solo la de `target=3` está conseguida | Confirma que cada recompensa se evalúa independientemente contra el mismo total, no hay ningún orden ni exclusión entre ellas |
| 11 (×2 aserciones) | `featuredReward` (`HomeScreen.js:398-401`): con total=2, dos recompensas `target=2` (ya conseguida, `daysToNext=2`) y `target=3` (sin conseguir, `daysToNext=1`) — gana la de **target=3**, la mayor y sin conseguir | Caso contraintuitivo real, deliberadamente puesto bajo test — ver punto 7 |

**Eliminado del plan original:** el test 5 ("periodo de gracia en `once`") no existe como tal — ver punto 6. Su comprobación real (semana/mes en curso) quedó plegada en los tests 3 y 4.

### Fase 4 — `test-04-permisos.js` (12 tests)

Permisos y RLS sobre `profiles` y aislamiento entre empresas. No repite los
tests de `habits`/`habit_assignments`/`habit_validators` ya cubiertos en la
Fase 2 — esta fase es específicamente sobre `profiles` y cross-tenant.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 0 [GUARDA DE REGRESIÓN] (×4 aserciones) | Un usuario normal no puede auto-ascenderse a admin ni cambiarse de empresa | Protección permanente contra que la vulnerabilidad crítica documentada arriba se reintroduzca sin darse cuenta |
| 1 | Un usuario normal no puede cambiar su propio `role` | Mismo mecanismo que el test 0, presentado como parte de la matriz sistemática de permisos de `profiles` (redundante con el 0 a propósito — ver la sección de la vulnerabilidad) |
| 2 (×2 aserciones) | Un usuario normal no puede editar el perfil de OTRO miembro de su misma empresa | Confirma que `"users can update own profile"` no se cuela para filas ajenas |
| 3 | Un admin SÍ puede editar `avatar_url` de otro miembro de su empresa | Bug real ya corregido en la auditoría de RLS de esta sesión (antes la policy no comprobaba `company_id` de la fila destino) — confirma que sigue arreglado |
| 4 (×2 aserciones) | Un admin de la EMPRESA A no puede editar un perfil de la EMPRESA B | Aislamiento multi-tenant en `profiles`, mismo patrón que el test 7 de la Fase 2 pero sobre `profiles` |
| 5 | Un admin de la EMPRESA A SÍ puede leer los `habits` de la EMPRESA B (filas reales, no vacío) | Diseño intencional y **ya documentado** en la auditoría de RLS original (`habits` SELECT es `qual: true`) — este test confirma que ese diseño aceptado sigue siendo el comportamiento real, no es un hallazgo nuevo |
| 6 | Un usuario normal se autoelimina con éxito vía `delete_own_account()` (su `profile` desaparece) | Confirma el mecanismo real que usa `ProfileScreen.js` — no `auth.admin.deleteUser` (inalcanzable desde un cliente autenticado como el propio usuario, solo con Service Role Key). No verifica la cascada completa a otras tablas — eso es la Fase 6 |

## 5. La regla del prefijo `zztest-` y la barrera de seguridad

`TEST_PREFIX = 'zztest-'` (en `test-helpers.js`) marca **todo** dato que crean
estos scripts: el email de cada usuario de test (`zztest-<timestamp>-<random>@
habitapp-test.local`) y el nombre de cada company de test (`zztest-Company...`).
Existe por una razón muy concreta: `cleanupTestData()` usa la **Service Role
Key**, que salta RLS por completo — no hay ninguna política de la base de
datos que le impida borrar cualquier fila de cualquier usuario real. El
prefijo es la única frontera entre "esto es un dato de test, se puede borrar
sin miedo" y "esto es una familia real usando la app".

Por eso `cleanupTestData()` no se limita a filtrar por el prefijo al construir
sus queries de borrado — **además** relee cada company y cada profile que va a
usar como origen de un borrado en cascada y comprueba, fila a fila, que
efectivamente lleva el prefijo. Si encontrara una sola fila sin él (un fallo en
el filtro, un bug futuro al tocar este fichero, lo que sea), **aborta sin
borrar nada** y lanza un error explícito con el id y el valor que no encajaba,
en vez de continuar "a ver si el resto está bien". Esta comprobación no se
debe relajar ni hacer opcional nunca, precisamente porque es la única red de
seguridad que existe — RLS aquí no protege nada.

**Excepción deliberada — `activation_attempts`:** esta tabla (capa de rate
limiting por IP de `check_activation_code`, ver `database.md`) **no sigue el
criterio de prefijo del resto de `cleanupTestData()`**. Dicho sin rodeos: el
código real es

```js
await supabaseAdmin.from('activation_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
```

y eso **borra la tabla entera, de cualquier IP, sin ninguna acotación** — el
`.neq('id', <uuid imposible>)` no es un filtro real, es solo el truco para
satisfacer que el cliente de Supabase exige al menos una condición en un
`.delete()`; lo cumplen literalmente todas las filas. No hay ninguna
comprobación fila a fila como con `companies`/`profiles`, porque no hay nada
que comprobar: la tabla solo tiene `ip_address` + `attempted_at`, sin ningún
campo de usuario/empresa/código donde aplicar `TEST_PREFIX` ni ninguna otra
forma de distinguir "esto lo generó un test" de "esto lo generó un signup
real". Se evaluó (y se descartó) acotar por una ventana de tiempo reciente en
vez de borrar todo — no habría sido más preciso: un test que tarda en
ejecutarse cae en la misma ventana que un usuario real activándose en ese
momento, así que no distingue nada que un borrado completo no distinga ya.

Se considera un riesgo aceptable, no inexistente: si un usuario real está
intentando activarse justo en el momento en que corre `cleanupTestData()`, su
contador de intentos se resetea a 0 antes de tiempo. El efecto de eso es
puramente a favor de ese usuario (recupera intentos, no los pierde) y la
tabla no contiene ningún dato personal ni de negocio — pero es, con todas las
letras, un borrado sin ninguna de las garantías que sí tiene el resto de esta
función. No se disfraza de lo contrario.

## 6. Huecos conocidos, pendientes

### Test 5 de la Fase 1 — `authFlags.skipNextRedirect`

No implementado, a propósito. Es una condición de carrera de **timing en el
cliente** (estado de React / orden de eventos de `onAuthStateChange` en
`RootNavigator.js`, gestionada por el singleton `authFlags` — ver
[database.md](../docs/database.md)), no algo verificable consultando datos en
Supabase: no hay ninguna fila ni columna que capture "¿se navegó demasiado
pronto?". Candidato natural para cuando se monte testing de UI real (por
ejemplo Maestro, sobre una build de EAS): lanzar el flujo de signup/activación
repetidamente y comprobar que nunca se ve un `HomeScreen` roto antes de que
`activateSession()` complete.

### `photo_required` (Fase 2)

No se testea. Es validación de cliente (`HabitDetailScreen.js` exige tomar
una foto antes de permitir el submit si `habit.photo_required = true`), y se
confirmó explícitamente que **no** hay ningún equivalente server-side: la
policy INSERT de `habit_logs` no comprueba `photo_required` en absoluto, y
`habit_logs.photo_url` es `nullable` a nivel de columna. Un INSERT directo con
`photo_url: null` en un hábito con `photo_required: true` tendría éxito sin
ningún error. No hay nada que testear en el backend porque el backend no
impone esta regla — si en el futuro se decide que sí debería hacerlo, sería un
cambio de RLS/constraint, no un test que falta.

### "Periodo de gracia en `once`" (Fase 3) — no existe, era un malentendido

El plan original de la Fase 3 pedía un test 5 para el "periodo de gracia" de
los hábitos `once`. Se buscó explícitamente en todo el código ("gracia"/
"grace") antes de escribir nada: el único periodo de gracia real está en
`calculateStreak`/`calculateWeeklyStreakForStats` para **`weekly_x`/
`monthly_x`** (si la semana/mes actual, aún en curso, no ha cumplido el
objetivo todavía, la racha no se rompe de inmediato — se retrocede a evaluar
desde el periodo anterior). Los hábitos `once` se tratan **idénticos a
`daily`** en `calculateStreak`/`calculateTotalCompleted` (mismo bloque de
código, comentario `// daily / once`), sin ningún concepto de gracia propio.

El origen probable de la confusión: la frase "sin periodo de gracia" aparece
en `navigation.md`, pero describiendo el **borrado de cuenta** (`delete_own_
account`, Fase de eliminación de cuenta de esta misma sesión) — una
funcionalidad completamente distinta, sin ninguna relación con rachas ni con
hábitos `once`. El test 5 se eliminó del plan; el periodo de gracia real (el
de `weekly_x`/`monthly_x`) sí quedó cubierto, dentro de los tests 3 y 4.

## 7. Hallazgos de esta fase

### Fase 1 — "admin sin miembros" no es la condición real

**Se esperaba:** que la redirección a `AdminScreen({ initialTab: 'family' })`
para un admin recién creado dependiera del número de miembros del grupo
("admin sin miembros" era la descripción original de la tarea).

**Se encontró:** en `HomeScreen.js:184-212`, la condición real es
`role === 'admin' AND company_id IS NOT NULL AND AsyncStorage('family_setup_
done') es null AND COUNT(habits activos de esa company) === 0`. No aparece
ninguna comprobación sobre el número de miembros en ningún punto. Añadir un
segundo miembro no cambia el resultado; crear un hábito activo sí. El test 4
de la Fase 1 se rediseñó (con acuerdo explícito) para verificar esto tal como
es, no tal como se pensaba que era.

### Fase 2 — `habit_assignments` no exige admin, `habit_validators` sí

**Se esperaba:** que gestionar asignaciones y validadores de un hábito fuera
una operación exclusiva del admin en ambos casos (es lo único que expone la
UI de `AdminScreen.js` — un miembro normal nunca ve un botón para
auto-asignarse).

**Se encontró:** la policy real de `habit_assignments` INSERT es "cualquier
autenticado, siempre que el hábito sea de su propia empresa" (documentado en
[database.md](../docs/database.md), es intencional, no un bug) — un miembro
normal puede auto-asignarse llamando directamente a la API, aunque la app
nunca le ofrezca esa opción en pantalla. `habit_validators` INSERT, en
cambio, sí exige `is_admin()`. Es una asimetría real entre las dos tablas
(test 4 vs. test 6 de la Fase 2), no un fallo de configuración a corregir sin
más — pero si se decide que las asignaciones también deberían ser
admin-only, es un cambio de RLS, no de la app.

### Fase 2 — nada impide ser asignado y validador del mismo hábito

**Se esperaba:** que un usuario no pudiera ser a la vez "asignado" (debe
completar el hábito) y "validador" (valida las fotos de otros) del mismo
hábito — así lo trata `AdminScreen.js`, con checkboxes mutuamente excluyentes
en el modal de crear/editar hábito.

**Se encontró:** no existe ninguna constraint ni policy en la base de datos
que lo impida — solo hay `UNIQUE (habit_id, user_id)` por separado en cada
tabla (`habit_assignments_habit_id_user_id_key`,
`habit_validators_habit_id_user_id_key`), nada que las relacione entre sí. Es
puramente una regla de UI. El test 8 de la Fase 2 lo deja explícito.

### Fase 3 — `calculateHabitStreak` de `HomeScreen.js` ya no existe

**Se esperaba** (el plan original de la Fase 3 lo pedía explícitamente):
revisar y testear `calculateHabitStreak` en `HomeScreen.js`.

**Se encontró:** esa función se eliminó de `HomeScreen.js` como código muerto
confirmado (nunca se llamaba desde ningún sitio) durante la tarea de
eliminación de cuenta de esta misma sesión, en la que también se corrigió
`HabitDetailScreen.js` (antes ignoraba `weekly_x`/`monthly_x` y calculaba
siempre como si el hábito fuera diario). La lógica real, ya corregida, vive
ahora en `HabitDetailScreen.js`: `calculateStreak` (líneas 41-77) y
`calculateTotalCompleted` (líneas 82-98) — son las que testea
`test-03-rachas.js`. Es exactamente el tipo de desajuste que ningún enunciado
escrito de antemano puede prever por sí solo: parar a comprobar el código real
antes de escribir el test evitó testear una función fantasma.

### Fase 3 — "conseguida" es cálculo de cliente puro, sin persistencia

**Se esperaba:** confirmar si "recompensa conseguida" es un cálculo en
cliente o si hay algo persistido en base de datos (la sospecha de partida era
que no, dado que no aparecía ninguna columna tipo `times_achieved` en el
esquema).

**Se encontró:** confirmado — `habit_rewards` solo tiene `id, habit_id,
streak_target, description` (`database.md`). La fórmula `timesAchieved =
Math.floor(total/streak_target)` está duplicada tal cual en tres sitios
(`HomeScreen.js`, `HabitStatsScreen.js`, y la variante "justo conseguida" de
`HabitDetailScreen.js`), y de nuevo en la web (`MemberDetail.jsx`). No hay
ningún estado guardado que un test pueda leer — `test-03-rachas.js` (tests 7
a 11) replica la misma fórmula y comprueba que da el resultado esperado sobre
logs reales insertados en la base de datos, que es lo único verificable aquí.

### Fase 3 — `featuredReward` no elige por `streak_target` menor, sino por `daysToNext` menor

**Se esperaba:** que "la recompensa que se muestra" en el listado de hábitos
fuera la de `streak_target` más bajo entre las que aún no se han conseguido —
la lectura intuitiva de "la próxima recompensa a alcanzar".

**Se encontró:** en `HomeScreen.js:398-401` (comentario propio del código:
*"Recompensa a mostrar: la más próxima (menor daysToNext)"*), el criterio real
es el `daysToNext` mínimo entre **todas** las recompensas del hábito,
conseguidas o no — no hay ningún filtro que excluya las ya conseguidas. Esto
puede dar resultados contraintuitivos: con total=2, una recompensa de
`target=2` (ya conseguida, `daysToNext = 2 - (2 % 2) = 2`) pierde frente a una
de `target=3` (sin conseguir, `daysToNext = 3 - (2 % 3) = 1`) — gana el target
**mayor**, pese a estar sin conseguir, precisamente porque el aritmético modular
no es monótono con el tamaño del target. El test 11 de la Fase 3 deja este
caso explícito para que no vuelva a asumirse "target menor = se muestra
antes" sin comprobarlo.

### Fase 4 — la vulnerabilidad de escalada de privilegios

Ver la sección destacada al principio de este documento — se documenta ahí
por separado, no como un hallazgo más de esta lista, precisamente porque es
el ejemplo que justifica que este sistema de tests exista.

### Fase 4 — un UPDATE bloqueado por RLS no lanza error, afecta 0 filas

**Se esperaba:** que un `UPDATE` rechazado por RLS se comportara igual que un
`INSERT` rechazado — devolviendo un `error` explícito que `assertRejected`
pudiera capturar (así se habían planteado inicialmente los tests 2 y 4).

**Se encontró:** al ejecutar el test 2 tal cual, pasó de forma inesperada —
verificación puntual confirmó que **no hubo ningún error** (`error: null,
status: 200`), pero el dato tampoco cambió (`data: []`, 0 filas afectadas).
Cuando RLS bloquea un `UPDATE` a través de la cláusula `USING` (que decide
qué filas existentes puedes ver/tocar), Postgres/PostgREST no lo trata como
un fallo — simplemente no encuentra ninguna fila que la policy deje pasar
como destino, así que la operación "tiene éxito" sin afectar a nada. Es
distinto de una violación de `WITH CHECK` (como el trigger de la
vulnerabilidad de arriba, o un `INSERT`), que sí lanza una excepción
explícita. Los tests 2 y 4 de la Fase 4 se corrigieron para comprobar
`data.length === 0` y releer el dato con la Service Role Key para confirmar
que no cambió, en vez de comprobar `error`.

### Fase 4 — la propia suite de tests puede autobloquearse por el rate limiting de producción

**Se esperaba:** poder ejecutar `test-04-permisos.js` varias veces seguidas
sin ningún efecto secundario entre ejecuciones, igual que las fases
anteriores.

**Se encontró:** la segunda ejecución consecutiva falló con `"Código
bloqueado temporalmente, inténtalo de nuevo en unos minutos"` — el mismo
mensaje de la capa de rate limiting por IP de `check_activation_code`
(Fase de rate limiting de esta sesión). Cada `joinAsTestMember()` llama a esa
RPC real, y tras varias ejecuciones de varias fases en poco tiempo, la IP
desde la que se ejecutan los tests acumuló 5 intentos en la ventana de 15
minutos — el propio sistema de protección contra fuerza bruta, funcionando
correctamente también contra el uso repetido de los tests, que pasan por el
mismo camino que un signup real. Se resolvió haciendo que
`cleanupTestData()` limpie también `activation_attempts` de forma
incondicional (ver el porqué de que esto sea seguro en el punto 5) — sin
este cambio, la propia suite no podía cumplir su promesa de "ejecutarse
tantas veces como haga falta" (punto 1).
