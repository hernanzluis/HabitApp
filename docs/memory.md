---
name: project-habitapp
description: "Contexto completo del proyecto HabitApp — stack, estructura DB, pantallas, navegación, lógica de negocio, producto web y perfil de usuario"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf0ec8a4-cf4b-4b8b-ad5c-0e94c0c5dccc
---

HabitApp es una plataforma de hábitos compartidos con validación social entre miembros de un grupo (familias, amigos, equipos pequeños). Los usuarios registran hábitos diarios con foto como prueba y el grupo los valida.

**Why:** Fomentar hábitos positivos mediante responsabilidad compartida.

## 1. Perfil de usuario
- Luis Hernanz (hernanz.luis@gmail.com) — creador y desarrollador principal de HabitApp
- Rol admin en el proyecto de Supabase de desarrollo
- Trabaja con iOS primero (Mac/iPhone), Android como secundario
- Usa Expo Go en desarrollo para evitar builds nativos
- Prefiere código sin comentarios salvo que el "por qué" sea no obvio
- No quiere funcionalidades extra no solicitadas ni abstracciones prematuras

## 2. Stack
- React Native + Expo SDK ~54.0.33 + React 19.1.0
- Backend: Supabase (PostgreSQL + Auth + Storage)
- Navegación: React Navigation (native-stack + bottom-tabs)
- i18n: i18next (ES/EN) — lib/i18n.js, locales en /locales/es.json y en.json
- Iconos: @expo/vector-icons (Ionicons)
- Repo: https://github.com/hernanzluis/HabitApp
- Directorio local: /Users/luishernanz/HabitApp

## 3. Configuración Supabase
- URL: https://uvsngemnftpysjvxslhu.supabase.co
- Anon key: sb_publishable_5szIB7W3P5G6XFFYyFjAfw_TwpKNFnp
- Cliente en: /Users/luishernanz/HabitApp/lib/supabase.js
- Auth storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false

## 4. Base de datos
- `profiles` — usuarios (id, email, full_name, company_id, role: admin|user, avatar_url)
- `companies` — grupos/empresas (id, name, admin_id)
- `habits` — hábitos (id, title, description, recurrence: daily|weekly_x|monthly_x|once, is_active, expires_at, due_time, company_id, created_by, weekly_target, monthly_target, photo_required, category_id)
- `habit_assignments` — qué hábitos están asignados a qué usuario (habit_id, user_id)
- `habit_validators` — quién puede validar cada hábito (habit_id, user_id)
- `habit_logs` — registro de completados (id, habit_id, user_id, photo_url, status: pending|validated|rejected, notes, created_at)
- `habit_validations` — votos individuales por log (id, habit_log_id, validator_id, status: validated|rejected, reaction, comment, created_at) — UNIQUE (habit_log_id, validator_id)
- `habit_rewards` — recompensas por hábito (id, habit_id, streak_target INT, description TEXT)
- `categories` — categorías (id, name, icon, color, company_id nullable — null = predefinida)
- `invitations` / `activation_codes` — códigos de activación para unirse al grupo (code, email, full_name, company_id)

## 5. Storage (Supabase)
- Bucket `habit-photos` — fotos de prueba de hábitos. Ruta: `{user_id}/{habit_id}/{timestamp}.{ext}`
- Bucket `avatars` — fotos de perfil. Ruta: `{user_id}/avatar.jpg`
- Cache-bust en avatars con `?t=Date.now()` en la URL para forzar recarga

## 6. RPCs SECURITY DEFINER
- `handle_new_user_registration(p_email, p_password, p_full_name, p_company_name)` — crea empresa + usuario admin. Llamado desde SignUpScreen modo "crear grupo"
- `handle_activation_registration(p_password, p_user_email, p_user_full_name, p_activation_code)` — registra usuario con código de activación en empresa existente. Llamado desde SignUpScreen modo "activar cuenta"
- Race condition resuelta con `authFlags` singleton (lib/authFlags.js): `skipNextRedirect` evita que `onAuthStateChange` navegue antes de que termine el RPC. SignUpScreen llama a `activateSession(session)` manualmente al terminar

