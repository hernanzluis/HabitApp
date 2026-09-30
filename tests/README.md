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

## 🔴 RPCs de alta ejecutables sin sesión — 2026-09-28

Encontrado al investigar por qué el correo de confirmación de Supabase
llevaba a `localhost:3000` (la confirmación de email se había activado en el
dashboard). La consulta a `pg_proc` que ejecutó Luis mostró que
`handle_new_user_registration` y `handle_activation_registration` eran
`SECURITY DEFINER`, con `EXECUTE` para `anon`, sin comprobar `auth.uid()` y
sin `SET search_path`.

**Qué se esperaba:** que solo el usuario recién registrado, con su propia
sesión, pudiera crear su profile, y que el rate limiting de
`check_activation_code` protegiera los códigos de activación.

**Qué se encontró** (verificado contra la BD real con
`test-08-registro-seguro.js` ANTES de aplicar el fix, no solo leyendo SQL):
- Sin sesión (solo la anon key pública) se crea una company + profile de
  admin para cualquier `user_id` existente (tests 2a/2b fallaron).
- Un usuario autenticado registra a OTRO `user_id` (3a/3c) y con un email que
  no es el suyo (4a/4c): ambas RPCs se fiaban de `user_id`/`user_email` del
  cliente.
- **Un código de activación no estaba ligado al email del invitado:** un
  usuario con cualquier email canjeaba el código emitido para otra persona y
  entraba en esa familia (4d).
- El rate limiting vivía solo en `check_activation_code`. Llamando a
  `handle_activation_registration` directamente, 8 códigos inventados
  seguidos → 8 veces "Código de activación inválido o expirado", ningún
  bloqueo, 0 filas en `activation_attempts`. Con 900.000 códigos posibles y
  sin email ligado, era fuerza bruta viable para entrar en un grupo ajeno.
- El código lo marcaba como usado el CLIENTE con un `UPDATE` aparte
  (`screens/SignUpScreen.js`, `onActivate`, antes líneas 260-268). Si RLS lo
  bloqueaba, afectaba a 0 filas sin error (ver hallazgo de la Fase 4) y el
  código seguía válido. Y la policy que lo permitía (`auth.uid() IS NOT NULL
  AND used = false`, `WITH CHECK used = true`) dejaba a cualquier autenticado
  quemar los códigos pendientes de cualquier empresa.
- `company_name` en blanco aceptado (6a).
- `profiles.id` **no tiene FK real a `auth.users`** (`database.md` decía lo
  contrario): una llamada anónima con `user_id = 00000000-…` creó una company
  y un profile de admin para un usuario que no existe. No hacía falta ni un
  `user_id` real. Tras el fix no es alcanzable (la RPC exige `auth.uid() =
  user_id`); añadir la FK queda como decisión aparte (`docs/release.md`).

**Fix:** `sql/2026-09-28_registro_seguro.sql` (ejecutado por Luis en el SQL
Editor). Ambas RPCs exigen `auth.uid() = user_id`, rechazan si ya hay profile,
toman el email de `auth.users` (el parámetro se mantiene por compatibilidad y
debe coincidir), `SET search_path = public, pg_temp`, `EXECUTE` solo para
`authenticated`. `handle_activation_registration` además: el código solo lo
canjea el usuario cuyo email coincide con el del código; lo marca usado dentro
de la propia RPC (fila bloqueada con `FOR UPDATE`); aplica las mismas dos capas
de rate limiting que `check_activation_code`; y devuelve `'ok'` /
`'invalid_code'` en vez de lanzar excepción ante un código inválido — un
`RAISE` deshace la transacción entera, incluido el registro del intento, y el
rate limiting nunca contaría nada. Se elimina el `UPDATE` del cliente y la
policy que lo permitía. `handle_new_user_registration` valida `company_name`
y `full_name` (no vacíos, ≤100 caracteres).

**Corrección posterior, mismo día — cupo de IP en el paso 2**
(`sql/2026-09-28b_activacion_rate_limit.sql`): la primera versión comprobaba
el cupo de IP al principio de `handle_activation_registration`. Al ejecutar
las fases 1-8 tras aplicarla, la Fase 5 (test 3) falló: `check_activation_code`
registra en `activation_attempts` **todas** sus llamadas, también las buenas,
así que tras 5 activaciones legítimas desde la misma IP (o 4 errores de
tecleo y un acierto) el paso 1 pasaba y el paso 2 decía "Código bloqueado" —
con el `auth.user` ya creado por `signUp` y sin profile. Ahora el cupo de IP
solo se comprueba en la rama de fallo; un código válido para el email del
usuario autenticado siempre se canjea. Tests 8e, 8j y 8k.

**Límite de inicios de sesión de Supabase:** como los helpers ahora inician
sesión para llamar a las RPCs, ejecutar las 8 fases seguidas agotaba el
límite de Auth por IP (`429 over_request_rate_limit`). `getClientForUser`
cachea el cliente por usuario y, ante un 429, espera 30 s y reintenta (hasta
6 min). Es un límite del servidor, no un fallo de la app: la Fase 7 hace sus
propios `signInWithPassword` directos y puede seguir chocando con él si se
ejecuta justo después de otras fases sin pausa.

**Efecto en los tests existentes:** `createTestUser()` y `joinAsTestMember()`
(`test-helpers.js`) llamaban a las RPCs con la Service Role Key, que no tiene
`auth.uid()`. Ahora se autentican como el usuario de test antes de llamarlas
— más fiel a la app que antes. Además ninguna fase pasaba por el `auth.signUp`
real de la app (todas usan `admin.createUser`); el test 1 de la Fase 8 sí lo
hace.

**Protección permanente:** Fase 8 entera, y en particular su test 0, que
falla si alguien reactiva "Confirm email" (con la confirmación activada
`signUp` no devuelve sesión y todas las altas fallarían con
`not_authenticated`).

## 🟠 La barrera de `cleanupTestData()` no cubría el email de Auth — 2026-09-28

Encontrado al investigar un usuario de `auth.users` (sin profile) que
desapareció del proyecto durante la sesión del 2026-09-28. `auth.audit_log_entries`
está vacía en este proyecto, así que se revisó por código todo lo que llama a
`auth.admin.deleteUser`/`listUsers`: `cleanupTestData()` (`tests/test-helpers.js`)
y `wipe-auth-users.js` (script suelto, sin seguimiento en git, que borra
**todos** los usuarios sin filtro; no se ejecutó en esta sesión — la cuenta de
Luis, creada ese mismo día a las 13:25 UTC, sigue existiendo).

