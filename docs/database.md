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
| role | text | 'user' | 'admin' o 'user' |
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
| expires_at | timestamptz | null | Opcional; si está en el pasado el código no es válido |
| created_at | timestamptz | now() | — |

El admin genera un código desde la pestaña Familia de AdminScreen. El código se comparte con el miembro, quien lo introduce en SignUpScreen para activar su cuenta sin necesidad de código de invitación genérico.

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

### `invitations`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| code | text | — | Código único, reutilizable |
| company_id | uuid | — | FK → companies(id) |
| expires_at | timestamptz | null | Opcional, se valida en cliente |
| created_at | timestamptz | now() | — |

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
1. Busca el código en `activation_codes` donde `code = activation_code` y `used = false`
2. Si no existe, lanza excepción "Código de activación inválido o ya usado"
3. Obtiene `company_id` del registro del código
4. INSERT en `profiles` con `role = 'user'` y el `company_id` obtenido
5. El cliente marca el código como `used = true` tras la llamada (UPDATE en `activation_codes`)

**Race condition:** se usa el singleton `authFlags` (`lib/authFlags.js`) para bloquear el redirect automático de `onAuthStateChange` durante el flujo de activación. `skipNextRedirect = true` se pone antes del `signUp`; se resetea en cada path de error; al terminar se llama `activateSession(session)` que ejecuta `setSession` directamente en RootNavigator.

### `handle_invited_user_registration`
Registra un usuario en una empresa existente usando un código de invitación. Se llama desde la app tras `auth.signUp`.

**Parámetros:**
- `user_id` uuid
- `user_email` text
- `user_full_name` text
- `invitation_code` text

**Lógica:**
1. Busca la invitación por `code` para obtener `company_id`
2. INSERT en `profiles` con `role = 'user'` y el `company_id` de la invitación
3. No marca la invitación como usada (diseño deliberado: el código es reutilizable)

---

## Políticas RLS

### `profiles`
- **SELECT:** `true` — cualquier usuario autenticado puede leer perfiles (necesario para mostrar nombres y avatares de compañeros)
- **INSERT:** solo via funciones RPC (SECURITY DEFINER)
- **UPDATE:** `auth.uid() = id` — solo el propio usuario puede actualizar su perfil

### `companies`
- **SELECT:** `true` — lectura abierta para usuarios autenticados
- **INSERT:** solo via funciones RPC (SECURITY DEFINER)

### `habits`
- **SELECT:** `true` — lectura abierta (se filtra por company_id en el cliente)
- **INSERT:** usuarios autenticados con `role = 'admin'`
- **DELETE:** usuarios con `role = 'admin'` de la misma empresa

### `habit_assignments`
- **SELECT:** `true` — lectura abierta (necesario para HomeScreen y ActivityScreen)
- **INSERT:** `auth.uid() IS NOT NULL` — el admin inserta asignaciones al crear o editar un hábito
- **DELETE:** usuarios con `role = 'admin'` de la misma empresa (para editar asignaciones)

### `habit_logs`
- **SELECT:** `true` — lectura abierta (necesario para ValidateHabitScreen y ActivityScreen)
- **INSERT:** `auth.uid() IS NOT NULL` — cualquier usuario autenticado puede insertar su propio log
- **UPDATE:** `auth.uid() IS NOT NULL` — cualquier autenticado puede actualizar (para validadores)

### `habit_validations`
- **SELECT:** `true` — lectura abierta
- **INSERT:** `auth.uid() = validator_id` — solo puedes insertar con tu propio validator_id
- La constraint UNIQUE (habit_log_id, validator_id) a nivel de DB previene votos duplicados

### `invitations`
- **SELECT:** `true` — lectura abierta (necesario para validar el código antes de registrarse sin autenticación)
- **INSERT:** usuarios con `role = 'admin'`

---

## Storage

### Bucket: `habit-photos`
- **Tipo:** público
- **Uso:** fotos de prueba de hábitos completados
- **Path:** `{user_id}/{habit_id}/{timestamp}.{ext}`
- **Política INSERT:** `auth.uid() IS NOT NULL`
- **Política SELECT:** pública (URLs públicas)

### Bucket: `avatars`
- **Tipo:** público
- **Uso:** fotos de perfil de usuarios
- **Path:** `{user_id}/avatar.jpg`
- **Política INSERT:** `auth.uid() IS NOT NULL` con upsert permitido (sobreescribe al actualizar)
- **Política SELECT:** pública (URLs públicas)
- **Nota:** la URL limpia se guarda en `profiles.avatar_url`; en el cliente se añade `?t=Date.now()` para cache-busting inmediato tras la subida

---

## Índices de base de datos

| Tabla | Campo(s) | Motivo |
|---|---|---|
| habit_logs | user_id | Filtrar logs por usuario (HomeScreen, ProfileScreen, ActivityScreen) |
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
