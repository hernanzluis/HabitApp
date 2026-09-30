# HabitApp — Navegación y pantallas

## Estructura de navegación (RootNavigator.js)

- RootNavigator: si hay sesión → AppStack; si no hay sesión pero se está en modo recuperación (`inRecovery`) → RecoveryStack; si no → AuthStack (`RootNavigator.js:357`). La sesión la gestiona `RootNavigator` vía `supabase.auth.onAuthStateChange`; no hay navegación manual tras login/logout (salvo `activateSession()` al terminar el alta, ver SignUpScreen).
- **AuthStack** (headerShown: false): Login, ForgotPassword, SignUp
- **RecoveryStack** (headerShown: false): ResetPassword. Solo se monta al abrir el enlace de recuperación de contraseña (deep link `habitapp://reset-password`): `RootNavigator` lo recibe con `useLinkingURL()` (expo-linking), lee `access_token`/`refresh_token`/`type=recovery` con `getQueryParams` (expo-auth-session), pone `authFlags.skipNextRedirect = true`, llama a `supabase.auth.setSession()` y entra en modo recovery. Un enlace inválido o caducado muestra un `Alert` "enlace no válido"
- **AppStack** (headerShown: false globalmente, headerBackTitle: ''):
  - `Tabs` → TabNavigator
  - `HabitDetail` → HabitDetailScreen (headerShown: false en ruta, lo activa con useEffect)
  - `Admin` → AdminScreen (headerShown: true, headerBackButtonDisplayMode: 'minimal')
  - `Profile` → ProfileScreen (headerShown: false)
  - `HabitStats` → HabitStatsScreen (headerShown: true, headerBackButtonDisplayMode: 'minimal')
- **TabNavigator** (3 tabs):
  - `Home` — HomeScreen. Header: avatar izquierda (→ Profile), nombre empresa centro, botones derecha (escudo admin + notificaciones)
  - `ValidateHabit` — ValidateHabitScreen. Badge con `pendingCount`. Tab deshabilitado (opacity 0.35) si `pendingCount === 0 && expiredCount === 0`
  - `Ranking` — RankingScreen (ActivityScreen). Label: "Actividad"
- **Regla crítica de headers:** `AppStack` tiene `headerShown: false` globalmente. Para mostrar header hay que ponerlo TANTO en la ruta de RootNavigator (`options={{ headerShown: true }}`) como en el `useEffect` de `navigation.setOptions` dentro de la pantalla
- TabNavigator recarga `fetchPendingCount` y `fetchCompanyName` en cada evento `focus`
- Badge escudo admin: punto rojo si no hay hábitos en el grupo (`hasNoHabits`)
- ProfileScreen usa TabBar manual (no usa el nativo porque la pantalla vive en el AppStack, no en el TabNavigator)

> **Nota histórica:** una versión anterior de la documentación describía un TabNavigator de 4 tabs (Home, ValidateHabit, Ranking, Profile) con una pantalla `History` adicional accesible desde un icono de reloj en el header de Home. Esa estructura evolucionó a la descrita arriba: Profile pasó a ser una ruta del AppStack con TabBar manual, y el historial se integró dentro de ProfileScreen ("historial filtrable"). La descripción completa de `HistoryScreen` se conserva más abajo por si la pantalla o su lógica siguen presentes en el código.

---

## Pantallas

### `LoginScreen`
- Campos: email y contraseña
- Llama a `supabase.auth.signInWithPassword`
- Links a ForgotPasswordScreen y SignUpScreen
- Al iniciar sesión, `onAuthStateChange` en RootNavigator detecta la sesión y navega automáticamente al AppStack

### `ForgotPasswordScreen`
- Campo: email
- Llama a `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'habitapp://reset-password' })` (esa URL está registrada en Supabase → Redirect URLs; la vigila la Fase 7, test 0)
- Muestra mensaje de confirmación tras enviar