**Qué se esperaba:** que `cleanupTestData()` nunca pudiera borrar un usuario
de Auth cuyo email no llevara el prefijo `zztest-` (punto 5 de este documento).

**Qué se encontró:** dos vías de borrado en Auth, con criterios distintos
(versión del commit `3dcc0a8`):
- Huérfanos (Auth sin profile, líneas 342-347): filtro sobre el email **de
  Auth** (`u.email.startsWith(TEST_PREFIX)`). Correcta: un usuario sin
  prefijo y sin profile nunca se selecciona.
- Usuarios con profile (`userIds`, borrados en las líneas 348-354): salen de
  `profiles.email` con prefijo o de ser miembro de una company de test, y la
  barrera fila a fila solo comprobaba **`profiles.email`**. Nunca se miraba el
  email en `auth.users` antes del `deleteUser`. Y los dos pueden divergir: las
  RPCs de alta guardaban el email que mandaba el cliente hasta el
  2026-09-28, un admin puede editar `profiles.email` de un miembro
  (`AdminScreen.js`, `update_member_profile`), y `profiles.id` no es FK real a
  `auth.users`. Un usuario real con un profile que llevara `zztest-` se
  borraba de Auth sin ningún aviso.

Confirmado con `test-00-barrera-limpieza.js` ANTES del fix: el canario sin
profile sobrevivió (test 1 ✓), el canario con profile `zztest-` fue borrado
(tests 2a-2c ✗).

**Fix:** `cleanupTestData()` lee `auth.users` al principio, antes de borrar
nada, y aborta si algún usuario que se va a borrar tiene en Auth un email sin
el prefijo. También aborta si hay 1000+ usuarios (solo se lee la primera
página de `listUsers`, y la barrera no puede verificar lo que no ve). De paso
se corrigió que el `return` temprano ("no había datos de test que limpiar")
saltaba la limpieza de huérfanos de Auth cuando no quedaba ningún profile ni
company de test.

**Lo que NO explica:** el usuario desaparecido no tenía profile, así que la
vía de `userIds` no pudo borrarlo si su email no llevaba el prefijo.

**Explicación más probable — HIPÓTESIS NO CONFIRMADA:** que no fuera un
usuario real, sino un huérfano `zztest-` (usuario de Auth sin profile)
creado durante la investigación de la Fase 8 y borrado después por la propia
limpieza. El candidato más concreto es un script puntual de esa sesión (no
forma parte de `tests/`) que comprobó que el rate limiting se esquivaba: creó
un usuario `zztest-` con la Admin API, llamó 8 veces a
`handle_activation_registration` con códigos inventados (todas fallaron, sin
profile) y llamó a `cleanupTestData()` al terminar. Sin ningún profile ni
company de test en ese momento, la versión antigua salía por el `return`
temprano ("no había datos de test que limpiar", línea 286 del commit
`3dcc0a8`) **antes** de buscar huérfanos en Auth, así que ese usuario
sobrevivía. Cuadra con la cronología: el recuento de "2 usuarios en Auth, 1
profile" se hizo después de ese script, y la siguiente limpieza con datos de
test (las rondas de las fases 1-8) sí lo habría borrado por la vía de
huérfanos. Una alternativa del mismo tipo: un huérfano de las altas
rechazadas del propio `test-08-registro-seguro.js`.

Por qué no está confirmada: no se registró el email del segundo usuario
cuando se contó, `auth.audit_log_entries` está vacía en este proyecto, y no
queda ningún rastro que lo identifique. Luis tampoco recuerda haber borrado
ninguno; que fuera su cuenta anterior, borrada al rehacer el alta, no se
puede descartar del todo, aunque su cuenta actual (13:25 UTC) es anterior a
ese recuento y no se borró. El `return` temprano está corregido y cubierto
indirectamente: ahora los huérfanos se buscan antes de decidir si hay algo
que limpiar.

## 🟡 Company en blanco que la limpieza no reconoció — 2026-09-29

**Qué se encontró:** al revisar la documentación contra la base el
2026-09-29 apareció una segunda company, con nombre `'   '` (tres espacios),
0 miembros y un `admin_id` que ya no existía en Auth. La creó el test 6a de la
Fase 8, ejecutado el 2026-09-28 **antes** de aplicar el SQL de registro
seguro: el test prueba precisamente un nombre en blanco (no puede llevar el
prefijo `zztest-`) y la RPC antigua lo aceptaba. `cleanupTestData()` borró a su
admin de test y su profile, pero no la company, porque solo reconocía las
companies por el nombre. Se borró el 2026-09-29 con aprobación de Luis (copia
en `~/habitapp-backups/2026-09-29-empresa-huerfana/`).

**Refuerzos (2026-09-29):**
- `cleanupTestData()` borra también las companies **sin** prefijo cuyo
  `admin_id` es un usuario de test que se borra en esa misma limpieza, y
  aborta sin borrar nada si alguna tiene un miembro real. Tiene que ser en la
  misma limpieza: una vez borrado el admin, ya no queda rastro de que era de
  test. Vigilado por la Fase 0, tests 4 y 5.
- Fase 8, test 6c: además de que la RPC rechace el nombre en blanco, comprueba
  que no se ha creado ninguna company con ese `admin_id`.

**Límite que queda:** una company huérfana cuyo admin de test ya se borró en
una limpieza anterior no se puede identificar después (sin FK en
`companies.admin_id`, ese id no apunta a nada). Las FK propuestas el
2026-09-29 (pendientes de decisión) lo harían visible como `admin_id = NULL`.

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
node tests/test-00-barrera-limpieza.js  # Fase 0: canario de la barrera de cleanupTestData
node tests/test-01-alta.js       # Fase 1: alta de admin y de miembro
node tests/test-02-habitos.js    # Fase 2: hábitos, asignación, validadores
node tests/test-03-rachas.js     # Fase 3: rachas y recompensas
node tests/test-04-permisos.js   # Fase 4: permisos y RLS (profiles, aislamiento)
node tests/test-05-limites.js    # Fase 5: límites de plan (plan_limits, check_member_limit, check_habit_limit)
node tests/test-06-borrado.js    # Fase 6: borrado de cuenta (delete_own_account)
node tests/test-07-recuperacion.js  # Fase 7: recuperación de contraseña (generateLink, verifyOtp, updateUser)
node tests/test-08-registro-seguro.js  # Fase 8: registro seguro (auth.uid, email, códigos, rate limiting)
node tests/test-09-aislamiento.js  # Fase 9: aislamiento de la API pública (anon, entre empresas, Storage, RPCs de miembros)
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