## 7. Navegación (RootNavigator.js)
- RootNavigator: si hay sesión → AppStack, si no → AuthStack
- **AuthStack** (headerShown: false): Login, ForgotPassword, SignUp
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
- **Regla crítica de headers**: `AppStack` tiene `headerShown: false` globalmente. Para mostrar header hay que ponerlo TANTO en la ruta de RootNavigator (`options={{ headerShown: true }}`) como en el `useEffect` de `navigation.setOptions` dentro de la pantalla
- TabNavigator recarga `fetchPendingCount` y `fetchCompanyName` en cada evento `focus`
- Badge escudo admin: punto rojo si no hay hábitos en el grupo (`hasNoHabits`)

## 8. Pantallas — resumen
- **LoginScreen** — email + password, link a ForgotPassword y SignUp
- **ForgotPasswordScreen** — envío de email de recuperación
- **SignUpScreen** — 2 modos: (1) crear grupo: nombre + email + pass + nombre empresa → RPC `handle_new_user_registration`; (2) activar cuenta: código 6 dígitos → lookup en `activation_codes` → email + pass → RPC `handle_activation_registration`
- **HomeScreen** — lista de hábitos asignados con estado, chip de recompensa próxima, acceso a HabitDetail y HabitStats
- **HabitDetailScreen** — completar hábito: foto (cámara) + nota opcional → upload a Storage → insert en habit_logs → overlay celebración con racha + recompensa
- **ValidateHabitScreen** — 2 tabs: "Validar" (logs pending de hábitos donde es validador) y "Caducados" (hábitos expirados de su grupo)
- **HabitStatsScreen** — estadísticas de un hábito: racha actual/máxima, tasa completado, calendario actividad, últimas validaciones, sección recompensas
- **AdminScreen** — gestión completa: hábitos (crear/editar/toggle/eliminar + recompensas), miembros (añadir/editar/eliminar + códigos activación), categorías
- **RankingScreen** (ActivityScreen) — actividad del grupo por semana, sin ranking competitivo
- **ProfileScreen** — stats personales, edición nombre/avatar, selector idioma, historial filtrable, cerrar sesión. Tiene TabBar manual (no usa el nativo porque la pantalla es modal/stack)

## 9. i18n
- Fichero configuración: /Users/luishernanz/HabitApp/lib/i18n.js
- Detecta idioma del dispositivo al arrancar (expo-localization), guarda preferencia en AsyncStorage (clave: `user_language`)
- Namespaces: common, errors, login, forgot, signup, home, habit_detail, validate, history, profile, admin, nav, stats, activity
- Locales: /Users/luishernanz/HabitApp/locales/es.json y en.json
- Claves relevantes de rewards: `home.reward_next`, `home.reward_next_times`, `home.reward_achieved`, `stats.reward_times`, `stats.reward_pending`, `stats.rewards_title`, `admin.rewards_title`, `admin.add_reward`, `admin.reward_days`, `admin.reward_placeholder`

## 10. Sistema de colores (estilo LinkedIn)
- BG: #F3F2EF — fondo general
- WHITE: #ffffff — tarjetas
- BLUE: #0A66C2 — color principal (botones, iconos activos)
- TEXT: #1D2226 — texto principal
- GRAY: #666666 — texto secundario
- ORANGE: #f97316 — due_time superado
- HIGHLIGHT: #EEF3FB — fila del usuario en Activity
- GREEN: #4CAF50 — celebración racha, estados validados
- RED badge: #DC2626 — punto en escudo admin

## 11. Lógica de validación de hábitos
- Un validador vota `validated` o `rejected` → INSERT en `habit_validations`
- El log muestra contadores `validatedCount` y `rejectedCount` en tiempo real
- `userValidated = true` cuando el validador actual ya votó (bloquea nuevos votos)
- El status del log (`habit_logs.status`) lo actualiza una función de base de datos/trigger, no el cliente
- Al votar, el item se elimina de la lista del validador (optimistic update)
- Si la lista queda vacía → navega a Home tras 1 segundo

## 12. Sistema de recompensas (recursivas/históricas)
- Tabla `habit_rewards`: streak_target (número de completados necesarios), description
- `totalCompleted` = acumulado histórico NUNCA se resetea:
  - `daily` / `once`: días únicos con log (Set de toDateKey)
  - `weekly_x`: semanas donde count ≥ weekly_target
  - `monthly_x`: meses donde count ≥ monthly_target
