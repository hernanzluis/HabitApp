# Inventario de seguridad de la API pública — 2026-09-28

Qué quedaba abierto en la API de Supabase antes de abrir el registro a
desconocidos, y cómo se cerró.

## ✅ Estado: APLICADO el 2026-09-28

Con aprobación expresa de Luis en el chat (Storage opción 1, borrar los
ficheros huérfanos, eliminar `invitations`):

1. **Copia de seguridad** previa en `~/habitapp-backups/2026-09-28-pre-seguridad/`
   (fuera del repo): esquema y datos de `public`, volcado `pg_restore`,
   policies/buckets/índice de Storage, default privileges, y copia de los 80
   ficheros huérfanos.
2. **Ensayo** de los seis SQL en una sola transacción con `ROLLBACK`: sin
   errores, incluidos el trigger y la FK sobre `auth.users`.
3. **Aplicados**, cada uno en su transacción y verificados en el catálogo:
   `sql/2026-09-28c_funciones.sql`, `d_grants_tablas`, `e_lecturas_por_empresa`,
   `f_storage` (opción 1), `g_fk_profiles_auth` y `h_drop_invitations`.
4. **Ficheros huérfanos borrados** con la API de Storage: 69 fotos + 11 avatares
   de 11 usuarios inexistentes (antes 69/11, después 0/0; ninguno de la cuenta
   de Luis).
5. **Verificación** con dos empresas `zztest-` (91/93, ver "Resultado tras
   aplicar" al final) y una ronda de las fases 0-8 (fallos esperados, listados
   al final). Barrido: 0 restos.

Lo que sigue describe el estado **anterior** a la aplicación (el inventario)
y las propuestas tal como se aprobaron.

## Método y qué se comprobó de verdad

| | Cómo | Estado |
|---|---|---|
| Cuerpos de las 15 funciones, `SECURITY DEFINER`, `search_path`, EXECUTE de anon/authenticated/public | `pg_get_functiondef`, `has_function_privilege`, `aclexplode` por psql (usuario `postgres`) | ✅ Leído de la BD |
| Policies de `public` y `storage.objects`, RLS por tabla, buckets, constraints y FKs de `profiles`, triggers, grants de tabla y default privileges | `pg_policies`, `pg_class`, `storage.buckets`, `pg_constraint`, `information_schema`, `pg_default_acl` | ✅ Leído de la BD |
| Lecturas sin sesión y entre empresas, funciones informativas | Script fuera de `tests/` con dos empresas `zztest-` (A víctima, B atacante), cliente anon real y cliente autenticado real de B | ✅ Demostrado (sección B2) |
| Barrido de residuos tras la demo | Tablas, Auth y Storage | ✅ 0 restos `zztest-`; script borrado |
| Consultas reales de la app y de habitteam-web | grep de `.from(`, `.rpc(`, Storage y render de `photo_url`/`avatar_url` + lectura de las consultas dudosas y de los botones de eliminar miembro | ✅ Revisado (sección B3) |
| SQL propuestos | Escritos, **no ejecutados** | ⚠️ Sintaxis y efecto sin verificar contra la BD |

**No se demostró** (por decisión de alcance, solo se analizó el código): la
explotación de `handle_invited_user_registration`, la auto-eliminación de un
admin con `delete_member`, ni `update_member_profile`/`update_member_avatar`
con valores arbitrarios. Las conclusiones de esas filas salen de leer sus
cuerpos, no de ejecutarlas.

---

## A. Funciones

### A1. Estado

Todas las funciones de `public` son `SECURITY DEFINER`. Todas salvo las dos
RPCs de alta (cerradas el 2026-09-28) son ejecutables por `anon` y `public`.

