# Tests de backend — HabitApp

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
