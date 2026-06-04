# HabitApp — Documento de Proyecto

## 1. Descripción

Plataforma de hábitos compartidos con validación social entre miembros del grupo. Los usuarios registran hábitos saludables diarios y sus familiares o compañeros de grupo los validan mediante fotografías como prueba. El objetivo es fomentar hábitos positivos mediante la responsabilidad compartida. Diseñado para familias, grupos de amigos y equipos pequeños.

---

## 2. Stack Tecnológico

| Tecnología | Versión |
|---|---|
| Expo SDK | ~54.0.33 |
| React | 19.1.0 |
| React Native | 0.81.5 |
| @supabase/supabase-js | ^2.106.2 |
| @react-navigation/native | ^7.2.5 |
| @react-navigation/native-stack | ^7.16.0 |
| @react-navigation/bottom-tabs | ^7.16.2 |
| expo-image-picker | ~17.0.11 |
| expo-status-bar | ~3.0.9 |
| @expo/vector-icons (Ionicons) | incluido en Expo SDK |
| @react-native-async-storage/async-storage | 2.2.0 |
| react-native-safe-area-context | ~5.6.0 |
| react-native-screens | ~4.16.0 |
| react-native-url-polyfill | ^3.0.0 |
| @react-native-community/datetimepicker | incluido en Expo SDK |
| Node.js | v20 |

**Backend:** Supabase (PostgreSQL + Auth + Storage)
**Repositorio:** https://github.com/hernanzluis/HabitApp

---

## 3. Comandos

```bash
# Instalar dependencias
npm install

# Arrancar (modo por defecto)
npm start

# Arrancar en red local (recomendado para dispositivos físicos)
npx expo start --lan

# Arrancar solo para iOS
npm run ios

# Arrancar solo para Android
npm run android
```

---

## 4. Estructura de Carpetas

```
HabitApp/
├── assets/                     # Iconos y splash
│   ├── icon.png
│   ├── adaptive-icon.png
│   ├── splash-icon.png
│   └── favicon.png
├── lib/
│   └── supabase.js             # Cliente Supabase (singleton)
├── navigation/
│   └── RootNavigator.js        # Navegación raíz + lógica de sesión + badge tab
├── screens/
│   ├── LoginScreen.js
│   ├── SignUpScreen.js
│   ├── ForgotPasswordScreen.js
│   ├── HomeScreen.js
│   ├── HabitDetailScreen.js
│   ├── ValidateHabitScreen.js
│   ├── HistoryScreen.js
│   ├── RankingScreen.js
│   ├── ProfileScreen.js
│   └── AdminScreen.js
├── App.js                      # Punto de entrada (renderiza RootNavigator)
├── index.js                    # Registro de la app con Expo
├── app.json                    # Configuración de Expo
├── package.json
├── PROYECTO.md                 # Este archivo
├── AGENTS.md                   # Instrucciones para Claude Code
└── CLAUDE.md                   # Referencia a AGENTS.md
```

---

## 5. Base de Datos (Supabase / PostgreSQL)

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
| recurrence | text | — | 'daily' o 'once' |
| is_active | boolean | true | Solo se muestran hábitos activos |
| created_at | timestamptz | now() | — |
| expires_at | timestamptz | null | Para hábitos 'once': fecha y hora límite combinadas. Si está en el pasado, no se muestra |
| due_time | time | null | Para hábitos 'daily': hora límite opcional. Si la hora actual la supera y el hábito no está completado, se muestra en naranja |
| team_id | uuid | null | FK → teams(id), nullable — sin uso activo todavía |

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
| created_at | timestamptz | now() | — |
| — | UNIQUE | — | (habit_log_id, validator_id) — un voto por usuario por log |

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
companies    ──── teams             (1:N, company_id)
habits       ──── habit_assignments (1:N, habit_id)   ← asignación explícita por usuario
habits       ──── habit_validators  (1:N, habit_id)   ← quién puede validar cada hábito
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

## 6. Funciones SQL

### `handle_new_user_registration`
Crea empresa nueva y perfil de administrador en una sola transacción. Se llama desde la app tras `auth.signUp`.

**Parámetros:**
- `user_id` uuid
- `user_email` text
- `user_full_name` text
- `company_name` text

**Lógica:**
1. INSERT en `companies` con el nombre dado, guarda el nuevo `company_id`
2. INSERT en `profiles` con `role = 'admin'` y el `company_id` creado
3. UPDATE en `companies.admin_id` con el `user_id`

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

## 7. Políticas RLS

RLS activado en todas las tablas. Todas las políticas se crean mediante SQL Editor, nunca desde la UI de Supabase.

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