| Función | Llamada desde | `auth.uid()` | Rol admin | Misma empresa | `search_path` | Con solo la anon key |
|---|---|---|---|---|---|---|
| `handle_invited_user_registration` | **Nadie** (discontinuada) | ❌ | ❌ | — | ❌ | Crear un profile `usuario` en cualquier empresa que tenga una fila en `invitations` (legible por anon), con cualquier `user_id` y email. Hoy `invitations` está vacía. **Eliminar.** |
| `check_habit_limit` | AdminScreen, Habits.jsx | ❌ | ❌ | ❌ | ❌ | Saber si cualquier empresa está en su límite de hábitos (**demostrado**: `true` para A desde anon y desde B) |
| `check_member_limit` | AdminScreen, Members.jsx, `handle_activation_registration` | ❌ | ❌ | ❌ | ❌ | Ídem con miembros (**demostrado**: `true`) |
| `get_company_plan_info` | `lib/usePlanInfo.js` | ❌ | ❌ | ❌ | ❌ | Plan y límites de cualquier empresa (**demostrado**: `familiar`, 30 días, 6 miembros, 10 hábitos). Los ids de empresa salían de `habits`, legible sin sesión |
| `delete_member` | AdminScreen, Members.jsx | ✅ | ✅ | ✅ | ❌ | Nada. Hueco lateral: `member_id = auth.uid()` está permitido → un admin se borra a sí mismo sin la regla de "único admin" de `delete_own_account` |
| `update_member_profile` | **Nadie** (la edición es UPDATE directo) | ✅ | ✅ | ✅ | ❌ | Nada. Pero no valida `new_role` (cualquier texto) y escribe `profiles.email` sin tocar Auth (desincroniza) |
| `update_member_avatar` | AdminScreen | ✅ | ✅ | ✅ | ❌ | Nada. Acepta cualquier URL (el propio usuario también puede, con UPDATE directo de su `avatar_url`) |
| `delete_expired_habit` | ValidateHabitScreen | ✅ | — (validador o asignado) | ✅ implícito | ❌ | Nada |
| `delete_own_account` | ProfileScreen | ✅ | — | — | ✅ | Nada |
| `check_activation_code` | SignUpScreen (antes del signUp) | — | — | — | ✅ | Por diseño: validar un código de 6 dígitos, con rate limiting. **Debe seguir accesible a anon** |
| `is_admin`, `my_company_id` | Policies | ✅ | — | — | ✅ | Devuelven `false`/`null` sin sesión |
| `prevent_self_role_company_escalation` | Trigger | — | — | — | ✅ | No invocable como RPC (función de trigger) |
| `handle_new_user_registration`, `handle_activation_registration` | SignUpScreen | ✅ | — | ✅ | ✅ | Nada (cerradas el 2026-09-28) |

### A2. Privilegios de tabla

`anon` y `authenticated` tienen **SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES y TRIGGER en las 15 tablas** de `public`, por los default
privileges de Supabase (que además se aplicarán a toda tabla y función
futura). `TRUNCATE` no pasa por RLS; PostgREST no lo expone, pero sobra.
Ninguna consulta de la app ni de la web usa tablas sin sesión.

### A3. Propuesta — `sql/2026-09-28c_funciones.sql` y `sql/2026-09-28d_grants_tablas.sql`

- Eliminar `handle_invited_user_registration`.
- `check_habit_limit`, `get_company_plan_info`: solo la empresa propia.
  `check_member_limit`: ídem, salvo si el llamante aún no tiene profile (lo
  necesita `handle_activation_registration` durante el alta).
- `delete_member`: rechaza `member_id = auth.uid()` (`use_delete_own_account`).
- `update_member_profile`: `new_role ∈ {admin, usuario}`; `new_email` se ignora.
- `update_member_avatar`: URL solo de `avatars/<member_id>/…` del proyecto.
- Integridad de `profiles` para **todos** los caminos (RPC y UPDATE directo):
  `CHECK role`, `CHECK avatar_url`, y triggers que mantienen `profiles.email`
  igual al de `auth.users` en los dos sentidos. Datos actuales conformes: 1
  profile `admin`, `avatar_url` null, 0 emails desincronizados, 0
  `photo_url` fuera del bucket propio.
- `search_path = public, pg_temp` en todas.
- EXECUTE revocado a `public` y `anon` en todas salvo `check_activation_code`;
  default privileges para que las funciones futuras nazcan sin anon.
- Tablas: `anon` sin ningún privilegio; `authenticated` sin
  TRUNCATE/REFERENCES/TRIGGER, y sin acceso a `activation_attempts` ni
  `plan_limits` (solo vía funciones); default privileges ajustados.

---

## B. Lecturas entre empresas

### B1. Policies SELECT actuales

