# HabitApp - Documento de Proyecto
## Descripción
Plataforma de bienestar corporativo con validación social entre compañeros. Los usuarios registran hábitos diarios y sus compañeros los validan mediante fotos como prueba.
## Stack Tecnológico
- React Native con Expo SDK 52
- Node.js v20
- Supabase (base de datos y autenticación)
- React Navigation (navegación entre pantallas: bottom tabs + stack)
- GitHub: https://github.com/hernanzluis/HabitApp
## Tipos de usuarios
- Admin: crea equipos y hábitos corporativos, gestiona usuarios
- Usuario: crea hábitos personales, sube fotos, valida compañeros
## Tipos de hábitos
- Corporativos: creados por el admin, compartidos con el equipo, validados por compañeros con foto
- Personales: creados por el usuario, privados, no se comparten
## Validación de hábitos
- El usuario sube una foto como prueba
- Un compañero valida la foto
## Gamificación
- Puntos por hábito cumplido y validado
- Rankings individuales y por equipos
- Insignias por rachas y logros
## Base de Datos (Supabase)
- profiles: id, email, full_name, company_id, role, avatar_url, created_at
- companies: id, name, logo_url, admin_id, created_at
- habits: id, title, description, company_id, created_by, type, is_active, created_at, expires_at (opcional)
- habit_logs: id, habit_id, user_id, photo_url, status, validated_by, validated_at, created_at
- teams: id, name, company_id, created_by, created_at
- invitations: tabla para códigos de invitación reutilizables por empresa (un código por empresa, múltiples usuarios pueden registrarse con él)
## Seguridad
- RLS activado en todas las tablas
- Políticas configuradas para INSERT, SELECT y UPDATE
- Función handle_new_user_registration para el registro creando empresa nueva
- Función handle_invited_user_registration para el registro con código de invitación reutilizable (no marca is_used, múltiples usuarios pueden usar el mismo código)
## Storage
- Bucket: habit-photos (público)
- Políticas: INSERT y SELECT para usuarios autenticados
## Pantallas
### Implementadas y validadas ✅
- LoginScreen: login con email y contraseña, validación, mensajes de error
- SignUpScreen: dos flujos de registro — "Crear empresa" (nombre, email, contraseña, nombre de empresa → RPC handle_new_user_registration) y "Tengo un código" (nombre, email, contraseña, código de invitación → RPC handle_invited_user_registration). Selector de flujo en la parte superior de la tarjeta.
- ForgotPasswordScreen: recuperación de contraseña
- HomeScreen: muestra saludo con nombre del usuario, fecha de hoy, lista de hábitos activos de la empresa filtrados por company_id. Solo muestra hábitos cuyo `expires_at` es null o está en el futuro. Si el hábito tiene fecha de expiración la muestra como "Expira el DD/MM/YYYY" en gris; si quedan 3 días o menos el aviso aparece en naranja. Reintento automático (500ms) en la carga inicial para evitar el error de sesión no inicializada con auto-login. Pull-to-refresh, estado vacío y manejo de errores.
- HabitDetailScreen: muestra título y descripción del hábito, permite hacer foto o seleccionar de la galería, sube la imagen a Supabase Storage (bucket `habit-photos`) y crea un registro en `habit_logs` con `status = "pending"`. Incluye spinner durante la subida, mensaje de éxito y vuelve a Home al finalizar.
- ValidateHabitScreen: muestra hábitos pendientes de validación de compañeros de la misma empresa, con foto de prueba, nombre del compañero y título del hábito. Botones Aprobar y Rechazar que actualizan `habit_logs` con `status` validated/rejected, `validated_by` y `validated_at`. Pull-to-refresh y estado vacío.
- RankingScreen: muestra ranking de usuarios de la empresa ordenados por hábitos validados, top 3 con medallas oro/plata/bronce, usuario actual destacado con etiqueta "Tú", estado vacío, pull-to-refresh.
- ProfileScreen: muestra avatar con inicial, nombre, rol, email, empresa y estadísticas de actividad (hábitos completados, validados y validaciones hechas a compañeros). Botón cerrar sesión y pull-to-refresh.
### Pendientes 🔲
- SplashScreen
- AdminScreen: panel de administrador
## Navegación
- Bottom tabs con 4 secciones: Home (casa), Validar (check), Ranking (trofeo), Perfil (persona)
- Barra de tabs con fondo blanco, icono activo en azul marino, inactivo en gris (Ionicons de @expo/vector-icons)
- HabitDetail se abre como pantalla de stack por encima de las tabs, sin tabs visibles
- Cerrar sesión está en ProfileScreen; el cambio de sesión lo gestiona RootNavigator automáticamente mediante onAuthStateChange
## Decisiones técnicas
- iOS primero, Android siempre funcional
- Diseño corporativo flat, azul marino y blanco
- Expo Go para desarrollo, sin builds nativos por ahora
- Confirmación de email desactivada en desarrollo
- Las políticas RLS de `habit_logs`, `habits` y `profiles` tienen `SELECT = true` para permitir lectura entre compañeros de empresa