### Fase 0 — `test-00-barrera-limpieza.js` (12 tests)

Canario de la barrera de seguridad de `cleanupTestData()` (punto 5). Crea con
la Service Role Key usuarios de Auth con email `canary-…@habitapp-test.local`
(nunca `zztest-`), ejecuta `cleanupTestData()` y los borra por id en un
`finally`.

**Rediseñada el 2026-09-29.** El test 2 original simulaba un profile con email
`zztest-` sobre un usuario de Auth `canary-` (desfase `profiles.email` ≠
`auth.users.email`). Desde el cierre de seguridad del 2026-09-28 el trigger
`profiles_email_from_auth` fuerza siempre el email de Auth, así que ese
escenario ya no se puede crear (el test 3 lo confirma). La barrera sigue
teniendo otra vía por la que un usuario real podría acabar en la lista de
borrado: ser **miembro de una company `zztest-`**, sea cual sea su email. El
test 2 vigila ahora esa vía.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 | Un usuario de Auth sin prefijo y sin profile sobrevive a la limpieza | Vía de "huérfanos" |
| 2 (×4) | Un usuario de Auth sin prefijo, **miembro de una company `zztest-`**, hace que la limpieza aborte sin borrar nada: sigue en Auth, conserva su profile y la company sigue ahí | Vía de "miembros de una company de test" de la barrera |
| 3 | Un UPDATE de `profiles.email` a un valor `zztest-` (incluso con la Service Role Key) no desincroniza el email: vuelve al de Auth | Confirma que el hueco del 2026-09-28 (ver sección destacada) ya no se puede reproducir en datos |
| 4 (×2) | Una company **sin** el prefijo cuyo `admin_id` es un usuario de test, sin miembros, se borra en la limpieza junto con ese usuario | Refuerzo del 2026-09-29 (ver hallazgo "Company en blanco que la limpieza no reconoció") |
| 5 (×4) | La misma company, pero con un miembro real (canario): la limpieza aborta sin borrar nada — ni la company, ni el miembro, ni el admin de test | Misma barrera que el resto: nunca borrar si hay algo real colgando |

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

### Fase 2 — `test-02-habitos.js` (19 tests)

Hábitos, asignación (`habit_assignments`) y validadores (`habit_validators`),
centrado en el comportamiento real de sus políticas RLS — las mismas que se
endurecieron en la auditoría de seguridad de este mismo proyecto.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 (×3 aserciones) | El admin crea un hábito en su propia empresa; `is_active` queda `true` (no `NULL`) y `recurrence` tiene el default `'daily'` | `habits.is_active` **no tiene default de columna** — si un INSERT lo omite, queda `NULL`, y toda condición que compara `is_active = true` (incluida la del test 4b de la Fase 1) lo trata como inactivo sin ningún error visible |
| 2 | Un miembro normal NO puede crear un hábito directamente (rechazado por RLS) | Confirma que `habits` INSERT exige `is_admin()`, tal como quedó tras el fix de la ronda 2 de RLS |
| 3 | El admin asigna al miembro a un hábito (`habit_assignments`) | Camino "feliz" normal, el que usa `AdminScreen.js` al crear/editar un hábito |
| 4 | Un miembro normal **SÍ** puede auto-asignarse a un hábito de su empresa | Ver hallazgo en el punto 7 — la policy real no exige ser admin para `habit_assignments` INSERT, solo que el hábito sea de tu empresa |
| 5 | El admin se añade como validador del hábito 2 (`habit_validators`), en el que el miembro está asignado | Camino "feliz" normal. Hasta el 2026-09-30 el validador era el mismo miembro asignado; desde ese día la base lo rechaza (test 8) |
| 6 | Un miembro normal NO puede añadirse a sí mismo como validador (rechazado **por RLS**, se comprueba el motivo) — sobre un hábito donde no está asignado | A diferencia de `habit_assignments`, `habit_validators` INSERT sí exige `is_admin()` — asimetría real entre las dos tablas, no un descuido de este test |
| 7 | Un admin de OTRA empresa no puede asignar a nadie a un hábito ajeno (rechazado por RLS) | Confirma el aislamiento multi-tenant (`company_id = my_company_id()`) en `habit_assignments` |
| 8 (×10) | **Nadie puede ser asignado Y validador del mismo hábito** (invertido el 2026-09-30): asignado→validador y validador→asignado rechazados sin dejar fila (8a-8d); intercambio de papeles en el orden antiguo de AdminScreen rechazado (8e) y en el orden corregido, correcto (8f-8g); un UPDATE desde cliente no llega (sin policy UPDATE, 0 filas) y con la Service Role Key lo frena el trigger (8h-8i); tampoco se salta al insertar con la Service Role Key (8j) | Caso real del 2026-09-30 (ver hallazgo de la Fase 2 en el punto 7): un hábito sin nadie que pudiera validarlo |

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

### Fase 4 — `test-04-permisos.js` (14 tests)

Permisos y RLS sobre `profiles` y aislamiento entre empresas. No repite los
tests de `habits`/`habit_assignments`/`habit_validators` ya cubiertos en la
Fase 2 — esta fase es específicamente sobre `profiles` y cross-tenant.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 0 [GUARDA DE REGRESIÓN] (×4 aserciones) | Un usuario normal no puede auto-ascenderse a admin ni cambiarse de empresa | Protección permanente contra que la vulnerabilidad crítica documentada arriba se reintroduzca sin darse cuenta |
| 1 | Un usuario normal no puede cambiar su propio `role` | Mismo mecanismo que el test 0, presentado como parte de la matriz sistemática de permisos de `profiles` (redundante con el 0 a propósito — ver la sección de la vulnerabilidad) |
| 2 (×2 aserciones) | Un usuario normal no puede editar el perfil de OTRO miembro de su misma empresa | Confirma que `"users can update own profile"` no se cuela para filas ajenas |
| 3 (×2) | Un admin SÍ puede editar `avatar_url` de otro miembro de su empresa (UPDATE directo, afecta 1 fila y queda en BD) | Bug real ya corregido en la auditoría de RLS (antes la policy no comprobaba `company_id` de la fila destino). Desde el 2026-09-29 usa una URL válida del bucket (`avatars/<miembro>/avatar.jpg`): el CHECK `profiles_avatar_url_check` rechaza cualquier otra (eso lo cubre la Fase 9) |
| 4 (×2 aserciones) | Un admin de la EMPRESA A no puede editar un perfil de la EMPRESA B | Aislamiento multi-tenant en `profiles`, mismo patrón que el test 7 de la Fase 2 pero sobre `profiles` |
| 5 (×2) | Un admin de la EMPRESA A **NO** lee los `habits` de la EMPRESA B (0 filas), y el admin de B sí lee su propio hábito (control) | **Invertido el 2026-09-29.** Hasta el cierre de seguridad del 2026-09-28 `habits` SELECT era `qual: true` y este test confirmaba ese diseño aceptado; con registro abierto a desconocidos se cerró (`sql/2026-09-28e_lecturas_por_empresa.sql`) y ahora confirma el aislamiento |
| 6 | Un usuario normal se autoelimina con éxito vía `delete_own_account()` (su `profile` desaparece) | Confirma el mecanismo real que usa `ProfileScreen.js` — no `auth.admin.deleteUser` (inalcanzable desde un cliente autenticado como el propio usuario, solo con Service Role Key). No verifica la cascada completa a otras tablas — eso es la Fase 6 |