| Tabla | Policy SELECT | Roles | Lectura real |
|---|---|---|---|
| `habits` | `true` | public | **Todo, sin sesión** |
| `habit_logs` | `true` | public | **Todo, sin sesión** (incluye `photo_url` y `notes`) |
| `habit_assignments` | `true` | public | **Todo, sin sesión** |
| `habit_validators` | `true` | public | **Todo, sin sesión** |
| `habit_rewards` | `true` | public | **Todo, sin sesión** |
| `categories` | `true` | public | **Todo, sin sesión** |
| `invitations` | `true` | anon, authenticated | **Todo, sin sesión** (códigos) |
| `habit_validations` | `true` | authenticated | Cualquier autenticado, todas las empresas |
| `team_members` | `true` | authenticated | Cualquier autenticado, todas las empresas |
| `teams` | `auth.uid() = created_by` | public | Solo las propias |
| `profiles` | propio o `company_id = my_company_id()` | public | Acotada ✅ |
| `companies` | `id = my_company_id()` | public | Acotada ✅ |
| `activation_codes` | admin y empresa propia | public | Acotada ✅ |
| `plan_limits`, `activation_attempts` | sin policies (RLS activo) | — | Nadie directamente ✅ |
| `storage.objects` | `bucket_id = 'avatars'` / `'habit-photos'` | authenticated | **Cualquier autenticado lista y descarga todo** |

Buckets `avatars` y `habit-photos`: **públicos** (sin límite de tamaño ni de
tipo MIME). Rutas: `<user_id>/avatar.jpg` y `<user_id>/<habit_id>/<ts>.jpg`.

### B2. Demostración (datos `zztest-`, empresas A y B)

**Sin sesión (solo anon key)** sobre la empresa A:

| Qué | Resultado |
|---|---|
| `habits` de A | ✅ leído (id, título, `company_id`) |
| `habit_logs` de A | ✅ leído: `user_id`, **`photo_url` completa** y **`notes`** privadas |
| `habit_assignments`, `habit_validators` de A | ✅ leídos (quién hace y quién valida cada hábito) |
| `habit_rewards` de A | ✅ leído (descripción de la recompensa) |
| `categories` de A | ✅ leída la categoría personalizada |
| `invitations` de A | ✅ leído **el código de invitación** |
| GET de la `photo_url` sin ninguna cabecera | **HTTP 200** |
| Listar `habit-photos` | vacío (anon no lista) |
| `profiles`, `activation_codes` de A (control) | vacío ✅ |

**Como usuario autenticado de B** sobre A:

| Qué | Resultado |
|---|---|
| `habit_validations` de A | ✅ leído (validador, estado y **comentario**) |
| `team_members` de A | ✅ leído |
| Listar raíz de `habit-photos` | ✅ **lista las carpetas de todos los usuarios**, no solo de A |
| Listar `habit-photos/<A1>/<habit>` y `avatars/<A1>` | ✅ nombres, tamaños y fechas de los ficheros |
| Descargar la foto de A1 por API autenticada | ✅ OK |
| `profiles`, `companies`, `activation_codes` de A (control) | vacío ✅ |

**Funciones informativas con el id de A**, desde anon y desde B:
`check_habit_limit` → `true`, `check_member_limit` → `true`,
`get_company_plan_info` → `familiar, 30, false, 6, 10`.

**Hallazgo colateral — ficheros huérfanos:** cada bucket tiene 11 carpetas de
usuarios que **ya no existen** en `auth.users`: 69 fotos de hábitos y 11
avatares, públicos por URL y listables por cualquier autenticado.
`delete_member`, `delete_own_account` y `wipe-auth-users.js` no limpian
Storage. Borrarlos es borrar datos: pendiente de decisión de Luis (se haría con
la API de Storage, no con DELETE sobre `storage.objects`).

### B3. Qué se rompería con las policies propuestas

Revisadas todas las consultas de la app (`screens/`, `navigation/`, `lib/`) y
de habitteam-web (`src/pages`, `src/components/admin`):

- **Ninguna consulta necesita filas de otra empresa.** Todas filtran por
  `company_id` propio o por ids que salen de la propia empresa
  (`HomeScreen` `.eq('company_id', …).in('id', assignedIds)`;
  `ValidateHabitScreen` y `RootNavigator` `.in('id', allRelevantIds)` con ids
  de asignaciones/validaciones propias; `MemberDetail.jsx` por `user_id` de un
  miembro de la empresa).
- **Nada se consulta sin sesión.** El alta usa RPCs; en la web solo
  `/acceder`, `/admin` y `/admin/miembro/:userId` usan Supabase, y tras login.
  La landing y las páginas legales no consultan nada.
