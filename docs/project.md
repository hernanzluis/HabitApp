# HabitApp — Proyecto

## Descripción

Plataforma de hábitos compartidos con validación social entre miembros del grupo. Los usuarios registran hábitos saludables diarios y sus familiares o compañeros de grupo los validan mediante fotografías como prueba. El objetivo es fomentar hábitos positivos mediante la responsabilidad compartida. Diseñado para familias, grupos de amigos y equipos pequeños.

## Perfil de usuario

- Luis Hernanz (hernanz.luis@gmail.com) — creador y desarrollador principal de HabitApp
- Rol admin en el proyecto de Supabase de desarrollo
- Trabaja con iOS primero (Mac/iPhone), Android como secundario
- Usa Expo Go en desarrollo para evitar builds nativos

---

## Stack tecnológico

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
| @react-native-community/datetimepicker | ^9.1.0 (dependencia explícita, no incluida en Expo SDK) |
| expo-localization | ~17.0.9 |
| react-i18next | ^17.0.8 |
| i18next (i18n ES/EN) | ^26.3.0 |
| Node.js | v20 |

**Backend:** Supabase (PostgreSQL + Auth + Storage)
**Repositorio:** https://github.com/hernanzluis/HabitApp
**Directorio local:** /Users/luishernanz/HabitApp

### Configuración de entorno (Supabase)

- URL: https://uvsngemnftpysjvxslhu.supabase.co
- Anon key: sb_publishable_5szIB7W3P5G6XFFYyFjAfw_TwpKNFnp
- Cliente en: /Users/luishernanz/HabitApp/lib/supabase.js
- Auth storage: AsyncStorage, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`

---

## Comandos

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

## Estructura de carpetas

```
HabitApp/
├── assets/                     # Iconos y splash
│   ├── icon.png
│   ├── adaptive-icon.png
│   ├── splash-icon.png
│   └── favicon.png
├── lib/
│   ├── supabase.js             # Cliente Supabase (singleton)
│   ├── authFlags.js            # Singleton para coordinar activación y evitar race condition
│   ├── i18n.js                 # Configuración i18next + detección de idioma
│   └── usePlanInfo.js          # Hook que envuelve la RPC get_company_plan_info
├── navigation/
│   └── RootNavigator.js        # Navegación raíz + lógica de sesión + badge tab
├── screens/
│   ├── LoginScreen.js
│   ├── SignUpScreen.js
│   ├── ForgotPasswordScreen.js
│   ├── HomeScreen.js
│   ├── HabitDetailScreen.js
│   ├── ValidateHabitScreen.js
│   ├── HistoryScreen.js        # Código muerto: no está importada en ninguna navegación (ver nota abajo)
│   ├── RankingScreen.js        # Antes descrita como "ActivityScreen"; label del tab es "Actividad"
│   ├── HabitStatsScreen.js
│   ├── ProfileScreen.js
│   └── AdminScreen.js
├── App.js                      # Punto de entrada (renderiza RootNavigator)
├── index.js                    # Registro de la app con Expo
├── app.json                    # Configuración de Expo
├── package.json
└── docs/                       # Documentación del proyecto (este directorio)
```

> **Nota:** `screens/HistoryScreen.js` sigue presente en el repo con su lógica completa, pero no está importada ni enlazada desde ningún punto de la navegación actual (`RootNavigator.js` no la registra). Es código muerto — su funcionalidad de historial se integró en `ProfileScreen`. Ver [navigation.md](navigation.md).

---

## Decisiones técnicas

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
| Un usuario pertenece a un solo grupo | Simplifica el modelo de datos y toda la lógica de contexto de la app. El caso de uso principal es una familia en un único grupo. Multi-grupo postpuesto deliberadamente a v2 cuando haya demanda real — requeriría tabla group_members (N:N), selector de grupo activo en login y refactor de filtros en todas las pantallas. |
| `authFlags` singleton para activación | Race condition: `skipNextRedirect` evita que `onAuthStateChange` navegue antes de que termine la RPC de registro. SignUpScreen llama a `activateSession(session)` manualmente al terminar. |

---

## Convenciones de código

- Prefiere código sin comentarios salvo que el "por qué" sea no obvio
- No añadir funcionalidades extra no solicitadas ni abstracciones prematuras
- Consultar siempre la documentación versionada de Expo antes de escribir código nativo: https://docs.expo.dev/versions/v54.0.0/

---

## Funcionalidades pendientes (v2)

- **Sistema de equipos:** el admin crea subgrupos dentro del grupo principal; `team_members` ya creada, sin uso activo. Los hábitos podrían asignarse a subgrupos. Requiere extensión de AdminScreen.
- **Notificaciones push:** recordatorio diario para completar hábitos pendientes; notificación cuando un familiar valida tu hábito
- **SplashScreen animada** con logo de la app
- **Mejora de estadísticas en ProfileScreen:** racha actual (días consecutivos con hábito completado), gráfico de actividad mensual
- **Hábitos personales:** tipo 'personal', visibles solo para el usuario, sin validación
- **Perfil de miembro:** al pulsar un nombre en ValidateHabit o ActivityScreen, ver su perfil público (foto, stats, hábitos validados)
- **Edición de perfil completo:** campo de grupo en ProfileScreen (actualmente solo lectura)
- **Modo oscuro**
- **Múltiples grupos por usuario:** tabla group_members (usuario → grupo N:N), selector de grupo activo tras login, filtrado de toda la app por grupo activo seleccionado.

Ya implementado (histórico):
- ~~AdminScreen (ampliación): creación de hábitos nuevos con asignación por miembro~~ ✅
- ~~Sistema de asignación de hábitos: `habit_assignments` para mostrar solo los hábitos asignados a cada usuario~~ ✅
- ~~AdminScreen — gestión de usuarios: vista de miembros del grupo, posibilidad de eliminar/cambiar rol~~ ✅ (pestaña Familia con miembros activos y códigos pendientes)
- ~~AdminScreen — invitaciones históricas / sistema de invitación personal~~ ✅ (tabla `activation_codes`, pestaña Familia, flujo `activate` en SignUpScreen)
- ~~Onboarding guiado para admin nuevo~~ ✅ Resuelto con redirección directa a AdminScreen pestaña Familia
- ~~Foto opcional por hábito: campo `photo_required` en `habits`~~ ✅
- ~~Reacciones rápidas en validación: fila de emojis (👏 ❤️ 💪 😊 🌟)~~ ✅

---

## Usuarios de prueba

| Email | Rol | Empresa |
|---|---|---|
| hernanz.luis@gmail.com | admin | — |

> Las contraseñas no se almacenan en este documento. La confirmación de email está desactivada en el proyecto de Supabase de desarrollo.
