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
- [x] **Lecturas entre empresas y funciones expuestas a anon** — cerrado el 2026-09-28 (aprobado por Luis en el chat): SELECT por empresa en todas las tablas, `anon` sin privilegios de tabla y sin EXECUTE salvo `check_activation_code`, Storage opción 1 (listado solo de la propia empresa; buckets siguen públicos), `invitations` y `handle_invited_user_registration` eliminadas, 80 ficheros huérfanos borrados (copia en `~/habitapp-backups/`). Detalle y verificación: `docs/security-inventory-2026-09-28.md`; SQL aplicados `sql/2026-09-28c`–`h`.

## Revisar antes del lanzamiento (no bloqueantes por sí mismos)

- [x] **Otras funciones `SECURITY DEFINER` expuestas a `anon`** — revisadas y cerradas el 2026-09-28 (ver el ítem anterior).
- [x] **`profiles.id` sin FK a `auth.users`** — FK `profiles_id_fkey` ON DELETE CASCADE añadida el 2026-09-28 (`sql/2026-09-28g`).
- [ ] **`check_habit_limit` sin backstop de servidor** — decisión de producto pendiente, ver `tests/README.md`, sección 6.
- [ ] **Login con "Email not confirmed"** — solo aplica si se reactiva la confirmación: hoy `LoginScreen.js` muestra el mensaje en inglés tal cual, sin opción de reenviar el correo.
- [ ] **Storage: buckets públicos** — con la opción 1 aplicada, una ruta conocida se abre sin sesión (URL pública o `download()`). Cerrarlo del todo es la opción 2 (buckets privados + URLs firmadas, 1,5-2,5 días), prevista para la 1.1.
- [ ] **Avatar de miembro por el admin** — el `upsert` de AdminScreen sobre un avatar ya existente falla por RLS (no hay policy UPDATE de admin en Storage). Anterior al 2026-09-28; necesita una policy nueva aprobada.
- [x] **Email editable en el modal de miembro (AdminScreen)** — quitado el 2026-09-29 (el email se sincroniza con Auth por trigger; editarlo ahí no tenía efecto). habitteam-web no tenía ese campo. Pendiente de probar en dispositivo: `manual-testing.md`, bloque 9.
- [ ] **Borrado de cuenta y Storage** — `delete_member` no limpia los ficheros del miembro borrado (el borrado de la propia cuenta sí lo intenta desde el cliente): origen de los 80 huérfanos borrados el 2026-09-28.
- [x] **Tests tras el cierre de seguridad** — hecho el 2026-09-29: Fase 4 test 5 invertido, tests 0/4/5/6 ajustados y Fase 9 nueva (71 tests). Fases 0-9 dos veces seguidas: 218/218 en ambas, sin residuos. Detalle en `tests/README.md`.