- **`categories`**: las predefinidas (`company_id` null) siguen legibles.
- **Tests:** la Fase 4, test 5 ("un admin de A SÍ lee los habits de B")
  fallará a propósito → invertirlo en la tarea de tests posterior.

Cambios de comportamiento que **sí** requieren tocar la UI:

| Cambio | Afecta a | Qué hacer |
|---|---|---|
| `profiles.email` sincronizado con Auth (trigger) | Modal de editar miembro de `AdminScreen.js` (`updatePayload.email`, ~línea 816) | El cambio de email dejaría de tener efecto sin avisar: quitar el campo email del modal o mostrarlo como solo lectura. (`Members.jsx` solo cambia `role`: sin impacto.) El email del **código pendiente** (`activation_codes`) no se ve afectado |
| `delete_member` rechaza auto-borrado | AdminScreen, Members.jsx | Sin impacto: las dos UIs ya ocultan "Eliminar" para uno mismo (`AdminScreen.js:1907`, `editingMember.id !== currentUserId`; `Members.jsx:203`, `m.id !== adminId`). El cambio solo cierra la llamada directa a la API |
| `check_*`/`get_company_plan_info` solo empresa propia | `usePlanInfo`, AdminScreen, Habits.jsx, Members.jsx | Sin impacto: siempre pasan el `company_id` propio |
| Storage opción 2 (buckets privados) | App: Home, Ranking, ValidateHabit, HabitStats, HabitDetail, Profile, Admin, RootNavigator. Web: Activity.jsx, Habits.jsx, MemberDetail.jsx | Guardar rutas y firmar URLs en lote. Ver `sql/2026-09-28f_storage.sql` |

### B4. Propuesta — `sql/2026-09-28e_lecturas_por_empresa.sql` y `sql/2026-09-28f_storage.sql`

- SELECT `to authenticated` en todas: `habits` por `company_id`; tablas hijas
  (`habit_logs`, `habit_assignments`, `habit_validators`, `habit_rewards`) con
  `is_my_company_habit(habit_id)`; `habit_validations` con
  `is_my_company_log(habit_log_id)`; `categories` null o propia;
  `invitations` solo admin propio; `team_members` por el `company_id` del team.
  Los helpers son `SECURITY DEFINER` para evitar RLS anidado.
- `profiles`, `companies`, `activation_codes`: misma condición, pasadas a
  `to authenticated`.
- `plan_limits`: sin cambios (solo vía funciones).
- **Storage**, elegir una:

| Opción | Cierra | No cierra | Esfuerzo |
|---|---|---|---|
| **1. Públicos + listar/leer solo carpetas de la propia empresa** (recomendada v1, **aplicada**) | **Listar** ficheros ajenos por la API | Una ruta ya conocida se abre sin sesión para siempre, por URL pública **o por `download()` de la API** (corregido tras aplicar: en un bucket público el endpoint de descarga no aplica RLS). Con B aplicado, las rutas ya no se filtran por la API | ~1 h, sin cambios de código |
| **2. Privados + URLs firmadas** | Todo lo anterior + acceso sin sesión + URLs filtradas caducan | — | 1,5-2,5 días (11 pantallas/componentes + migración de URLs a rutas) |

---

## C. FK `profiles.id` → `auth.users(id)` ON DELETE CASCADE

- Estado: `profiles` solo tiene la PK; `id` tiene `DEFAULT gen_random_uuid()`
  (permitió crear profiles sin usuario de Auth el 2026-09-28); **0 profiles
  huérfanos**; único trigger en `profiles`: el de escalada de privilegios.
- `delete_own_account` y `delete_member`: siguen igual (borran profile y luego
  Auth).
- `cleanupTestData()`: sin cambios (borra profiles antes que Auth). Solo
  `test-00` inserta profiles directamente, para un usuario de Auth existente.
- Nuevo efecto: borrar un usuario desde el dashboard o con
  `auth.admin.deleteUser` borra su profile y, en cascada, sus logs,
  asignaciones, validaciones y membresías. Storage sigue sin limpiarse.
- Propuesta: `sql/2026-09-28g_fk_profiles_auth.sql` (quita el default y añade
  la FK).

---

## Orden de aplicación propuesto y pendientes

1. `2026-09-28c_funciones.sql` → `d_grants_tablas` → `e_lecturas_por_empresa`
   → `f_storage` (opción elegida) → `g_fk_profiles_auth`. Cada fichero es una
   transacción y termina con una consulta de comprobación.