## 8. Storage

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

## 9. Pantallas

### `LoginScreen`
- Campos: email y contraseña
- Llama a `supabase.auth.signInWithPassword`
- Links a ForgotPasswordScreen y SignUpScreen
- Al iniciar sesión, `onAuthStateChange` en RootNavigator detecta la sesión y navega automáticamente al AppStack

### `ForgotPasswordScreen`
- Campo: email
- Llama a `supabase.auth.resetPasswordForEmail`
- Muestra mensaje de confirmación tras enviar

### `SignUpScreen`
- Dos modos seleccionables con toggle: **"Crear grupo"** y **"Tengo un código de invitación"**
- Campos comunes: nombre completo, email, contraseña, confirmar contraseña
- Modo "Crear grupo": campo nombre del grupo → llama a RPC `handle_new_user_registration`
- Modo "Tengo un código de invitación": campo código → valida código en `invitations` antes de crear auth user → llama a RPC `handle_invited_user_registration`
- Validación inline por campo antes de enviar
- Tras éxito, `onAuthStateChange` navega automáticamente sin necesidad de `navigation.navigate`

### `HomeScreen`
- **Datos:** perfil del usuario, hábitos asignados al usuario, habit_logs del usuario, habit_validations
- **Queries:**
  1. `profiles` → obtiene `full_name` y `company_id`
  2. `habit_assignments` → `habit_id` donde `user_id = currentUser` — solo hábitos asignados explícitamente
  3. `habits` → filtra por `company_id`, `is_active = true` e `id IN [assignedIds]`, ordenados por `created_at`
  4. `habit_logs` → filtra por `user_id` e `habit_id IN [...]`, selecciona `id, habit_id, created_at`
  5. `habit_validations` → filtra por `habit_log_id IN [logs de hoy]`
- **Lógica recurrence:**
  - `once`: si ya existe cualquier log para ese hábito → no se muestra
  - `daily`: si existe log de hoy → muestra tarjeta "Completado hoy" con check verde
