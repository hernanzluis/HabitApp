# HabitApp — Base de datos

Supabase (PostgreSQL + Auth + Storage). RLS activado en todas las tablas.

**Regla de cambios de esquema:** todas las políticas RLS, tablas nuevas y cambios de esquema se hacen siempre mediante SQL Editor de Supabase, nunca desde la UI.

---

## Esquema de tablas

### `profiles`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | — | PK, FK → auth.users(id) |
| email | text | — | Email del usuario |
| full_name | text | — | Nombre completo |
| company_id | uuid | null | FK → companies(id) |
| role | text | — | 'admin' o 'usuario' (sin default a nivel de columna; lo fija cada RPC de alta) |
| avatar_url | text | null | URL pública en Storage bucket avatars |
| created_at | timestamptz | now() | — |

### `companies`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| name | text | — | Nombre de la empresa |
| logo_url | text | null | No implementado todavía |
| admin_id | uuid | — | FK → profiles(id) |
| created_at | timestamptz | now() | — |
| plan | text | 'familiar' | 'familiar', 'plus' o 'empresa' — ver [business.md](business.md#campos-añadidos-a-companies) |
| subscription_status | text | 'active' | 'active', 'past_due', 'canceled', 'trialing' |
| stripe_customer_id | text | null | Pendiente de integración Stripe |
| stripe_subscription_id | text | null | Pendiente de integración Stripe |
| plan_renews_at | timestamptz | null | Pendiente de integración Stripe |

### `habits`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| title | text | — | Nombre del hábito |
| description | text | null | Descripción opcional |
| company_id | uuid | — | FK → companies(id) |
| created_by | uuid | — | FK → profiles(id) |
| type | text | — | Tipo de hábito (libre) |
| recurrence | text | — | 'daily', 'weekly_x', 'monthly_x' o 'once' |
| is_active | boolean | true | Solo se muestran hábitos activos |
| created_at | timestamptz | now() | — |
| expires_at | timestamptz | null | Para hábitos 'once': fecha y hora límite combinadas. Si está en el pasado, no se muestra |
| due_time | time | null | Para hábitos 'daily': hora límite opcional. Si la hora actual la supera y el hábito no está completado, se muestra en naranja |
| team_id | uuid | null | FK → teams(id), nullable — sin uso activo todavía |
| photo_required | boolean | true | Si false, el usuario puede completar el hábito sin adjuntar foto |
| weekly_target | integer | null | Para hábitos 'weekly_x': número de veces por semana que debe completarse (1–7) |
| monthly_target | integer | null | Para hábitos 'monthly_x': número de veces por mes que debe completarse |
| category_id | uuid | null | FK → categories(id), nullable |

### `habit_assignments`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| habit_id | uuid | — | FK → habits(id) ON DELETE CASCADE |
| user_id | uuid | — | FK → profiles(id) ON DELETE CASCADE |
| created_at | timestamptz | now() | — |
| — | UNIQUE | — | (habit_id, user_id) — un usuario no puede tener el mismo hábito asignado dos veces |

Un hábito solo aparece en HomeScreen si existe una fila en esta tabla con `user_id = usuario_actual`. El admin gestiona las asignaciones desde AdminScreen (crear hábito + asignar, o editar asignaciones de un hábito existente).

### `habit_validators`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| habit_id | uuid | — | FK → habits(id) ON DELETE CASCADE |
| user_id | uuid | — | FK → profiles(id) ON DELETE CASCADE |
| created_at | timestamptz | now() | — |
| — | UNIQUE | — | (habit_id, user_id) |

Solo los usuarios que aparecen en esta tabla para un `habit_id` dado verán los logs pendientes de ese hábito en ValidateHabitScreen. Un usuario asignado al hábito (`habit_assignments`) no debe añadirse también como validador.

### `habit_logs`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| habit_id | uuid | — | FK → habits(id) ON DELETE CASCADE |
| user_id | uuid | — | FK → profiles(id) — quién lo hizo |
| photo_url | text | — | URL pública en Storage bucket habit-photos |
| status | text | 'pending' | 'pending', 'validated', 'rejected' |
| notes | text | null | Nota opcional añadida al completar el hábito |
| validated_by | uuid | null | FK → profiles(id) — legado, no se usa desde v2 |
| validated_at | timestamptz | null | Legado, no se usa desde v2 |
| created_at | timestamptz | now() | — |

### `habit_validations`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| habit_log_id | uuid | — | FK → habit_logs(id) ON DELETE CASCADE |
| validator_id | uuid | — | FK → profiles(id) ON DELETE CASCADE |
| status | text | — | 'validated' o 'rejected' |
| reaction | text | null | Emoji de reacción opcional: '👏', '❤️', '💪', '😊', '🌟' o null |
| comment | text | null | Comentario libre opcional |
| created_at | timestamptz | now() | — |
| — | UNIQUE | — | (habit_log_id, validator_id) — un voto por usuario por log |

### `habit_rewards`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| habit_id | uuid | — | FK → habits(id) |
| streak_target | integer | — | Número de completados necesarios para conseguir la recompensa |
| description | text | — | Descripción de la recompensa |

Ver cálculo de recompensas recursivas/históricas más abajo.

### `categories`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| name | text | — | Nombre de la categoría |
| icon | text | 'ellipsis-horizontal' | Nombre del icono Ionicons |
| color | text | '#9E9E9E' | Color hex para el badge |
| company_id | uuid | null | null = predefinida del sistema; uuid = categoría personalizada de la empresa |
| created_at | timestamptz | now() | — |

Las categorías con `company_id = null` son predefinidas del sistema y no se pueden eliminar desde la app.

**Categorías predefinidas:**
| Nombre | Icono | Color |
|---|---|---|
| Ejercicio | fitness | #4CAF50 |
| Alimentación | restaurant | #FF9800 |
| Lectura | book | #2196F3 |
| Descanso | moon | #9C27B0 |
| Salud | medical | #F44336 |
| Hidratación | water | #00BCD4 |
| Bienestar | heart | #9E9E9E |
| Hogar | home | #009688 |

### `activation_codes`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| code | text | — | Código numérico de 6 dígitos, único |
| company_id | uuid | — | FK → companies(id) |
| email | text | — | Email del miembro invitado |
| full_name | text | — | Nombre completo del miembro invitado |
| used | boolean | false | Se marca `true` tras activar la cuenta |
| expires_at | timestamptz | now() + 30 días | Si está en el pasado el código no es válido (corregido default, antes documentado como `null`) |
| created_at | timestamptz | now() | — |
| failed_attempts | integer | 0 | Intentos fallidos consecutivos contra este código concreto (rate limiting, ver `check_activation_code`) |
| locked_until | timestamptz | null | Si está en el futuro, el código rechaza cualquier intento hasta esa fecha, sin tocar `failed_attempts` |

El admin genera un código desde la pestaña Familia de AdminScreen. El código se comparte con el miembro, quien lo introduce en SignUpScreen para activar su cuenta sin necesidad de código de invitación genérico.

### `activation_attempts`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| ip_address | text | — | De `request.headers.x-forwarded-for`, puede ser `null` fuera de PostgREST |
| attempted_at | timestamptz | now() | — |

**Pendiente de aplicar vía SQL Editor, en producción.** Solo la usa `check_activation_code` (capa 2 de rate limiting, por IP — ver más abajo). RLS activado sin policies, igual que `plan_limits`: ningún cliente la lee ni escribe directamente. Filas de más de 1 hora se autolimpian en cada llamada a la función.

### `plan_limits`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| plan | text | — | PK — 'familiar', 'plus', 'empresa' |
| max_members | integer | null | null = sin límite |
| max_active_habits | integer | null | null = sin límite |
| history_days | integer | null | null = sin límite |
| advanced_stats | boolean | false | — |

Tabla de solo lectura vía RPC (`get_company_plan_info`, `SECURITY DEFINER`); no tiene ninguna policy RLS propia (ni falta le hace, ningún cliente la consulta directamente). Detalle completo de valores y enforcement en [business.md](business.md#límites-por-plan-plan_limits).

### `teams` _(creada, sin uso todavía)_
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| name | text | — | Nombre del equipo |
| company_id | uuid | — | FK → companies(id) |
| created_by | uuid | — | FK → profiles(id) |
| created_at | timestamptz | now() | — |

### `team_members` _(creada, sin uso todavía)_
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| team_id | uuid | — | FK → teams(id) |
| user_id | uuid | — | FK → profiles(id) |
| created_at | timestamptz | now() | — |
| — | UNIQUE | — | (team_id, user_id) — un usuario no puede estar dos veces en el mismo equipo |

### `invitations` _(sin uso activo)_
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| code | text | — | Código único, reutilizable |
| company_id | uuid | — | FK → companies(id) |
| created_by | uuid | — | FK → profiles(id) — no listado antes en esta tabla, corregido en la auditoría 2026-09-16 |
| expires_at | timestamptz | null | Opcional, se valida en cliente |
| created_at | timestamptz | now() | — |

Ligada al RPC `handle_invited_user_registration`, que está discontinuada (ver sección de Funciones SQL). No hay ninguna llamada a `.from('invitations')` en el código actual de ninguno de los dos repos. Se mantiene documentada como su RPC, por si se retoma el flujo de invitación por código genérico en el futuro.

### Relaciones entre tablas
```
auth.users   ──── profiles          (1:1)
companies    ──── profiles          (1:N, company_id)
companies    ──── habits            (1:N, company_id)
companies    ──── invitations       (1:N, company_id)
companies    ──── activation_codes  (1:N, company_id)
companies    ──── teams             (1:N, company_id)
habits       ──── habit_assignments (1:N, habit_id)   ← asignación explícita por usuario
habits       ──── habit_validators  (1:N, habit_id)   ← quién puede validar cada hábito
habits       ──── habit_rewards     (1:N, habit_id)
profiles     ──── habit_validators  (1:N, user_id)
categories   ──── habits            (1:N, category_id, nullable)
companies    ──── categories        (1:N, company_id, nullable — null = predefinida)
profiles     ──── habit_assignments (1:N, user_id)
habits       ──── habit_logs        (1:N, habit_id)
profiles     ──── habit_logs        (1:N, user_id)
habit_logs   ──── habit_validations (1:N, habit_log_id)
profiles     ──── habit_validations (1:N, validator_id)
teams        ──── team_members      (1:N, team_id)
profiles     ──── team_members      (1:N, user_id)
teams        ──── habits            (1:N, team_id, nullable)
```

---

## Funciones SQL (RPCs SECURITY DEFINER)

### `handle_new_user_registration`
Crea empresa nueva y perfil de administrador en una sola transacción. Se llama desde la app tras `auth.signUp` (SignUpScreen, modo "crear grupo").

**Parámetros:**
- `user_id` uuid
- `user_email` text
- `user_full_name` text
- `company_name` text

**Lógica:**
1. INSERT en `companies` con el nombre dado, guarda el nuevo `company_id`
2. INSERT en `profiles` con `role = 'admin'` y el `company_id` creado
3. UPDATE en `companies.admin_id` con el `user_id`

### `handle_activation_registration`
Registra un usuario en una empresa existente usando un código de activación personal. Se llama desde SignUpScreen (flujo `activate`) tras `auth.signUp`.

**Parámetros:**
- `user_id` uuid
- `user_email` text
- `user_full_name` text
- `activation_code` text

**Lógica:**
1. Busca el código en `activation_codes` donde `code = activation_code`, `used = false` y no expirado (`expires_at IS NULL OR expires_at > now()`)
2. Si no existe, lanza excepción "Código de activación inválido o expirado"
3. Obtiene `company_id` del registro del código
4. Comprueba `check_member_limit(company_id)`; si no hay hueco, lanza excepción `limit_members_reached` (red de seguridad server-side, ver [business.md](business.md#enforcement))
5. INSERT en `profiles` con `role = 'usuario'` y el `company_id` obtenido
6. El cliente marca el código como `used = true` tras la llamada (UPDATE en `activation_codes`) — ver `check_activation_code` más abajo para el paso previo de validación del código antes del login

**Race condition:** se usa el singleton `authFlags` (`lib/authFlags.js`) para bloquear el redirect automático de `onAuthStateChange` durante el flujo de activación. `skipNextRedirect = true` se pone antes del `signUp`; se resetea en cada path de error; al terminar se llama `activateSession(session)` que ejecuta `setSession` directamente en RootNavigator. El mismo patrón se aplicó también al flujo "crear grupo" (`onSignUp`), que tenía la misma condición de carrera sin protección (corregido en la auditoría de 2026-09-16).

### `check_activation_code(p_code text)` → `email, full_name, company_id`
RPC `SECURITY DEFINER` que sustituye al SELECT directo sobre `activation_codes` que hacía `SignUpScreen.js` (paso 1 del flujo "activate", antes de que el usuario tenga sesión). Necesaria porque la policy SELECT de `activation_codes` quedó restringida a `is_admin() AND company_id = my_company_id()` tras la auditoría de RLS, y un visitante sin sesión no puede validar así su código de 6 dígitos. Devuelve el código si existe, no está usado y no ha expirado; ninguna fila en caso contrario. `EXECUTE` concedido a `anon` y `authenticated`. Llamada desde `SignUpScreen.js` (`onCheckCode`).

**Rate limiting — dos capas complementarias:**

**Capa 1, por código (aplicada en Supabase):**
1. Busca la fila por `code = p_code` (match exacto, `code` es único). Si no existe ninguna fila con ese valor, no hay nada que limitar por esta capa — se devuelve vacío igual que hoy (la capa 2 de abajo sí cuenta este intento).
2. Si `locked_until` de esa fila está en el futuro, rechaza inmediatamente con `RAISE EXCEPTION 'Código bloqueado temporalmente, inténtalo de nuevo en unos minutos'` — sin tocar `failed_attempts` ni revelar cuántos intentos quedan.
3. Si la fila existe pero no es válida ahora mismo (`used = true` o expirada), cuenta como intento fallido: `failed_attempts += 1`; al llegar a 5, `locked_until = now() + 15 minutos`.
4. Si la fila es válida (`used = false` y no expirada), resetea `failed_attempts = 0` y `locked_until = null`, y devuelve los datos — flujo normal.

Protege contra reintentos repetidos sobre UN código concreto ya existente pero muerto (usado/expirado). Un código genuinamente válido y no usado siempre tiene éxito y resetea el contador — nunca puede acumular 5 fallos por sí mismo.

**Capa 2, por IP (`activation_attempts`, pendiente de aplicar vía SQL Editor en producción):** cubre justo el hueco de la capa 1 — un atacante probando códigos de 6 dígitos al azar que no coinciden con ninguna fila real, donde no hay ningún `activation_codes.id` al que enganchar un contador.
1. Al inicio de la función, antes de tocar `activation_codes`: obtiene la IP del cliente con `current_setting('request.headers', true)::json->>'x-forwarded-for'`.
2. Borra intentos de esa IP en `activation_attempts` de más de 1 hora (limpieza, evita que la tabla crezca sin límite).
3. Cuenta los intentos de esa IP en los últimos 15 minutos. Si son ≥5, `RAISE EXCEPTION` con el mismo mensaje de bloqueo — **sin insertar** un intento nuevo, para no alargar la ventana indefinidamente mientras el atacante sigue llamando.
4. Si no, inserta una fila nueva (`ip_address`, `attempted_at = now()`) y continúa con la lógica normal (incluida la capa 1). No se borran los intentos de esa IP aunque el código resulte válido — el límite es por IP y ventana de tiempo, no depende de si acertó.

`activation_attempts` tiene RLS activado sin policies (igual que `plan_limits`): solo la toca esta función `SECURITY DEFINER`, ningún cliente puede leerla/escribirla directamente.

Ambos mensajes de bloqueo llegan al cliente vía `error.message` de Supabase y ya tienen dónde mostrarse: `SignUpScreen.onCheckCode` hace `if (error) throw error`, capturado por el `catch` que llama a `setFormError(e?.message ...)` — el mismo mecanismo que usa `handle_activation_registration` para `limit_members_reached`. No ha hecho falta tocar la pantalla en ninguna de las dos capas.

⚠️ Si `x-forwarded-for` llegara vacío (no debería pasar en tráfico real vía Supabase, pero sí al probar la función directamente en el SQL Editor sin pasar por PostgREST), `v_ip` es `NULL` y `ip_address = NULL` nunca iguala nada en SQL — ese tráfico quedaría sin límite por IP. Para probarlo en el SQL Editor hay que fijar `request.headers` manualmente con `select set_config('request.headers', '{"x-forwarded-for":"1.2.3.4"}', true)` antes de llamar a la función.

### `handle_invited_user_registration` _(discontinuada)_
Registra un usuario en una empresa existente usando un código de invitación.

**Parámetros:**
- `user_id` uuid
- `user_email` text
- `user_full_name` text
- `invitation_code` text

**Lógica:**
1. Busca la invitación por `code` para obtener `company_id`
2. INSERT en `profiles` con `role = 'usuario'` y el `company_id` de la invitación
3. No marca la invitación como usada (diseño deliberado: el código es reutilizable)

> **Discontinuada:** no se invoca en ningún punto del código actual (solo aparece mencionada en comentarios en `SignUpScreen.js` y `lib/authFlags.js`) y no tiene uso previsto a corto plazo. Se mantiene documentada por si se retoma en el futuro.

### `delete_member(member_id uuid)`
Elimina un miembro del grupo (SECURITY DEFINER, bypasea RLS). Usada en `screens/AdminScreen.js` (app) y `src/components/admin/Members.jsx` (web) desde el botón "Eliminar miembro".

### `check_habit_limit(p_company_id)` → boolean
Comprueba si el grupo puede crear un hábito activo más, según su plan. Usada en `screens/AdminScreen.js` (app) y `Habits.jsx` (web) antes del INSERT de un nuevo hábito. Detalle de planes y límites en [business.md](business.md).

### `check_member_limit(p_company_id)` → boolean
Comprueba si el grupo puede añadir un miembro más, según su plan. Usada en `screens/AdminScreen.js` (app) y `Members.jsx` (web) antes de generar un código de activación, y como red de seguridad server-side dentro de `handle_activation_registration`. Detalle en [business.md](business.md).

### `get_company_plan_info(p_company_id)`
Devuelve `plan, history_days, advanced_stats, max_members, max_active_habits` del grupo. Usada por el hook `lib/usePlanInfo.js`. Detalle en [business.md](business.md).

### `delete_expired_habit(p_habit_id uuid)`
Elimina un hábito 'once' ya caducado (SECURITY DEFINER, bypasea RLS). Usada en `screens/ValidateHabitScreen.js`, pestaña "caducados", desde el botón de borrar de cada tarjeta.

### `update_member_avatar(member_id uuid, new_avatar_url text)`
Actualiza el `avatar_url` de otro miembro del grupo (SECURITY DEFINER, bypasea RLS). Usada en `screens/AdminScreen.js` cuando un admin cambia la foto de perfil de otro miembro. Ver nota en la política UPDATE de `profiles` más abajo: esta RPC existe para ese campo, pero `full_name`/`email`/`role` de otro miembro se actualizan con un UPDATE directo desde el cliente en el mismo flujo — inconsistente con pasar por RPC solo para el avatar; pendiente de aclarar si la política real de `profiles` ya contempla una excepción de admin.

---

## Políticas RLS

### `profiles`
- **SELECT:** `id = auth.uid() OR company_id = my_company_id()` — el propio perfil o el de un compañero de la misma empresa
- **INSERT:** solo via funciones RPC (SECURITY DEFINER) — no existe policy de INSERT directo
- **UPDATE:** `auth.uid() = id` (propio usuario) o `is_admin() AND company_id = my_company_id()` (admin editando a un miembro de su misma empresa — cubre el UPDATE directo de `full_name`/`email`/`role` que hacen `AdminScreen.js` y `Members.jsx`)

### `companies`
- **SELECT:** `id = my_company_id()` — solo tu propia empresa
- **INSERT:** solo via funciones RPC (SECURITY DEFINER) — no existe policy de INSERT directo
- **UPDATE:** `is_admin() AND id = my_company_id()` — cubre el rename de grupo en `screens/ProfileScreen.js` (`saveGroupName`)

### `habits`
- **SELECT:** `true` — lectura abierta (se filtra por company_id en el cliente)
- **INSERT:** `is_admin() AND company_id = my_company_id()`
- **UPDATE:** `is_admin() AND company_id = my_company_id()`
- **DELETE:** usuarios con `role = 'admin'` de la misma empresa

### `habit_assignments`
- **SELECT:** `true` — lectura abierta (necesario para HomeScreen y RankingScreen)
- **INSERT:** cualquier autenticado (no solo el admin, intencional), acotado a que el hábito referenciado sea de tu propia empresa (`EXISTS (... habits h WHERE h.id = habit_id AND h.company_id = my_company_id())`)
- **DELETE:** `is_admin()` y el hábito referenciado pertenece a la empresa del admin

### `habit_validators`
- **SELECT:** `true` — lectura abierta
- **INSERT/DELETE:** `is_admin()` y el hábito referenciado pertenece a la empresa del admin (`EXISTS (... habits h WHERE h.id = habit_id AND h.company_id = my_company_id())`) — cubre los INSERT/DELETE directos de `AdminScreen.js` y `Habits.jsx` (web)

### `habit_logs`
- **SELECT:** `true` — lectura abierta (necesario para ValidateHabitScreen y RankingScreen)
- **INSERT:** `user_id = auth.uid()` y el hábito referenciado es de tu propia empresa — evita insertar logs a nombre de otro usuario
- **UPDATE:** el propio dueño del log, un validador asignado a ese hábito (`habit_validators`), o un admin de la empresa del hábito. En la práctica no la usa ningún flujo actual del cliente (la validación social escribe en `habit_validations`, no toca `status` de `habit_logs` directamente — `validated_by`/`validated_at`/`status` son en la práctica legado, ver más abajo)

### `habit_validations`
- **SELECT:** `true` — lectura abierta
- **INSERT:** `auth.uid() = validator_id` — solo puedes insertar con tu propio validator_id
- La constraint UNIQUE (habit_log_id, validator_id) a nivel de DB previene votos duplicados

### `habit_rewards`
- **SELECT:** `true` — lectura abierta
- **INSERT/UPDATE/DELETE:** `is_admin()` y el hábito referenciado pertenece a la empresa del admin — cubre los INSERT/DELETE directos de `AdminScreen.js` y `Habits.jsx` (web)

### `categories`
- **SELECT:** `true` — lectura abierta (predefinidas del sistema + las de todas las empresas; se filtra por `company_id` en el cliente)
- **INSERT:** `is_admin() AND company_id = my_company_id()` — solo puede crear categorías para su propia empresa
- **DELETE:** `is_admin() AND company_id = my_company_id()` — las predefinidas (`company_id IS NULL`) nunca cumplen la condición, así que no se pueden borrar

### `activation_codes`
- **SELECT:** `is_admin() AND company_id = my_company_id()` — solo el admin ve los códigos de su propia empresa (el signup con código pasa por el RPC `handle_activation_registration`, que bypasea RLS, así que el cliente no necesita SELECT abierto)
- **INSERT:** `is_admin() AND company_id = my_company_id()`
- **UPDATE:** dos policies — `is_admin() AND company_id = my_company_id()` (el admin edita/cancela códigos de su empresa), o `auth.uid() IS NOT NULL AND used = false` con `WITH CHECK (used = true)` (el usuario recién registrado marca su propio código como usado justo tras `auth.signUp`)
- **DELETE:** `is_admin()` y `company_id` coincide con el del admin

Corregido en 2026-09-16 tras auditoría de RLS — helpers `my_company_id()` e `is_admin()` (SECURITY DEFINER, `search_path` fijado) añadidos para evitar recursión al comprobar la empresa/rol del usuario desde las propias políticas de `profiles`.

### `invitations` _(sin uso activo — ver nota en el esquema de tablas)_
- **SELECT:** `true`, roles `anon, authenticated` — lectura abierta (pensada para validar el código sin sesión, aunque el flujo real está discontinuado)
- **INSERT:** `is_admin() AND company_id = my_company_id()`
- **UPDATE:** `is_admin() AND company_id = my_company_id()`

### `teams` / `team_members` _(creadas, sin uso activo en el código — ver nota en el esquema de tablas)_
- `teams` SELECT/UPDATE: `auth.uid() = created_by`; INSERT: `is_admin() AND company_id = my_company_id()`
- `team_members` SELECT: `true`; INSERT/DELETE: `is_admin()` y el equipo referenciado pertenece a la empresa del admin

Ninguna de las dos tablas tiene código cliente que escriba en ellas hoy (verificado en la auditoría de 2026-09-16).

---

## Storage

### Bucket: `habit-photos`
- **Tipo:** público
- **Uso:** fotos de prueba de hábitos completados
- **Path:** `{user_id}/{habit_id}/{timestamp}.{ext}`, forzado por RLS: `(storage.foldername(name))[1] = auth.uid()::text`
- **Política INSERT:** `bucket_id = 'habit-photos' AND (storage.foldername(name))[1] = auth.uid()::text` — solo puedes subir a tu propio path
- **Política SELECT:** pública (URLs públicas)

### Bucket: `avatars`
- **Tipo:** público
- **Uso:** fotos de perfil de usuarios
- **Path:** `{user_id}/avatar.jpg`, forzado por RLS: `(storage.foldername(name))[1] = auth.uid()::text`
- **Política INSERT/UPDATE:** solo tu propio path; además, `admins can upload avatar for own company member` permite a un admin subir el avatar de otro miembro (para `update_member_avatar`) siempre que ese miembro sea de su misma empresa (`profiles.company_id = my_company_id()`)
- **Política SELECT:** pública (URLs públicas)
- **Nota:** la URL limpia se guarda en `profiles.avatar_url`; en el cliente se añade `?t=Date.now()` para cache-busting inmediato tras la subida

---

## Índices de base de datos

| Tabla | Campo(s) | Motivo |
|---|---|---|
| habit_logs | user_id | Filtrar logs por usuario (HomeScreen, ProfileScreen, RankingScreen) |
| habit_logs | habit_id | Filtrar logs por hábito |
| habit_logs | created_at DESC | Ordenación por fecha en historial y actividad |
| habit_logs | status | Filtrar por estado pendiente/validado en ValidateHabitScreen |
| habit_validations | habit_log_id | JOIN con habit_logs en validaciones |
| habit_validations | validator_id | Filtrar validaciones por validador (badge, ValidateHabitScreen) |
| habit_assignments | user_id | Filtrar hábitos asignados por usuario (HomeScreen) |
| habit_assignments | habit_id | JOIN inverso desde hábitos |
| habit_validators | user_id | Filtrar validadores por usuario (ValidateHabitScreen, badge) |
| habit_validators | habit_id | JOIN desde hábitos |
| habits | company_id | Filtrar hábitos por empresa/grupo |
| habits | is_active | Filtrar hábitos activos |
| profiles | company_id | Filtrar miembros por grupo |

---

## Helpers de fechas/cálculo (compartidos entre pantallas)

```js
function toDateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function getMondayKey(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function calculateTotalCompleted(habitLogs, recurrence, weeklyTarget, monthlyTarget) {
  if (!habitLogs.length) return 0;
  if (recurrence === 'daily' || recurrence === 'once')
    return new Set(habitLogs.map((l) => toDateKey(new Date(l.created_at)))).size;
  if (recurrence === 'weekly_x') {
    const wTarget = weeklyTarget || 1;
    const weekCountMap = {};
    habitLogs.forEach((l) => { const k = getMondayKey(new Date(l.created_at)); weekCountMap[k] = (weekCountMap[k] || 0) + 1; });
    return Object.values(weekCountMap).filter((c) => c >= wTarget).length;
  }
  if (recurrence === 'monthly_x') {
    const mTarget = monthlyTarget || 1;
    const monthCountMap = {};
    habitLogs.forEach((l) => { const d = new Date(l.created_at); const k = `${d.getFullYear()}-${d.getMonth()}`; monthCountMap[k] = (monthCountMap[k] || 0) + 1; });
    return Object.values(monthCountMap).filter((c) => c >= mTarget).length;
  }
  return 0;
}
```

## Sistema de recompensas (cálculo recursivo/histórico)

Tabla `habit_rewards`: `streak_target` (número de completados necesarios), `description`.

- `totalCompleted` = acumulado histórico, NUNCA se resetea:
  - `daily` / `once`: días únicos con log (Set de `toDateKey`)
  - `weekly_x`: semanas donde count ≥ `weekly_target`
  - `monthly_x`: meses donde count ≥ `monthly_target`
- `timesAchieved = Math.floor(totalCompleted / streak_target)`
- `daysToNext = streak_target - (totalCompleted % streak_target)`
- Nuevo logro detectado cuando: `Math.floor(newTotal / target) > Math.floor((newTotal - 1) / target)`

El comportamiento en cada pantalla (chip en HomeScreen, overlay de celebración en HabitDetailScreen, badges en HabitStatsScreen, gestión en AdminScreen) está descrito en [navigation.md](navigation.md).