2. En el mismo cambio: quitar el email editable del modal de miembro
   (AdminScreen).
3. Tests (tarea posterior, tras la revisión de Luis): invertir la Fase 4,
   test 5, y nueva Fase 9 con las demostraciones de este informe como
   asserts (anon no lee nada, B no lee nada de A, Storage, funciones).
4. Decisiones de Luis: opción de Storage; borrar o no los 80 ficheros
   huérfanos; eliminar también la tabla `invitations` (sin uso).

### Sin verificar

- Ningún SQL propuesto se ha ejecutado: ni su sintaxis ni su efecto están
  comprobados contra la BD. En particular, que el usuario `postgres` pueda
  crear el trigger `on_auth_user_email_updated` sobre `auth.users`.
- Explotación real de `handle_invited_user_registration`, auto-borrado de admin
  con `delete_member` y valores arbitrarios en `update_member_profile` /
  `update_member_avatar` (analizado leyendo el código, no ejecutado).
- Rendimiento de las policies nuevas con volumen real (hoy la BD tiene 1
  usuario).
- Origen de los 80 ficheros huérfanos (probablemente cuentas borradas en
  pruebas anteriores; no comprobado).

---

## Resultado tras aplicar (2026-09-28)

### Verificación con dos empresas `zztest-` — 91/93

Bloqueado ✅: anon no lee ninguna tabla (`permission denied`) ni ejecuta
ninguna función salvo `check_activation_code`; B no lee de A validaciones,
`team_members`, hábitos, logs, asignaciones, validadores, recompensas,
categorías ni profiles; B no lista la carpeta de A1 ni en la raíz ni dentro;
`check_habit_limit`/`check_member_limit` de otra empresa → `forbidden`,
`get_company_plan_info` → vacío; `delete_member` sobre uno mismo →
`use_delete_own_account` (el admin sigue existiendo); rol no válido →
`invalid_role`; URL de avatar ajena → `invalid_avatar_url` (y el CHECK frena el
UPDATE directo); un UPDATE directo de `profiles.email` no lo desincroniza.

Legítimo ✅, por los caminos de la app: alta real con `signUp`,
`check_activation_code` sin sesión y activación con código; admin y miembro
leen todo lo suyo (incluidas las 8 categorías predefinidas); el miembro sube su
foto y registra el log con `photo_url`; avatar propio con `upsert` (dos veces)
y `UPDATE` de `avatar_url`; `update_member_avatar` con la URL del bucket; URLs
públicas de foto y avatar → HTTP 200.

Las 2 que no:
1. **B descarga la foto de A por la API si conoce la ruta** — propio de la
   opción 1 (bucket público), ver la corrección en la tabla de B4. Cerrarlo del
   todo es la opción 2.
2. **El admin no puede reemplazar el avatar YA existente de un miembro**
   (`upsert` → "new row violates row-level security policy"). **Anterior a este
   cambio:** la única policy UPDATE de `storage.objects` es "users can update
   own avatar", idéntica en el backup previo. Arreglarlo (policy UPDATE de admin
   para avatares de su empresa) necesita una aprobación nueva.

### Ronda de las fases 0-8 — tests que fallan

Ninguno por rotura de la app; todos por el cambio aplicado. No se ha
modificado `tests/` salvo quitar de `cleanupTestData()` el borrado de
`invitations` (4 líneas, autorizado por Luis: sin ello todas las fases fallaban
en la limpieza inicial).

| Fase / test | Causa | Qué hacer en la tarea de tests |
|---|---|---|
| 4, test 5 | Esperado: el admin de A ya no lee los habits de B | Invertirlo |
| 4, test 3 | Usa `avatar_url = 'https://example.com/…'`; el CHECK nuevo lo rechaza | Usar una URL del bucket `avatars/<id>/` |
| 5, tests 2a, 2b y 5 | Llaman a `check_habit_limit` con la Service Role Key (sin `auth.uid()` → `forbidden`). Como admin autenticado funciona (comprobado: `true`) | Llamarlo con el cliente del admin |
| 0, test 2a | El trigger de email hace imposible el desfase `profiles.email` ≠ `auth.users.email` que el canario simulaba; el canario sobrevive (2b, 2c ✓) | Reformular: comprobar que el desfase ya no se puede crear |
| 6 (25/25, pasa) | La comprobación de `invitations` del test 4 es vacía: la tabla no existe y el `count` sale nulo | Quitar `invitations` de la lista |