### Fase 5 — `test-05-limites.js` (11 tests)

Límites de plan: `plan_limits`, `check_member_limit`, `check_habit_limit`,
`history_days`. Todos los valores límite se leen de `plan_limits` en tiempo de
ejecución (no están hardcodeados en el test) precisamente para no asumir que
siguen siendo los mismos que cuando se documentaron.

Desde el 2026-09-29 `check_habit_limit` y `check_member_limit` se llaman
**autenticado como el admin de prueba** (helper `rpcAsAdmin`), igual que la app.
Desde el 2026-09-28 esas funciones solo responden sobre la empresa de quien
llama, y la Service Role Key (sin usuario) recibe `forbidden` en
`check_habit_limit`; `check_member_limit` aún respondía con ella solo por la
excepción pensada para el alta (llamante sin profile), así que también se
cambió para no depender de esa excepción.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| — | (Test 1 del plan original: company nueva → `plan='familiar'` por defecto) | **No se repite aquí** — ya cubierto por el test 1 de la Fase 1 (`test-01-alta.js`). No es un hueco |
| 2 (×3 aserciones) | `check_habit_limit`: `true` con `max-1` hábitos activos, `false` con `max` exactos, y un INSERT directo del hábito `max+1` **tiene éxito igualmente** | Confirma que `check_habit_limit` es enforcement de **cliente únicamente** — la policy RLS de `habits` INSERT no cuenta hábitos, así que nada en la BD bloquea saltarse la RPC. Ver hallazgo en el punto 7 |
| 3 (×2 aserciones) | `check_member_limit` (chequeo de cliente, antes de generar el código): `true` con 1 hueco libre, `false` en el límite exacto | Camino normal, el que usa `AdminScreen.js`/`Members.jsx` antes de generar una invitación |
| 4 (×2 aserciones) | Se genera un código cuando SÍ hay hueco (chequeo de cliente = `true`) → otro miembro ocupa ese hueco mientras tanto → activar el código ya generado es rechazado por el chequeo de **servidor** dentro de `handle_activation_registration` | Demuestra que son dos guardas independientes, no el mismo punto de código con nombre distinto — ver hallazgo en el punto 7 |
| 5 | En plan `'empresa'` (`max_active_habits=NULL`), crear más hábitos que el límite de `'familiar'` no bloquea nada | Confirma que el límite es de verdad `NULL`/sin restricción, no asumido |
| 6 (×3 aserciones) | `history_days`: la query real a `habit_logs` trae TODOS los logs sin filtro; el recorte por fecha replicado da el resultado esperado; con `historyDays=null` (planes plus/empresa) no recorta nada | `history_days` es filtro de cliente puro (igual que `photo_required` en la Fase 2), pero aquí se decidió testear la fórmula replicada en vez de dejarlo como hueco — ver punto 7 |

### Fase 6 — `test-06-borrado.js` (25 tests)

Borrado de cuenta (`delete_own_account`). Incluye la implementación y
verificación de una decisión de producto nueva: bloquear el borrado si eres
el único admin de tu grupo (antes no existía ningún chequeo de esto).

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 (×4 aserciones) | El único admin de su company intenta borrarse → rechazado con el mensaje esperado; su `profile`, `auth.user` y `company` siguen intactos tras el intento fallido | Decisión de producto implementada en esta misma fase — antes cualquier admin, incluso el único de su grupo, podía autoeliminarse dejándolo sin ningún admin para siempre |
| 2 (×8 aserciones) | Un miembro normal se borra: su `profile`, `auth.user`, `habit_logs`, `habit_assignments` y `habit_validators` desaparecen — el admin y los hábitos de la company quedan intactos | Confirma la cascada real (vía FK, no borrado manual tabla a tabla) y que no afecta a nadie más de la company |
| 3 (×4 aserciones) | Con DOS admins, uno se borra → funciona; el admin restante conserva "control total" verificado con acciones reales (crear un hábito, renombrar la company), no solo comprobando que su fila sigue existiendo | El chequeo de "único admin" no bloquea de más — deja borrarse a cualquier admin mientras quede al menos otro |
| 4 | Cero filas residuales del usuario borrado en ninguna tabla relacionada (`habit_logs`, `habit_assignments`, `habit_validators`, `habit_validations`, `team_members`, `profiles`), ni siquiera con el campo nulificado. Un recuento nulo hace fallar el test | Confirma la decisión de producto de `project.md`: borrado real, sin anonimización. `invitations` se quitó de la lista el 2026-09-29 (tabla eliminada el 2026-09-28): con `head: true` una tabla inexistente devuelve `count: null` **sin error**, y la comprobación había pasado en silencio sin comprobar nada |
| 5 (×8 aserciones) | Un hábito con un único validador que se borra a sí mismo se queda con 0 validadores — **RESUELTO en la misma fase**: el admin de la empresa cae como validador de fallback (ve el log como pendiente, y el INSERT real de la validación funciona), un admin de OTRA empresa no lo ve ni puede validarlo | Ver hallazgo en el punto 7 — incluye el cierre de un hueco de RLS preexistente en `habit_validations` que no tenía relación directa con el borrado de cuenta |

### Fase 7 — `test-07-recuperacion.js` (14 tests)

