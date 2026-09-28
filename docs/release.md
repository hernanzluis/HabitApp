# HabitApp — Checklist de lanzamiento (v1)

Qué tiene que estar cerrado antes de publicar la app en las stores con
registro abierto a desconocidos. Creado el 2026-09-28. Cada ítem dice
**quién** lo hace y **cómo se verifica**. Un ítem solo se marca cuando está
verificado, no cuando se ha hecho.

## Bloqueantes

- [x] **Confirmación de email desactivada** (Luis, dashboard → Authentication → Providers → Email → Confirm email OFF). Decisión v1: menos pasos en el alta y un fallo menos durante la revisión de Apple; se puede reactivar en la 1.1 con una página `/confirmado` en habitteam-web. Verificado 2026-09-28: `GET /auth/v1/settings` → `mailer_autoconfirm: true`. Guarda permanente: `tests/test-08-registro-seguro.js`, test 0.
- [ ] **Site URL = `https://habitteam.app`** (Luis, dashboard → Authentication → URL Configuration). Las Redirect URLs (`habitapp://reset-password`) no se tocan. No verificable desde la API pública (`/auth/v1/settings` no expone el Site URL) — lo confirma Luis.
- [ ] **SMTP propio** (Luis, dashboard → Authentication → SMTP Settings, proveedor tipo Resend/SendGrid/Mailgun, remitente verificado en `habitteam.app`). Sin él, el correo de recuperación de contraseña solo llega a miembros de la organización de Supabase, con un límite de 2 correos/hora. Verificación: `manual-testing.md`, bloque 2, ítem de "correo real" — no automatizable.
- [x] **Registro seguro** — `sql/2026-09-28_registro_seguro.sql` (aplicado 2026-09-28) + corrección `sql/2026-09-28b_activacion_rate_limit.sql` (lo ejecuta Luis en el SQL Editor; requiere la confirmación de email ya desactivada). Cierra: RPCs de alta ejecutables sin sesión, `user_id`/email del cliente, código de activación no ligado al email, rate limiting esquivable llamando a la RPC directamente, y la policy que permitía quemar códigos ajenos. Verificado 2026-09-28: fases 1-8 ejecutadas dos veces seguidas, 139/139 en ambas, sin residuos `zztest-`. Detalle en `tests/README.md`.
- [ ] **Lecturas entre empresas** — las policies `SELECT` de `habits`, `habit_logs`, `habit_validations` (y también `habit_assignments`, `habit_validators`, `habit_rewards`, `categories`, según `database.md`) son `true` para cualquier autenticado y se filtran por empresa solo en el cliente. Con registro abierto, cualquiera puede leer los datos de todas las familias llamando a la API. Aceptado cuando la app era de un único grupo; hay que decidirlo y cerrarlo antes del lanzamiento público. Pendiente de diseño.

## Revisar antes del lanzamiento (no bloqueantes por sí mismos)

- [ ] **Otras funciones `SECURITY DEFINER` expuestas a `anon`** — la sección 5 del SQL de registro seguro las lista (solo lectura). Revisar el resultado, en especial `handle_invited_user_registration` (discontinuada, sin llamadas en el código, `invitations` vacía a 2026-09-28) y `update_member_profile` (existe en la API y no está documentada en `database.md`).
- [ ] **`profiles.id` sin FK a `auth.users`** — comprobado 2026-09-28 (0 profiles huérfanos a esa fecha). Tras el SQL de registro seguro no hay camino de cliente para crear uno, pero la FK lo garantizaría a nivel de datos. Revisar antes cómo interactúa con `delete_member`/`delete_own_account` (borran `profiles` y luego `auth.users`).
- [ ] **`check_habit_limit` sin backstop de servidor** — decisión de producto pendiente, ver `tests/README.md`, sección 6.
- [ ] **Login con "Email not confirmed"** — solo aplica si se reactiva la confirmación: hoy `LoginScreen.js` muestra el mensaje en inglés tal cual, sin opción de reenviar el correo.
