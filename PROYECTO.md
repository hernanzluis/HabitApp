# HabitApp - Documento de Proyecto
## Descripción
Plataforma de bienestar corporativo con validación social entre compañeros. Los usuarios registran hábitos diarios y sus compañeros los validan mediante fotos como prueba.
## Stack Tecnológico
- React Native con Expo SDK 52
- Node.js v20
- Supabase (base de datos y autenticación)
- React Navigation (navegación entre pantallas)
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
- habits: id, title, description, company_id, created_by, type, is_active, created_at
- habit_logs: id, habit_id, user_id, photo_url, status, validated_by, validated_at, created_at
- teams: id, name, company_id, created_by, created_at
## Seguridad
- RLS activado en todas las tablas
- Políticas configuradas para INSERT, SELECT y UPDATE
- Función handle_new_user_registration para el registro seguro
## Storage
- Bucket: habit-photos (público)
- Políticas: INSERT y SELECT para usuarios autenticados
## Pantallas
### Implementadas y validadas ✅
- LoginScreen: login con email y contraseña, validación, mensajes de error
- SignUpScreen: registro con nombre, email, contraseña, empresa. Crea usuario en Auth + companies + profiles
- ForgotPasswordScreen: recuperación de contraseña
- HomeScreen: muestra saludo con nombre del usuario, fecha de hoy, lista de hábitos activos de la empresa filtrados por company_id, pull-to-refresh, estado vacío, manejo de errores y botón de cerrar sesión
- HabitDetailScreen: muestra título y descripción del hábito, permite hacer foto o seleccionar de la galería, sube la imagen a Supabase Storage (bucket `habit-photos`) y crea un registro en `habit_logs` con `status = "pending"`. Incluye spinner durante la subida, mensaje de éxito y vuelve a Home al finalizar.
- ValidateHabitScreen: muestra hábitos pendientes de validación de compañeros de la misma empresa, con foto de prueba, nombre del compañero y título del hábito. Botones Aprobar y Rechazar que actualizan `habit_logs` con `status` validated/rejected, `validated_by` y `validated_at`. Pull-to-refresh y estado vacío.
- RankingScreen: muestra ranking de usuarios de la empresa ordenados por hábitos validados, top 3 con medallas oro/plata/bronce, usuario actual destacado con etiqueta "Tú", estado vacío, pull-to-refresh.
- ProfileScreen: muestra avatar con inicial, nombre, rol, email, empresa y estadísticas de actividad (hábitos completados, validados y validaciones hechas a compañeros). Botón cerrar sesión y pull-to-refresh.
### Pendientes 🔲
- SplashScreen
- AdminScreen: panel de administrador
## Decisiones técnicas
- iOS primero, Android siempre funcional
- Diseño corporativo flat, azul marino y blanco
- Expo Go para desarrollo, sin builds nativos por ahora
- Confirmación de email desactivada en desarrollo
- Las políticas RLS de `habit_logs`, `habits` y `profiles` tienen `SELECT = true` para permitir lectura entre compañeros de empresa