Recuperación de contraseña (`ForgotPasswordScreen.js` + `ResetPasswordScreen.js`
+ el manejo de deep link en `RootNavigator.js`). No hay forma de recibir un
correo real en este entorno, así que la fase cubre lo que sí es verificable
sin bandeja de entrada: el parser real del enlace (`getQueryParams`, de
`expo-auth-session` — se llama a la librería tal cual, no a una réplica) y el
mecanismo de backend completo, generando un enlace de recovery real vía la
Admin API y canjeándolo exactamente como lo haría la app.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 0 [GUARDA DE REGRESIÓN] | `generateLink({type:'recovery', options:{redirectTo:'habitapp://reset-password'}})` devuelve ese mismo `redirect_to`, en vez de caer al Site URL por defecto | Confirma que `habitapp://reset-password` sigue registrada en Authentication → URL Configuration → Redirect URLs del dashboard de Supabase (añadida el 2026-09-18, tras fallar este mismo test la primera vez — ver hallazgo más abajo). Si alguna vez se quita o se rota el scheme sin actualizar esa lista, este test lo detecta antes que un usuario real con un enlace muerto |
| 1 (×5 aserciones) | `getQueryParams()` (la librería real que usa `RootNavigator.js`, no una réplica) extrae `access_token`/`type=recovery` de un enlace de recovery válido, y detecta `params.error` en un enlace caducado/inválido sin `access_token` | Es el único punto de parseo del deep link en la app — si esta librería cambiara de formato de salida, este test lo detectaría antes que un usuario real con un enlace caducado |
| 2 (×3 aserciones) | `supabaseAdmin.auth.admin.generateLink({type:'recovery'})` devuelve un `hashed_token` real, y `verifyOtp({token_hash, type:'recovery'})` con un cliente anónimo lo canjea por una sesión válida | Reproduce exactamente lo que hace el endpoint `/auth/v1/verify` de Supabase cuando el usuario pulsa el enlace del correo — no es un mock, es el mismo mecanismo de verificación |
| 3 | `updateUser({password})` autenticado con esa sesión de recovery no da error | Es la llamada real que hace `ResetPasswordScreen.js` al enviar el formulario |
| 4 (×2 aserciones) | `signInWithPassword` con la contraseña NUEVA tiene éxito y devuelve una sesión válida | Cierra el círculo: no basta con que `updateUser` no dé error, hay que confirmar que el login real funciona después |
| 5 | `signInWithPassword` con la contraseña ANTIGUA es rechazado | Confirma que el cambio fue real en el servidor, no solo aparente en el cliente |
| 6 | Reutilizar el mismo `hashed_token` una segunda vez es rechazado | Los tokens de recovery son de un solo uso — si esto fallara, el enlace del correo seguiría siendo válido indefinidamente tras usarse una vez |

**Fuera de esta fase (no automatizable):** todo lo que depende de recibir el
correo real y abrir el enlace desde el dispositivo (`Linking`/deep link real,
`useLinkingURL()`, la navegación de `RootNavigator.js` hacia
`ResetPasswordScreen`) — eso queda en `docs/manual-testing.md`, bloque 2.

### Fase 8 — `test-08-registro-seguro.js` (42 tests)

Seguridad de las dos RPCs de alta tras `sql/2026-09-28_registro_seguro.sql`.
Ver la sección destacada al principio de este documento.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 0 [GUARDA] | `GET /auth/v1/settings` → `mailer_autoconfirm = true` | Si se reactiva "Confirm email", `signUp` no devuelve sesión y la app no puede llamar a las RPCs, que ahora exigen sesión |
| 1 (×4) | `auth.signUp` real con la anon key devuelve sesión y la RPC con esa sesión crea el profile admin con el email de `auth.users` | Único test que recorre el camino real de `SignUpScreen.onSignUp`; el resto de fases usa `admin.createUser` |
| 2 (×4) | Sin sesión, ninguna de las dos RPCs se ejecuta (`permission denied`) y no deja company ni código gastado | El agujero principal |
| 3 (×4) | A no puede registrar el `user_id` de B en ninguna de las dos | `user_id` venía del cliente |
| 4 (×5) | `user_email` distinto del autenticado → `email_mismatch`; un código emitido para otro email → `invalid_code`, sin sumar `failed_attempts` (no se puede usar para bloquear el código de otro) | Código ligado al email del invitado |
| 5 (×2) | Segunda llamada con profile ya existente → `profile_already_exists`, sigue habiendo una sola company | Antes fallaba igual, pero con un error de PK crudo y tras insertar la company |
| 6 (×3) | `company_name` en blanco o >100 caracteres rechazado, y ninguna de las dos llamadas deja una company creada con ese `admin_id` (6c, añadido el 2026-09-29) | Validación que antes no existía. El 6c existe porque el 6a, ejecutado antes del fix, sí creó un grupo con nombre en blanco que la limpieza no reconoció (ver hallazgo) |
| 7 (×3) | El código queda `used = true` sin ningún UPDATE del cliente; tras borrar la cuenta, una cuenta nueva con el mismo email no puede reutilizarlo | Marcado atómico dentro de la RPC |
| 8 (×11) | 5 códigos inventados por llamada directa → `invalid_code` y 5 filas en `activation_attempts`; el 6º se bloquea y no inserta (no alarga la ventana); con la IP bloqueada, un código **válido para tu propio email** sí se canjea; 5 intentos sobre un código usado → `failed_attempts = 5` y `locked_until` futuro, que bloquea aun con la IP limpia; una activación legítima no gasta cupo extra; y (8j/8k) tras 4 errores + 1 acierto en `check_activation_code`, el paso 2 no bloquea al usuario | El rate limiting ya no se esquiva llamando a la RPC directamente, y no frena a quien tiene un código bueno — ver hallazgo "cupo de IP en el paso 2" |
| 9 | Un código emitido como `"  EMAIL  "` lo canjea el usuario con `email` | El admin puede teclear el email con mayúsculas o espacios |
| 10 (×4) | Tras borrar la policy UPDATE no-admin: un miembro no puede marcar como usado un código pendiente de su grupo; el admin sigue editando nombre/email (`AdminScreen.handleSavePending`) y cancelando (DELETE, `AdminScreen` y `Members.jsx`) | El único UPDATE de cliente sobre `activation_codes` que queda es el del admin |

### Fase 9 — `test-09-aislamiento.js` (72 tests)

Aislamiento de la API pública tras el cierre de seguridad del 2026-09-28
(`sql/2026-09-28c`–`h`, `docs/security-inventory-2026-09-28.md`). Convierte en
tests la verificación que ese día se hizo a mano con dos empresas `zztest-`.
Cada bloqueo lleva su control positivo: 0 filas solo demuestra algo si el dueño
sí las ve.