- **Tarjeta completada:** fondo verde muy suave (#F0FAF0), borde izquierdo 3px verde (#2E7D32), icono check Ionicons + texto "Completado hoy" + contadores ✓ N / ✗ N de validaciones recibidas ese día (alineados a la derecha)
- **Tarjeta pendiente:** botón "Completar" → navega a HabitDetailScreen
- **Hora límite (`due_time`):** para hábitos `daily` con `due_time`, muestra "Antes de las HH:MM" en gris. Si la hora ya pasó y el hábito no está completado, se muestra en naranja
- **Expiración (`expires_at`):** fecha (y hora si no es 00:00) visible siempre en gris. Sin color naranja por proximidad de fecha
- Reintento automático (500ms) en primer load para evitar race condition de sesión
- Pull-to-refresh, estado vacío, manejo de errores

### `HabitDetailScreen`
- Recibe el objeto `habit` como param de navegación
- **Foto:** botón principal ancho completo "Cámara" (Ionicons `camera-outline`, fondo BLUE). Sin opción de galería
- Preview de la foto seleccionada (height 220)
- **Nota opcional:** TextInput multiline, máx 150 caracteres, debajo del preview
- Al enviar:
  1. Sube la imagen a Storage `habit-photos/{user_id}/{habit_id}/{timestamp}.ext`
  2. Obtiene la URL pública
  3. INSERT en `habit_logs` con `status = 'pending'` y `notes` (null si vacío)
- Spinner durante la subida, mensaje de éxito "¡Prueba enviada!", vuelve a Home tras 1.5s

### `ValidateHabitScreen`
- **Datos:** habit_logs pendientes de miembros del mismo grupo, filtrados para excluir los ya votados por el usuario actual
- **Queries:**
  1. `habit_logs` → `status = 'pending'`, `user_id != currentUser`, selecciona `id, habit_id, user_id, photo_url, status, notes, created_at`, ordenados por `created_at desc`
  2. **Promise.all** con:
     - `profiles` → nombres y avatares de los autores (por userIds extraídos de los logs)
     - `habits` → títulos y `company_id` para filtrar por grupo (por habitIds extraídos)
     - `habit_validations` → todos los votos para los logIds obtenidos
- **Filtrado:** solo muestra logs de hábitos con `company_id` coincidente y donde `userValidated = false`
- **Votación:** INSERT en `habit_validations` con `status = 'validated'` o `'rejected'`; la constraint UNIQUE previene doble voto a nivel DB
- **UI por tarjeta:** avatar del miembro (foto real si tiene `avatar_url`, inicial si no), nombre, título del hábito, fecha, foto de prueba, nota del log (si existe, en caja gris #F9F9F9), contadores ✓ N / ✗ N, botones Aprobar/Rechazar
- Tras votar el último pendiente → muestra "Todo al día ✓" → navega a Home tras 1 segundo
- Pull-to-refresh, estado vacío

### `HistoryScreen`
- Accesible desde el icono de reloj (🕐) en el header de Home
- **Datos:** todos los `habit_logs` del usuario actual, ordenados por `created_at DESC`
- **Queries:**
  1. `habit_logs` → `id, habit_id, photo_url, created_at` donde `user_id = currentUser`
  2. **Promise.all** con:
     - `habits` → `id, title` para los habitIds encontrados
     - `habit_validations` → `habit_log_id, status` para los logIds encontrados
- **Estado derivado por log:** si hay ≥1 validación `'validated'` → "Validado" (verde); si hay rechazos y ningún validado → "Rechazado" (rojo); si no hay validaciones → "Pendiente" (naranja)
- **UI por tarjeta:** thumbnail 64×64 de la foto (modal al pulsar para verla a pantalla completa), título del hábito, fecha/hora, badge de estado con color
- Modal de foto: pantalla negra, imagen `resizeMode="contain"`, cierra al pulsar
- Pull-to-refresh, estado vacío, manejo de errores

### `AdminScreen`
- Solo accesible para usuarios con `role = 'admin'` (visible vía icono escudo en header de Home)
- **Sección 1 — Código de invitación:**
  - Muestra el código activo más reciente del grupo (query a `invitations` ORDER BY created_at DESC LIMIT 1)
  - Botón "Compartir" → `Share.share()` nativo con mensaje i18n
  - Botón "Generar código" → genera un código `XXXX-XXXX` aleatorio, INSERT en `invitations` con `expires_at` a 7 días
- **Sección 2 — Hábitos:**
  - Lista todos los hábitos del grupo ordenados por `created_at DESC`; cada fila muestra "X asignado(s)" (tappable) y un icono de papelera
  - Switch por hábito para activar/desactivar (`is_active`) con actualización optimista + rollback en error
  - **Icono papelera:** Alert de confirmación destructiva → DELETE en `habits` (CASCADE elimina habit_assignments, habit_logs y habit_validations); actualización optimista del estado local
  - **Botón "Nuevo hábito":** abre modal de creación
- **Modal crear hábito:**
  - Campos: título (obligatorio), descripción opcional, recurrencia (pills Diario / Una vez)
  - Para `daily`: selector nativo de hora (`DateTimePicker` mode='time') para `due_time` opcional
  - Para `once`: selector nativo de fecha + hora (`DateTimePicker` mode='date' y mode='time') para `expires_at` opcional
  - Lista de miembros del grupo con checkboxes para asignar
  - Al guardar: INSERT en `habits` + INSERT en `habit_assignments` por cada miembro seleccionado
- **Modal editar asignaciones:** al pulsar "X asignado(s)" de un hábito → lista de miembros con estado actual → al guardar: DELETE todas asignaciones del hábito + INSERT nuevas
- Pull-to-refresh, estado vacío, manejo de errores por sección

### `ActivityScreen` _(antes RankingScreen)_
- Tab "Actividad" (icono `people-outline`), header "Actividad del grupo"
- **Período:** semana actual — lunes 00:00:00 hasta hoy 23:59:59 (hora local)
- **Cabecera:** "Semana del DD Mon al DD Mon"
- **Queries:**
  1. `profiles` → obtiene `company_id` del usuario actual
  2. `profiles` → todos los miembros del grupo (`id, full_name, avatar_url`)
  3. `habits` → hábitos activos del grupo (para obtener `activeHabitIds`)
  4. `habit_assignments` → filtra por `activeHabitIds` y `userIds` → cuenta hábitos asignados por miembro
  5. `habit_logs` → logs del período, por `activeHabitIds` y `userIds`
  6. `habit_validations` → `status = 'validated'` para los log IDs del período
- **Por miembro:** avatar + nombre a la izquierda; contadores `completados/asignados` y `validados` a la derecha
- Sin ranking competitivo. Usuario actual destacado con fondo HIGHLIGHT, borde azul y etiqueta "Tú"
- Ordenado por completados DESC (alfabético como desempate)
- Pull-to-refresh, estado vacío

### `ProfileScreen`
- **Queries:**
  1. `profiles` → `full_name, email, company_id, role, avatar_url`
  2. `companies` → nombre de la empresa
  3. `habit_logs` → `id` donde `user_id = currentUser` (para totalCompleted y obtener myLogIds)
  4. `habit_validations` → COUNT donde `status = 'validated'` y `habit_log_id IN [myLogIds]` (totalValidated)
  5. `habit_validations` → COUNT donde `validator_id = currentUser` (totalValidatedForOthers)
- **Edición de nombre:** icono lápiz → TextInput inline → guarda con UPDATE en `profiles`
- **Edición de avatar:** Alert con opciones Cámara/Galería → expo-image-picker → upload a Storage `avatars/{user_id}/avatar.jpg` (upsert) → UPDATE en `profiles.avatar_url`
- Estadísticas: hábitos completados, hábitos validados, validaciones hechas a otros miembros
- Cerrar sesión: `supabase.auth.signOut()` → `onAuthStateChange` navega a AuthStack automáticamente

---

## 10. Sistema de Colores y Diseño

Estilo inspirado en LinkedIn: secciones de ancho completo con fondo blanco, separadas por 8px del fondo gris. Sin tarjetas flotantes con sombra (excepto en la pantalla de login/registro).

| Constante | Valor | Uso |
|---|---|---|
| BG | #F3F2EF | Fondo de pantalla (gris LinkedIn) |
| WHITE | #ffffff | Fondo de secciones |
| BLUE | #0A66C2 | Primario, botones, enlaces, tabs activos |
| TEXT | #1D2226 | Texto principal |
| GRAY | #666666 | Texto secundario, tabs inactivos |
| ORANGE | #f97316 | Hora límite `due_time` superada (hábito no completado) |
| HIGHLIGHT | #EEF3FB | Fondo de fila del usuario en ActivityScreen |

**Botones primarios:** `height: 44`, `borderRadius: 4`, `backgroundColor: BLUE`, `alignSelf: 'center'`, `paddingHorizontal: 32`, `fontWeight: '600'`

**Botones destructivos / cerrar sesión:** solo texto `color: #CC0000`, sin fondo ni borde, `alignSelf: 'flex-start'`

**Separadores entre items:** `height: 1`, `backgroundColor: #E0E0E0`

**Secciones:** `backgroundColor: WHITE`, `paddingHorizontal: 16`, `marginBottom: 8`, sin `borderRadius` ni sombra

---

## 11. Navegación

- **AuthStack** (sin sesión): Login → ForgotPassword / SignUp
- **AppStack** (con sesión):
  - `Tabs` → TabNavigator con 4 tabs
  - `HabitDetail` → stack screen por encima de las tabs (sin barra inferior visible)
  - `History` → stack screen accesible desde icono reloj en header de Home
  - `Admin` → stack screen accesible desde icono escudo en header de Home (solo admins)
- **TabNavigator:**
  - `Home` (icono casa) — Inicio
  - `ValidateHabit` (icono check) — Validar
  - `Ranking` (icono `people-outline`) — Actividad
  - `Profile` (icono persona) — Perfil
- **Tab "Validar":** badge rojo con número de logs pendientes para el usuario; si pendingCount = 0, la tab se deshabilita (gris, no pulsable con `tabBarButton` + `disabled`). El conteo se recalcula al montar y con `screenListeners={{ focus }}`.
- **Header de Home:** icono reloj → navega a History; icono escudo → navega a Admin (solo visible si `role = 'admin'`); icono campana → coming soon. El título del header muestra el nombre de la empresa (query en RootNavigator al montar).
- La sesión la gestiona `RootNavigator` via `supabase.auth.onAuthStateChange`; no hay navegación manual tras login/logout.

---

## 12. Decisiones Técnicas

| Decisión | Por qué |
|---|---|
| Supabase como backend | BaaS completo: auth, DB, storage y RLS en un solo servicio. Sin servidor propio. |
| Dos RPCs para registro | El trigger `on_auth_user_created` de Supabase no permite lógica condicional (crear empresa vs. unirse). Las RPCs con SECURITY DEFINER permiten inserts cross-tabla de forma segura. |
| Validación antes de `auth.signUp` | Se verifica el código de invitación antes de crear el usuario en auth para evitar usuarios huérfanos si el código es inválido. |
| `maybeSingle()` en invitations | Devuelve null en lugar de error cuando no existe la fila, simplificando el manejo de código inválido. |
| `habit_validations` tabla separada | Permite validaciones múltiples por log (N validadores), sin sobrescribir el estado del log. La constraint UNIQUE previene doble voto. |
| `onAuthStateChange` para navegación | Desacopla el resultado del login/logout de la lógica de navegación. El navigator reacciona solo al estado de sesión. |
| `useFocusEffect` en todas las pantallas | Los datos se recargan cada vez que la pantalla recibe foco (al volver de otra pantalla o cambiar de tab), sin necesidad de estado global ni eventos. |
| Reintento en HomeScreen (500ms) | Race condition documentada: en auto-login, `getUser()` puede fallar si se llama antes de que la sesión se restaure desde AsyncStorage. El reintento lo resuelve sin librería. |
| Cache-bust de avatar con `?t=Date.now()` | React Native cachea agresivamente imágenes por URI. Al cambiar la URI se fuerza la recarga inmediata sin borrar la URL guardada en DB. |
| Expo Go sin builds nativos | En desarrollo, evita tiempos de compilación. Solo se necesitará EAS Build para producción (notificaciones push, actualizaciones OTA). |
| iOS primero, Android funcional | El equipo de desarrollo usa Mac/iPhone. Los estilos base se prueban en iOS y se verifica que no rompan en Android. |

---

## 13. Funcionalidades Pendientes (v2)

- ~~**AdminScreen (ampliación):** creación de hábitos nuevos con asignación por miembro~~ ✅ Implementado
- ~~**Sistema de asignación de hábitos:** `habit_assignments` para mostrar solo los hábitos asignados a cada usuario~~ ✅ Implementado
- **AdminScreen — gestión de usuarios:** vista de miembros del grupo, posibilidad de eliminar/cambiar rol
- **AdminScreen — invitaciones históricas:** lista de códigos generados con fecha y estado
- **Sistema de equipos:** el admin crea subgrupos dentro del grupo principal; `team_members` ya creada, sin uso activo. Los hábitos podrían asignarse a subgrupos. Requiere extensión de AdminScreen.
- **Notificaciones push:** recordatorio diario para completar hábitos pendientes; notificación cuando un familiar valida tu hábito
- **SplashScreen animada** con logo de la app
- **Mejora de estadísticas en ProfileScreen:** racha actual (días consecutivos con hábito completado), gráfico de actividad mensual
- **Hábitos personales:** tipo 'personal', visibles solo para el usuario, sin validación
- **Perfil de miembro:** al pulsar un nombre en ValidateHabit o ActivityScreen, ver su perfil público (foto, stats, hábitos validados)
- **Edición de perfil completo:** campo de grupo en ProfileScreen (actualmente solo lectura)
- **Modo oscuro**

---

## 14. Reglas de Trabajo

- Todas las políticas RLS, tablas nuevas y cambios de esquema se hacen **siempre mediante SQL Editor** de Supabase, nunca desde la UI
- Antes de crear cualquier tabla o política usar siempre el SQL Editor
- Antes de escribir código con APIs de Expo, consultar la documentación versionada: https://docs.expo.dev/versions/v54.0.0/
- No añadir funcionalidades no solicitadas ni abstracciones prematuras
- No crear comentarios en el código salvo que el "por qué" sea no obvio

---

## 15. Usuarios de Prueba

| Email | Rol | Empresa |
|---|---|---|
| hernanz.luis@gmail.com | admin | — |

> Las contraseñas no se almacenan en este documento. La confirmación de email está desactivada en el proyecto de Supabase de desarrollo.

---

## 16. Producto Web — HabitTeam.app

**Repositorio web:** habitteam-web (proyecto separado, mismo Supabase)
**Dominio:** habitteam.app (registrado en Namecheap)
**Stack web:** React + React Router + Tailwind CSS v3 + @supabase/supabase-js
**Despliegue:** Vercel (gratuito)

**Modelo de negocio:**
- Hasta 20 usuarios por empresa/grupo: gratuito
- Más de 20 usuarios: de pago (precio por definir)

**Público objetivo:**
- Familias y grupos de amigos como punto de entrada (boca a boca orgánico)
- Equipos pequeños de empresa que entran solos sin proceso comercial
- Estrategia bottom-up: el usuario individual adopta el producto y lo lleva a su entorno

**Página corporativa (pública):**
- Hero con titular impactante, mensaje cercano no corporativo
- Sección Cómo funciona (3 pasos)
- Sección Características
- Sección Precios (freemium: gratis hasta 20 usuarios)
- Footer

**Panel de administración (privado /admin):**
- Pendiente de implementar
- Login con Supabase Auth
- Gestión de hábitos, usuarios, equipos e invitaciones

**Estado actual:** página pública en desarrollo, hero y nav implementados

---

## 17. Forma de trabajo con Claude

Cuando generes instrucciones para ejecutar en Claude Code, inclúyelas siempre dentro de un bloque de código con triple backtick para que aparezca el botón de copiar. Nunca las escribas como texto plano o lista.