- `timesAchieved = Math.floor(totalCompleted / streak_target)`
- `daysToNext = streak_target - (totalCompleted % streak_target)`
- Nuevo logro detectado cuando: `Math.floor(newTotal / target) > Math.floor((newTotal - 1) / target)`
- **HomeScreen**: chip debajo del título del hábito — "🎯 A X días de: [desc]" / "🎯 A X días de: [desc] · ×N conseguida"
- **HabitDetailScreen**: overlay celebración — si `achievedReward` muestra caja dorada 🏆 con descripción en lugar de "¡Sigue así!"
- **HabitStatsScreen**: sección "Recompensas" al final — badge verde (🏆 conseguida ×N veces) + badge gris (🎯 a X días)
- **AdminScreen**: sección "Recompensas" en modales crear/editar — lista editable "🎯 X días → descripción" + formulario inline añadir

## 13. Helpers de fechas/cálculo (compartidos entre pantallas)
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

## 14. Decisiones técnicas clave
- `useFocusEffect` en todas las pantallas para recargar datos al ganar foco
- Reintento 500ms en HomeScreen (race condition sesión AsyncStorage al arrancar)
- `Promise.all` siempre con error check en cada resultado (`if (res.error) throw res.error`)
- Un usuario pertenece a un solo grupo (multi-grupo postpuesto a v2)
- Notificaciones push: botón visible pero muestra "Coming soon" (no implementadas)
- ProfileScreen usa TabBar manual porque vive en el AppStack (no en el TabNavigator)

## 15. Producto web — Stack y rutas
- React + React Router v6 + Tailwind CSS v3 + Supabase
- Repo: https://github.com/hernanzluis/habitteam-web
- Directorio local: /Users/luishernanz/habitteam-web
- Desplegado en Vercel en habitteam.app
- Entrada: src/App.js — BrowserRouter con ScrollToTop
- Rutas:
  - `/` → Home.jsx (página pública)
  - `/acceder` → Acceder.jsx (login admin web)
  - `/admin` → Admin.jsx (panel admin)
  - `/admin/miembro/:userId` → MemberDetail.jsx (detalle miembro)
  - `/privacidad` → Privacy.jsx
  - `/terminos` → Terms.jsx
  - `/cookies` → Cookies.jsx

## 16. Producto web — Panel Admin
- Admin.jsx carga perfil del usuario y monta 4 tabs: Actividad, Miembros, Hábitos, Categorías
- Componentes en src/components/admin/:
  - `Activity.jsx` — actividad del grupo
  - `Members.jsx` — gestión de miembros (añadir, editar rol, generar código activación, eliminar)
  - `Habits.jsx` — gestión hábitos: tabla con toggle activo/inactivo, modales crear/editar con sección recompensas. Props: companyId, adminId
  - `Categories.jsx` — gestión categorías
- MemberDetail.jsx — vista detallada de un miembro: perfil, hábitos asignados con calendario mensual, fotos recientes, recompensas por hábito, últimas validaciones recibidas. Incluye lightbox para fotos

## 17. Reglas de trabajo
- RLS y cambios en Supabase (tablas, políticas, funciones, buckets) siempre mediante SQL en el SQL Editor, nunca desde la UI de Supabase
- No añadir funcionalidades no solicitadas
- Consultar docs versionadas de Expo v54 antes de escribir código nativo: https://docs.expo.dev/versions/v54.0.0/
- Instrucciones siempre dentro de bloques de código con triple backtick (para que aparezca el botón de copiar), nunca como texto plano
- Indicar siempre el repo destino al inicio del bloque de código: "Para Code (en HabitApp):" o "Para Code (en habitteam-web):"

## 18. Forma de trabajo
- Claude (asistente de diseño/producto) diseña/piensa los cambios y produce instrucciones para Claude Code
- Cambios en código de la app/web: prompt en prosa para Claude Code (Code lee los ficheros, decide implementación, hace commit y push)
- Cambios en Supabase (tablas, RLS, funciones, buckets): SQL directo que ejecuta Luis en el SQL Editor, nunca vía Code ni UI de Supabase
- Tras cada funcionalidad implementada, se prueba manualmente antes de pasar al siguiente bloque (ej: cambiar `plan` de una company de test y verificar comportamiento)
- Los prompts para Code siempre indican el repo destino: "Para Code (en HabitApp):" o "Para Code (en habitteam-web):"