| Test | Qué verifica | Por qué importa |
|---|---|---|
| 1 (×14) | Sin sesión (solo anon key), ninguna de las 14 tablas de `public` se puede leer (`permission denied`) | Antes se leían sin sesión `habits`, `habit_logs` (con `photo_url` y notas), asignaciones, validadores, recompensas, categorías e invitaciones |
| 2 (×16) | Sin sesión no se ejecuta ninguna función (14) salvo `check_activation_code` y `keepalive()` (controles; `keepalive` devuelve 1) | Antes todas salvo las dos RPCs de alta eran ejecutables por anon. `keepalive()` (añadida el 2026-09-29, `sql/2026-09-29_keepalive.sql`) es el ping del workflow anti-pausa: `SECURITY INVOKER`, no lee ni escribe ninguna tabla |
| 3 (×22) | Un miembro de B no lee de A ninguna de 11 tablas (hábitos, logs, asignaciones, validadores, recompensas, validaciones, categorías, profiles, companies, códigos, team_members); controles: el miembro de A sí lee las suyas, el admin de A sus códigos, y B las categorías predefinidas | Aislamiento entre empresas, que hasta el 2026-09-28 dependía de filtrar en el cliente |
| 4 (×4) | `check_habit_limit` / `check_member_limit` de otra empresa → `forbidden`; `get_company_plan_info` → vacío; control: el plan propio sí | Antes respondían para cualquier empresa, incluso sin sesión |
| 5 (×5) | Storage: B no ve la carpeta del miembro de A en la raíz, ni lista sus fotos ni su avatar; controles: el admin de A sí lista ambos | Antes cualquier autenticado listaba todo el bucket |
| 6 (×2) **[CONOCIDO]** | B descarga la foto de A con la ruta conocida y la URL pública se abre sin sesión (HTTP 200) | **No es un fallo:** límite aceptado de la opción 1 de Storage (buckets públicos; `download()` de un bucket público no aplica RLS). Sin poder listar ni leer las tablas, la ruta no se puede descubrir. Si se aplica la opción 2 (buckets privados + URLs firmadas) estos dos checks fallarán y habrá que invertirlos |
| 7 (×2) | `delete_member` sobre uno mismo → `use_delete_own_account`; el admin sigue existiendo | Evita saltarse la regla de "único admin" de `delete_own_account` |
| 8 (×3) | `update_member_profile` con `new_role='superadmin'` → `invalid_role` y el rol no cambia; el UPDATE directo tampoco (CHECK `profiles_role_check`) | Antes aceptaba cualquier texto como rol |
| 9 (×4) | `update_member_avatar` rechaza otra URL de dominio y la carpeta de otro usuario (`invalid_avatar_url`), acepta `avatars/<miembro>/` (control); el UPDATE directo del propio usuario con una URL ajena lo frena el CHECK | Antes aceptaba cualquier URL |

**Fuera de esta fase, a propósito** (pendientes de aprobación aparte, ver
`docs/release.md`): el `upsert` del admin sobre el avatar ya existente de un
miembro (hoy falla por RLS, anterior al 2026-09-28) y la limpieza de Storage al
borrar un miembro.

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
sus queries de borrado — **además** comprueba el email en `auth.users` de cada
usuario que va a borrar de Auth (desde el 2026-09-28, ver la sección
destacada sobre la barrera) y relee cada company y cada profile que va a
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

**`resetActivationRateLimit()` (usada desde la Fase 5):** misma limpieza
incondicional de `activation_attempts` que hace `cleanupTestData()`, expuesta
aparte para poder resetear el contador de rate limiting **varias veces
durante una misma ejecución** sin llamar a la limpieza completa (que borraría
también las companies/profiles que esa prueba todavía necesita). Hizo falta
porque la Fase 5 encadena muchas más llamadas a `check_activation_code` en un
solo run que las fases anteriores — ver el hallazgo correspondiente en el
punto 7.

**Usuarios huérfanos en `auth.users`:** `cleanupTestData()` también lista
`auth.users` directamente (no solo a través de `profiles`) y borra cualquiera
con email `zztest-%` que no tenga ya una fila en `profiles`. Hace falta
porque `joinAsTestMember()` crea el `auth.user` (vía Admin API) **antes** de
llamar a `handle_activation_registration`, y si esa RPC falla (por ejemplo,
`limit_members_reached`, el escenario que fuerza a propósito el test 4 de la
Fase 5) el `auth.user` queda creado pero sin ningún `profiles` asociado — la
barrera de seguridad normal (que parte de `profiles.email`) nunca lo
encontraría.

## 6. Huecos conocidos, pendientes

### `check_habit_limit` sin backstop de servidor — DECISIÓN DE PRODUCTO PENDIENTE

**Estado: pendiente de decisión, no implementado.** El hallazgo está en el
punto 7 (Fase 5): `check_habit_limit` es enforcement de cliente únicamente,
sin ninguna comprobación equivalente a nivel de RLS/trigger en la tabla
`habits` — a diferencia de `check_member_limit`, que sí tiene un backstop
real dentro de `handle_activation_registration`. No se ha implementado un
trigger similar al de la Fase 4 (escalada de privilegios) porque, a
diferencia de aquel caso, esto no es una vulnerabilidad de seguridad — es una
inconsistencia de robustez entre dos límites de plan que debería resolverse
como decisión de producto (¿merece la pena el mismo nivel de protección que
`check_member_limit`, dado que solo lo explotaría un cliente que se salte la
propia app?), no como fix unilateral de esta sesión de tests. Referenciado
también desde una conversación con Claude (no visible desde aquí) como
paralelo a otro caso pendiente ("hábitos personales") que no se ha
encontrado documentado en este repo — no se puede confirmar esa paridad.

**Debilidad del test que lo demuestra (anotada el 2026-09-29, sin cambiar):**
el test 2c de la Fase 5 hace el INSERT del hábito nº `max+1` con la Service
Role Key, que se salta RLS por definición — así que prueba que "la base de
datos no tiene un trigger/constraint que cuente hábitos", pero no que un admin
autenticado pueda saltarse el límite por la API. Hacerlo como el admin de
prueba lo demostraría con más rigor; no se cambió en la tarea del 2026-09-29
(que solo tocaba las llamadas a `check_habit_limit`).

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

### Panel de administración web (Fase 5, excluido a propósito)

`Admin.jsx`/`MemberDetail.jsx` (exclusivos del plan `'empresa'`) no se
testean en ningún fichero de `tests/` — son una SPA, no backend puro, y
requerirían decidir cómo automatizar el acceso a una interfaz web (login,
navegación, aserciones sobre el DOM). Candidato natural para cuando se
aborde testing de la web con una herramienta tipo Playwright, tal como se
apuntó en la conversación original — no se ha intentado nada aquí.

### `advanced_stats` (Fase 5, sin nada que testear)