### `ResetPasswordScreen` _(RecoveryStack)_
- Se muestra tras abrir el enlace del correo de recuperación (ver RecoveryStack arriba)
- Campos: nueva contraseña y confirmación (mínimo 8 caracteres, deben coincidir)
- Guardar: `supabase.auth.updateUser({ password })` → la sesión real llega por `onAuthStateChange` y la app pasa al AppStack sin volver a iniciar sesión
- Cancelar: confirmación → `supabase.auth.signOut()` + `exitRecoveryMode()` → vuelve a Login sin cambiar la contraseña

### `SignUpScreen`
- Paso `choose`: dos opciones en tarjetas:
  - **"Crear un grupo familiar"** → flujo `create`
  - **"Activar mi cuenta"** → flujo `activate`
- **Flujo `create`:** campos nombre completo, email, contraseña, confirmar contraseña, nombre del grupo (máx. 100 caracteres) → `authFlags.skipNextRedirect = true` → `auth.signUp` → RPC `handle_new_user_registration` con la sesión devuelta → `activateSession(session)` navega al AppStack. El flag evita que `onAuthStateChange` navegue antes de que exista el profile
- **Flujo `activate` — paso 1 (código):** campo numérico de 6 dígitos → RPC `check_activation_code(p_code)` (antes era un SELECT directo sobre `activation_codes`, cambiado en la auditoría de RLS de 2026-09-16 porque la policy SELECT quedó restringida a admins; ver [database.md](database.md#check_activation_codep_code-text--email-full_name-company_id)) → si no devuelve fila muestra error inline; si existe guarda `{ email, full_name, company_id }` y avanza al paso 2
- **Flujo `activate` — paso 2 (contraseña):** email no editable (proviene del código), campos contraseña y confirmar contraseña → `auth.signUp` → RPC `handle_activation_registration` (devuelve `'ok'` o `'invalid_code'`; marca ella misma el código como usado — el cliente ya no hace ningún UPDATE sobre `activation_codes` desde el 2026-09-28) → `activateSession()` navega al AppStack
- **Errores:** todos los errores del alta se muestran traducidos (`normalizeRegistrationError`: código bloqueado, código inválido, límite de miembros, ya registrado, genérico); el texto crudo solo va a la consola
- Validación inline por campo antes de enviar en ambos flujos

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
  - `weekly_x`: muestra progreso semanal ("X/N esta semana"); si `weeklyCount >= weekly_target` → tarjeta completada con fondo verde
  - `monthly_x`: igual que `weekly_x` pero por mes natural (día 1 al último día del mes actual); muestra progreso mensual ("X/N este mes"); si `monthlyCount >= monthly_target` → tarjeta completada con fondo verde
- **Tarjeta completada:** fondo verde muy suave (#F0FAF0), borde izquierdo 3px verde (#2E7D32), icono check Ionicons + texto "Completado hoy" + contadores ✓ N / ✗ N de validaciones recibidas ese día (alineados a la derecha)
- **Tarjeta pendiente:** botón "Completar" → navega a HabitDetailScreen
- **Hora límite (`due_time`):** para hábitos `daily` con `due_time`, muestra "Antes de las HH:MM" en gris. Si la hora ya pasó y el hábito no está completado, se muestra en naranja
- **Expiración (`expires_at`):** fecha (y hora si no es 00:00) visible siempre en gris. Sin color naranja por proximidad de fecha
- **Chip de recompensa:** debajo del título del hábito — "🎯 A X días de: [desc]" / "🎯 A X días de: [desc] · ×N conseguida" (ver sistema de recompensas en [database.md](database.md))
- **Redirección al admin nuevo:** `useEffect` al montar que comprueba si el usuario es admin, no hay hábitos en el grupo y `AsyncStorage('family_setup_done')` es null → navega automáticamente a `AdminScreen` con `{ initialTab: 'family' }`. El flag se guarda en AsyncStorage cuando el admin añade su primer miembro desde la pestaña Familia.
- Reintento automático (500ms) en primer load para evitar race condition de sesión
- Pull-to-refresh, estado vacío, manejo de errores
- Acceso a HabitDetail y HabitStats

### `HabitDetailScreen`
- Recibe el objeto `habit` como param de navegación
- **Foto:** botón principal ancho completo "Cámara" (Ionicons `camera-outline`, fondo BLUE). Sin opción de galería
- Si `habit.photo_required = false`, la foto es opcional: se muestra el botón de cámara pero el usuario puede enviar sin foto
- Preview de la foto seleccionada (height 220)
- **Nota opcional:** TextInput multiline, máx 150 caracteres, debajo del preview
- Al enviar:
  1. Si hay foto, la sube a Storage `habit-photos/{user_id}/{habit_id}/{timestamp}.ext` y obtiene la URL pública
  2. INSERT en `habit_logs` con `status = 'pending'`, `photo_url` (null si no hay foto) y `notes` (null si vacío)
- Spinner durante la subida, mensaje de éxito "¡Prueba enviada!", vuelve a Home tras 1.5s
- **Overlay de celebración:** muestra racha + recompensa; si `achievedReward` muestra caja dorada 🏆 con la descripción en lugar de "¡Sigue así!"

### `ValidateHabitScreen`
- **2 tabs:** "Validar" (logs pending de hábitos donde el usuario es validador) y "Caducados" (hábitos expirados de su grupo)
- **Datos (tab Validar):** habit_logs pendientes de miembros del mismo grupo, filtrados para excluir los ya votados por el usuario actual
- **Queries:**
  1. `habit_logs` → `status = 'pending'`, `user_id != currentUser`, selecciona `id, habit_id, user_id, photo_url, status, notes, created_at`, ordenados por `created_at desc`
  2. **Promise.all** con:
     - `profiles` → nombres y avatares de los autores (por userIds extraídos de los logs)
     - `habits` → títulos y `company_id` para filtrar por grupo (por habitIds extraídos)
     - `habit_validations` → todos los votos para los logIds obtenidos
- **Filtrado:** solo muestra logs de hábitos con `company_id` coincidente y donde `userValidated = false`
- **Votación:** INSERT en `habit_validations` con `status = 'validated'` o `'rejected'`, `comment` (texto libre opcional) y `reaction` (emoji opcional); la constraint UNIQUE previene doble voto a nivel DB
- **Reacciones emoji:** fila de 5 emojis (👏 ❤️ 💪 😊 🌟) entre la foto y el campo de comentario. Al pulsar uno se selecciona (fondo `#EEF3FB`, borde BLUE); al pulsar el mismo se deselecciona. Solo uno seleccionable a la vez. Completamente opcional, no bloquea aprobar/rechazar. Se resetea al pasar al siguiente log
- **UI por tarjeta:** avatar del miembro (foto real si tiene `avatar_url`, inicial si no), nombre, título del hábito, fecha, foto de prueba, nota del log (si existe, en caja gris #F9F9F9), contadores ✓ N / ✗ N, fila de reacciones emoji, campo de comentario, botones Aprobar/Rechazar
- Tras votar el último pendiente → muestra "Todo al día ✓" → navega a Home tras 1 segundo
- Pull-to-refresh, estado vacío
- Un validador vota `validated` o `rejected` → INSERT en `habit_validations`. El log muestra contadores `validatedCount` y `rejectedCount` en tiempo real. `userValidated = true` cuando el validador actual ya votó (bloquea nuevos votos). El status del log (`habit_logs.status`) **no lo actualiza nada**: no existe ningún trigger ni función que lo cambie tras los votos (se inserta `'pending'` y se queda así); el estado real se deriva en cada pantalla de `habit_validations`. Al votar, el item se elimina de la lista del validador (optimistic update). Si la lista queda vacía → navega a Home tras 1 segundo

### `HistoryScreen`
- **Código muerto:** no está registrada en `RootNavigator` ni es accesible desde ninguna pantalla (el antiguo icono de reloj del header de Home ya no existe). Descripción conservada por si se retoma
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

### `HabitStatsScreen`
- Estadísticas de un hábito: racha actual/máxima, tasa de completado, calendario de actividad, últimas validaciones
- **Racha y etiquetas según recurrencia:** para `weekly_x` la racha se cuenta en semanas (`current_streak_weeks`/`best_streak_weeks`) y para `monthly_x` en meses (`current_streak_months`/`best_streak_months`), usando `calculateWeeklyStreak`/`calculateMonthlyStreakForStats` y `calculateWeeklyBestStreak`/`calculateMonthlyBestStreak` respectivamente en vez del cálculo diario por defecto
- Debajo del título, para `weekly_x`/`monthly_x` se muestra la etiqueta del objetivo ("X veces por semana"/"X veces por mes", con `habit.weekly_target`/`habit.monthly_target`)
- **Sección "Recompensas"** al final: badge verde (🏆 conseguida ×N veces) + badge gris (🎯 a X días)

### `AdminScreen`
- Solo accesible para usuarios con `role = 'admin'` (visible vía icono escudo en header de Home)
- **Dos pestañas** con indicador LinkedIn-style (borde inferior azul): **Hábitos** y **Familia**

#### Pestaña Hábitos
- Lista todos los hábitos del grupo ordenados por `created_at DESC`; cada fila muestra "X asignado(s)" (tappable) y un icono de papelera
- Switch por hábito para activar/desactivar (`is_active`) con actualización optimista + rollback en error
- **Icono papelera:** Alert de confirmación destructiva → DELETE en `habits` (CASCADE elimina habit_assignments, habit_validators, habit_rewards, habit_logs y, a través de estos, habit_validations); actualización optimista del estado local
- **Botón "Nuevo hábito":** abre modal de creación

**Modal crear hábito:**
- Campos: título (obligatorio), descripción opcional, recurrencia (pills Diario / Una vez / X veces por semana / X veces por mes)
- Para `daily`: selector nativo de hora (`DateTimePicker` mode='time') para `due_time` opcional
- Para `weekly_x`: stepper numérico (botones − y + con el número en el centro, rango 1–7) para `weekly_target`
- Para `monthly_x`: mismo stepper que `weekly_x` pero con rango 1–28, para `monthly_target`
- Para `once`: selector nativo de fecha + hora (`DateTimePicker` mode='date' y mode='time') para `expires_at` opcional
- Toggle "Foto obligatoria" → guarda en `habits.photo_required` (default true)
- Lista de miembros del grupo con checkboxes para asignar, y otra para elegir validadores. **Excluyentes** desde el 2026-09-30: si se intenta marcar en una lista a quien ya está en la otra, aparece un aviso (`admin.assignee_validator_conflict`) y no se marca; en cada lista, quien ya está en la otra se ve en gris con la etiqueta "validador"/"asignado". La base de datos también lo impide (triggers, ver database.md)
- **Sección Recompensas:** lista editable "🎯 X días → descripción" + formulario inline para añadir
- Al guardar: INSERT en `habits` (con `weekly_target` si `recurrence = 'weekly_x'`, o `monthly_target` si `recurrence = 'monthly_x'`) + INSERT en `habit_assignments` por cada miembro seleccionado

**Modal editar asignaciones:** al pulsar "X asignado(s)" de un hábito → lista de miembros con estado actual → al guardar: DELETE de todas las asignaciones **y** de todos los validadores del hábito, y después INSERT de las nuevas (orden necesario desde el 2026-09-30 para poder intercambiar papeles; build 4)

#### Pestaña Familia
- **Recibe `initialTab: 'family'`** como parámetro de navegación (enviado por HomeScreen en el primer arranque del admin) → `useEffect` lo lee y llama `setActiveTab('family')`
- **Mensaje de bienvenida** (`admin.family_welcome`) cuando no hay miembros ni códigos pendientes — sustituye el onboarding modal eliminado
- **Miembros activos:** lista todos los perfiles del grupo incluyendo el admin actual (muestra badge "Tú" en su fila), cada fila tappable con chevron → modal "Editar miembro"
- **Modal editar miembro:** nombre y avatar con upload a Storage vía RPC `update_member_avatar` (sin campo de email desde el 2026-09-29: `profiles.email` se sincroniza con Auth por trigger); **limitación conocida:** si el miembro ya tenía avatar, el `upsert` del admin falla por RLS (no hay policy UPDATE de admin en Storage, ver `release.md`); toggle de rol Miembro/Administrador (oculto para el usuario actual); botón "Eliminar miembro" en rojo al final del modal con Alert de confirmación destructivo (oculto para el usuario actual). Restricción: no se puede bajar de admin a miembro si es el único administrador del grupo
- **Códigos pendientes:** lista los `activation_codes` WHERE `used = false AND company_id = X`, cada fila tappable con chevron → modal con código en grande, edición de nombre/email, botón compartir y botón "Cancelar invitación" (DELETE)
- **Botón "+ Añadir miembro":** modal con campos nombre y email → genera código de 6 dígitos → INSERT en `activation_codes` → muestra código para compartir → guarda `family_setup_done` en AsyncStorage para que HomeScreen no redirija de nuevo
- **Avatar upload:** `fetch(uri).arrayBuffer()` (no `.blob()` que devuelve 0 bytes en React Native) → Supabase Storage `avatars/{user_id}/avatar.jpg` → RPC `update_member_avatar` (SECURITY DEFINER, bypasea RLS)
- **`MemberAvatar`** componente auxiliar con `onError` para mostrar inicial cuando el archivo no existe; `key={avatar_url}` fuerza remount al cambiar URL
- Pull-to-refresh, estado vacío, manejo de errores por sección

### `RankingScreen` _(archivo real; tab "Actividad", icono `people-outline`)_

Dos secciones, no una lista plana de miembros:

**Sección "Tu actividad"** (`t('activity.your_activity')`):
- Tarjetas **por hábito** (no por miembro), cada una con:
  - Racha actual, con icono de llama 🔥
  - Para `daily`/`weekly_x`: "Week dots" — 7 puntos (uno por día de la semana) con tres estados de color (validado / pendiente / sin actividad)
  - Para `monthly_x`: en su lugar, `MonthlyTargetDots` — un punto por completado del mes hasta `monthly_target`, con el mismo esquema de tres colores
  - Borde izquierdo coloreado con el color de la categoría del hábito (`habit.category.color`)
  - Click en la tarjeta navega a `HabitStats` (`navigation.navigate('HabitStats', { habit, userId })`)

**Sección "Tu familia"** (`t('activity.your_family')`):
- Para el **admin**: detalle expandido por miembro y por hábito
- Para usuarios **no admin**: tarjeta compacta por miembro con racha general y week dots (`calculateGeneralStreak`, `getGeneralWeekDots`)

**Cálculo de rachas:** funciones `calculateStreak`, `calculateGeneralStreak`, `getWeekDots`, `getGeneralWeekDots`, `calculateWeeklyStreak`, `calculateMonthlyStreak` — cubren rachas diarias, semanales y mensuales, no solo diarias.

Sin ranking competitivo ni orden por completados. No existe la tarjeta "usuario actual destacado con fondo HIGHLIGHT" — el color `#EEF3FB` no se usa en esta pantalla (ver [design.md](design.md)).

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
- Historial filtrable, selector de idioma
- Cerrar sesión: `supabase.auth.signOut()` → `onAuthStateChange` navega a AuthStack automáticamente
- **Eliminar mi cuenta** (debajo de "Cerrar sesión", requisito de revisión de Apple): dos `Alert.alert` de confirmación consecutivos (primero explica qué se borra, segundo es la confirmación final e irreversible) → borrado best-effort de los ficheros propios en Storage (`avatars`/`habit-photos`) → RPC `delete_own_account` (borra `profiles`, cascada a hábitos/validaciones propias, y `auth.users`) → `supabase.auth.signOut()`. Sin periodo de gracia, sin anonimización: inmediato y permanente. Detalle técnico completo en [database.md](database.md#delete_own_account).
- Tiene TabBar manual (no usa el nativo porque la pantalla es modal/stack)