Confirmado en `business.md`: el campo está declarado (`plan_limits.
advanced_stats`, expuesto por `usePlanInfo.js`) pero **ninguna pantalla lo
consume condicionalmente todavía** — no hay ninguna lógica real, de cliente
ni de servidor, que dependa de su valor. No hay nada que un test pueda
verificar hasta que exista esa lógica.

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

**RESUELTO el 2026-09-30, tras un caso real.** La premisa de arriba era falsa
para la app: `AdminScreen.js` **nunca** hizo excluyentes las dos listas
(`toggleMember` y `toggleValidator` eran independientes). Luis creó un
hábito con Lucia asignada y también validadora; como `ValidateHabitScreen`
excluye los logs propios y el fallback del admin solo cubre hábitos sin
ningún validador, nadie podía validarlo. La web (`Habits.jsx`) sí era
excluyente al crear, pero no al editar. Cerrado en tres capas:
- **Base de datos:** `sql/2026-09-30_asignado_no_validador.sql` — un trigger
  `BEFORE INSERT OR UPDATE` en `habit_assignments` y otro en
  `habit_validators` (función `prevent_assignee_as_validator`,
  `SECURITY DEFINER`, con bloqueo por pareja hábito-persona) rechazan la
  misma persona en las dos tablas para el mismo hábito, en cualquier orden y
  también al editar. Error `check_violation` con mensaje legible.
- **App:** `AdminScreen.js` no deja marcar a la misma persona en las dos
  listas (aviso traducido `admin.assignee_validator_conflict`), marca en gris
  a quien ya está en la otra lista, traduce el error de la base y, al
  editar, borra las dos listas **antes** de insertar (si no, intercambiar los
  papeles de dos personas lo rechazaría el trigger). **Llega a los usuarios de
  TestFlight con el build 4**: el proyecto no tiene `expo-updates`.
- **Web:** `Habits.jsx` aplica también en la edición la misma exclusión que
  ya tenía la creación.
El test 8 se invirtió y cubre los casos A-D más UPDATE y Service Role Key.

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

### Fase 5 — `check_habit_limit` no tiene backstop de servidor (a diferencia de `check_member_limit`)

**Se esperaba:** que los "3 puntos de enforcement" que menciona `business.md`
(crear hábito, generar código, activar cuenta) tuvieran una robustez
equivalente entre sí — el enunciado original pedía confirmar cada uno por
separado precisamente para no asumir esto.

**Se encontró:** son asimétricos. `check_habit_limit` se llama en
`AdminScreen.js:450` y `Habits.jsx:514` (web) **antes** del INSERT en
`habits`, pero la policy RLS de esa tabla (`is_admin() AND company_id =
my_company_id()`) no comprueba ningún conteo — nada en la base de datos
impide insertar el hábito nº 11 si se llama a la API directamente saltándose
la RPC. `check_member_limit`, en cambio, tiene un backstop real: además del
mismo tipo de chequeo de cliente (`AdminScreen.js:685`, `Members.jsx:68`),
`handle_activation_registration` vuelve a llamar a `check_member_limit`
**dentro** de la RPC de registro y lanza `RAISE EXCEPTION
'limit_members_reached'` antes de insertar el profile — ese sí es
inevitable, ocurre en el único camino real de alta de un miembro. El test 2
de la Fase 5 confirma la ausencia de backstop en hábitos insertando
directamente el hábito por encima del límite y comprobando que tiene éxito;
el test 4 confirma la presencia del backstop en miembros forzando el
escenario en que el chequeo de cliente ya había dado luz verde y el de
servidor bloquea igualmente la activación.

### Fase 5 — `history_days` es filtro de cliente puro, igual que `photo_required`

**Se esperaba:** confirmar si `history_days` tiene algún enforcement de
servidor o es solo un filtro de UI, tal como ya sugería `business.md`.

**Se encontró:** confirmado que es 100% cliente — la query real a
`habit_logs` en `ProfileScreen.js`/`HabitStatsScreen.js` no lleva ningún
filtro de fecha (trae el historial completo), y el recorte
(`logs.filter(l => new Date(l.created_at) >= cutoff)`) ocurre después, en JS
(`ProfileScreen.js:310`, `HabitStatsScreen.js:318`). A diferencia de
`photo_required` (Fase 2), aquí sí se decidió testear la fórmula replicada
(test 6 de la Fase 5) en vez de dejarlo solo como hueco documentado — sirve
para atrapar una regresión real en el cálculo del `cutoff`, aunque no sea
"enforcement" en sentido estricto.

### Fase 6 — un hábito puede quedarse sin ningún validador

**Se pidió explícitamente no prejuzgar** si este comportamiento es correcto
o incorrecto, solo documentarlo tal como es.

**Se encontró:** si el único `habit_validators` de un hábito se borra a sí
mismo, el hábito se queda con 0 validadores — sigue existiendo, los usuarios
asignados pueden seguir completándolo con normalidad (`habit_assignments` no
se toca), pero **nadie puede validar sus fotos** hasta que un admin entre y
asigne un validador nuevo manualmente desde `AdminScreen.js`/`Habits.jsx`
(no hay ninguna notificación ni aviso automático de que esto ha pasado). No
hay ninguna protección equivalente a la de "único admin" — borrarse como
único validador nunca se rechaza.

**RESUELTO (misma fase, decisión de producto siguiente):** en vez de impedir
el borrado o avisar, se optó por un fallback de validador — si un hábito
tiene 0 filas en `habit_validators`, el admin de esa empresa lo ve como
pendiente de validar en `ValidateHabitScreen.js`, sin insertar nada en
`habit_validators` (es una regla de consulta, no una asignación explícita).
Implementado en el cliente (`ValidateHabitScreen.js`, 2 queries adicionales
solo cuando `role='admin'`, mismo patrón "trae ancho, filtra en JS" que ya
usa el resto de la app — no se creó una función/vista nueva en Supabase por
no ser una lógica lo bastante compleja como para justificarlo).

Al revisar si "arreglar solo la pantalla" bastaba, se encontró que **no**:
la policy INSERT de `habit_validations` era `WITH CHECK (auth.uid() =
validator_id)` — sin más. Nunca comprobó pertenencia a `habit_validators`
NI a la empresa; cualquier autenticado de cualquier empresa podía insertar
una validación sobre el log de cualquier otra. Es un hueco de RLS
preexistente, sin relación directa con el borrado de cuenta, expuesto al
diseñar este fallback. Corregido en el mismo SQL que añade la regla:
ahora exige `company_id` propio Y (ser validador explícito O ser admin
con 0 validadores explícitos para ese hábito). Verificado con los 4 casos
del test 5 extendido (5e-5h): el admin ve y puede validar el log de
fallback; un admin de otra empresa no lo ve y, además, ya no puede
insertarlo tampoco (antes sí podía).

### Fase 7 — `habitapp://reset-password` no estaba registrada como Redirect URL

**Se encontró (2026-09-18), verificado empíricamente y no por suposición:**
al implementar el flujo de recuperación de contraseña, generar un enlace de
recovery real con `redirectTo: 'habitapp://reset-password'` vía la Admin API
mostró que Supabase ignoraba ese `redirectTo` en silencio (sin ningún error)
y devolvía el Site URL por defecto (`http://localhost:3000`) en su lugar —
señal inequívoca de que esa URL todavía no estaba en la lista de
Authentication → URL Configuration → Redirect URLs del dashboard. Con esa
lista sin actualizar, el enlace real que le habría llegado a un usuario por
correo no habría abierto la app en ningún caso.

**Cerrado en la misma sesión** (siguiendo la regla de `workflow.md` de
evaluar cerrar los hallazgos en vez de solo documentarlos): se añadió el
test 0 de `test-07-recuperacion.js` como comprobación explícita de este
requisito — falló primero (13/14, confirmando el hallazgo con un test real,
no solo con el script ad-hoc de verificación), Luis añadió la Redirect URL
en el dashboard, y el test pasó a verde (14/14) sin cambiar nada más. El
test se mantiene como guarda de regresión permanente: si esa entrada se
borra o se rota el scheme algún día sin actualizarla, este test lo detecta
antes que un usuario real con un enlace muerto.

---

## Resumen — catálogo completo de tests (Fases 0 a 9)

El catálogo original de 6 fases planificadas se cerró con la Fase 6; la Fase 7
(recuperación de contraseña) se añadió después, siguiendo la misma regla de
`workflow.md` de evaluar cobertura de tests ante cualquier funcionalidad
nueva. Índice para quien llegue a este documento por primera vez:

| Fase | Fichero | Tests | Tema |
|---|---|---|---|
| 0 | `test-00-barrera-limpieza.js` | 12 | Canario de la barrera de `cleanupTestData()` (usuario sin prefijo, sin profile y miembro de una company de test; desfase de email imposible) |
| 1 | `test-01-alta.js` | 8 | Alta de admin y de miembro, condición real de "family setup" |
| 2 | `test-02-habitos.js` | 19 | Hábitos, asignación, validadores (RLS) |
| 3 | `test-03-rachas.js` | 18 | Rachas y recompensas (`calculateStreak`/`calculateTotalCompleted`, recursividad, `featuredReward`) |
| 4 | `test-04-permisos.js` | 14 | Permisos de `profiles` y aislamiento entre empresas |
| 5 | `test-05-limites.js` | 11 | Límites de plan (`plan_limits`, `check_member_limit`, `check_habit_limit`, `history_days`) |
| 6 | `test-06-borrado.js` | 25 | Borrado de cuenta (`delete_own_account`), único admin, cascada sin anonimizar, fallback de validador |
| 7 | `test-07-recuperacion.js` | 14 | Recuperación de contraseña (`generateLink`, `verifyOtp`, `updateUser`, parser real del deep link) |
| 8 | `test-08-registro-seguro.js` | 42 | Registro seguro (`auth.uid()`, email de `auth.users`, código ligado a email y marcado atómico, rate limiting en llamada directa) |
| 9 | `test-09-aislamiento.js` | 72 | Aislamiento de la API pública: anon, entre empresas, Storage, RPCs de gestión de miembros |
| **Total** | **10 ficheros** | **235** | |

**Fixes críticos aplicados directamente a producción durante el proceso**
(no solo hallazgos documentados — cambios reales de SQL en Supabase, todos
verificados contra la base de datos real antes de darlos por buenos):

1. **Rate limiting en `check_activation_code`** (por código + por IP) — antes no existía ningún límite de intentos para adivinar un código de activación de 6 dígitos.
2. **Escalada de privilegios en `profiles`** (🔴 crítico, 2026-09-17) — cualquier usuario autenticado podía autoascenderse a admin o saltar a otra empresa con un simple `UPDATE` sobre su propia fila; sin trigger ni grant que lo impidiera. Ver la sección destacada al principio de este documento.
3. **`delete_own_account()` bloquea el borrado del único admin** de un grupo (Fase 6) — antes el grupo podía quedarse sin ningún admin para siempre.
4. **Dos FKs corregidas de `NO ACTION` a `SET NULL`** (`habit_logs.validated_by`, `invitations.created_by`) — antes podían bloquear con un error crudo de Postgres el borrado de cualquier perfil referenciado ahí, tanto en `delete_member` como en `delete_own_account`.
5. **Aislamiento multi-tenant cerrado en `habit_validations` INSERT** (Fase 6, tras cerrar el catálogo) — la policy nunca comprobó empresa ni pertenencia a `habit_validators`; cualquier autenticado de cualquier empresa podía validar el log de cualquier otra. Cerrado en el mismo cambio que añade el fallback de validador (admin de la empresa cuando un hábito se queda sin ninguno).
6. **RPCs de alta cerradas a `anon` y ligadas a `auth.uid()`** (Fase 8, 2026-09-28) — ver la sección destacada al principio de este documento.

**Hallazgos documentados, sin fix aplicado** (por ser diseño intencional ya
aceptado, decisión de producto pendiente, o fuera del alcance de estos
tests): la condición real de "family setup" depende de hábitos activos y no
del nº de miembros (Fase 1); `habit_assignments` no exige admin pero
`habit_validators` sí (Fase 2); `calculateHabitStreak` se movió/corrigió a
`HabitDetailScreen.js` en otra tarea de esta sesión (Fase 3); "conseguida"
es cálculo de cliente puro sin persistencia (Fase 3); `featuredReward` no
elige por `streak_target` menor sino por `daysToNext` menor (Fase 3);
`habits` SELECT es de lectura abierta entre empresas por diseño (Fase 4);
`check_habit_limit` no tiene backstop de servidor — **decisión de producto
pendiente** (Fase 5); `history_days` es filtro de cliente puro (Fase 5). Un
hábito que se queda sin ningún validador (Fase 6) ya no está en esta lista:
se resolvió con el fallback de validador (ver fix nº 5 arriba).

**Huecos conocidos, no testeados aquí**: `authFlags.skipNextRedirect`
(timing de cliente, Fase 1), `photo_required` (Fase 2), panel de
administración web y `advanced_stats` (Fase 5) — todos candidatos para
testing de UI (Maestro/Playwright) si se aborda en el futuro, no para este
catálogo de tests de backend.
