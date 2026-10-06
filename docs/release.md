# HabitApp — Checklist de lanzamiento (v1)

Qué tiene que estar cerrado antes de publicar la app en las stores con
registro abierto a desconocidos. Creado el 2026-09-28. Cada ítem dice
**quién** lo hace y **cómo se verifica**. Un ítem solo se marca cuando está
verificado, no cuando se ha hecho.

## Bloqueantes

- [x] **Confirmación de email desactivada** (Luis, dashboard → Authentication → Providers → Email → Confirm email OFF). Decisión v1: menos pasos en el alta y un fallo menos durante la revisión de Apple; se puede reactivar en la 1.1 con una página `/confirmado` en habitteam-web. Verificado 2026-09-28: `GET /auth/v1/settings` → `mailer_autoconfirm: true`. Guarda permanente: `tests/test-08-registro-seguro.js`, test 0.
- [x] **Site URL = `https://habitteam.app`** (Luis, dashboard → Authentication → URL Configuration). Hecho a 2026-09-29, confirmado por Luis. Las Redirect URLs (`habitapp://reset-password`) no se tocan. Detalle en `project.md`, "Configuración externa".
- [x] **SMTP propio** — Resend, dominio de envío `updates.habitteam.app` (DKIM + SPF), conectado con la integración directa Resend → Supabase, remitente `team@updates.habitteam.app` ("HabitApp"). Hecho a 2026-09-29, confirmado por Luis. Detalle en `project.md`, "Configuración externa". Queda por probar la entrega real: `manual-testing.md`, bloque 2, ítem de "correo real" — no automatizable.
- [ ] **DMARC de `updates.habitteam.app`** — registro `_dmarc` TXT en Namecheap. Opcional, pero recomendado antes de enviar volumen real de correo (mejora la entrega y evita suplantación del dominio).
- [x] **Que Supabase no se pause por inactividad** — resuelto el 2026-09-29 con un ping gratuito: workflow `.github/workflows/supabase-keepalive.yml` (GitHub Actions, cada 3 días + lanzamiento manual con `workflow_dispatch`) que llama a `public.keepalive()` con la anon key (`sql/2026-09-29_keepalive.sql`, aplicado con aprobación de Luis). Requiere el secret `SUPABASE_ANON_KEY` y la variable `SUPABASE_URL` en GitHub (los crea Luis). Primera ejecución manual correcta el 2026-09-29 (run 36546599381, `Respuesta: 1`; el run anterior falló porque la variable `SUPABASE_URL` tenía el valor de ejemplo `https://<ref>.supabase.co`). Ojo: en un repo público GitHub desactiva los workflows programados tras 60 días sin commits (avisa por email). Detalle en `project.md`, "Configuración externa".
- [x] **Registro seguro** — `sql/2026-09-28_registro_seguro.sql` (aplicado 2026-09-28) + corrección `sql/2026-09-28b_activacion_rate_limit.sql` (lo ejecuta Luis en el SQL Editor; requiere la confirmación de email ya desactivada). Cierra: RPCs de alta ejecutables sin sesión, `user_id`/email del cliente, código de activación no ligado al email, rate limiting esquivable llamando a la RPC directamente, y la policy que permitía quemar códigos ajenos. Verificado 2026-09-28: fases 1-8 ejecutadas dos veces seguidas, 139/139 en ambas, sin residuos `zztest-`. Detalle en `tests/README.md`.
- [x] **Lecturas entre empresas y funciones expuestas a anon** — cerrado el 2026-09-28 (aprobado por Luis en el chat): SELECT por empresa en todas las tablas, `anon` sin privilegios de tabla y sin EXECUTE salvo `check_activation_code` (y, desde el 2026-09-29, `keepalive()`), Storage opción 1 (listado solo de la propia empresa; buckets siguen públicos), `invitations` y `handle_invited_user_registration` eliminadas, 80 ficheros huérfanos borrados (copia en `~/habitapp-backups/`). Detalle y verificación: `docs/security-inventory-2026-09-28.md`; SQL aplicados `sql/2026-09-28c`–`h`.

## Revisar antes del lanzamiento (no bloqueantes por sí mismos)

- [x] **Otras funciones `SECURITY DEFINER` expuestas a `anon`** — revisadas y cerradas el 2026-09-28 (ver el ítem anterior).
- [x] **`profiles.id` sin FK a `auth.users`** — FK `profiles_id_fkey` ON DELETE CASCADE añadida el 2026-09-28 (`sql/2026-09-28g`).
- [ ] **`check_habit_limit` sin backstop de servidor** — decisión de producto pendiente, ver `tests/README.md`, sección 6.
- [ ] **Login con "Email not confirmed"** — solo aplica si se reactiva la confirmación: hoy `LoginScreen.js` muestra el mensaje en inglés tal cual, sin opción de reenviar el correo.
- [ ] **Storage: buckets públicos** — con la opción 1 aplicada, una ruta conocida se abre sin sesión (URL pública o `download()`). Cerrarlo del todo es la opción 2 (buckets privados + URLs firmadas, 1,5-2,5 días), prevista para la 1.1.
- [ ] **Avatar de miembro por el admin** — el `upsert` de AdminScreen sobre un avatar ya existente falla por RLS (no hay policy UPDATE de admin en Storage). Anterior al 2026-09-28; necesita una policy nueva aprobada.
- [x] **Email editable en el modal de miembro (AdminScreen)** — quitado el 2026-09-29 (el email se sincroniza con Auth por trigger; editarlo ahí no tenía efecto). habitteam-web no tenía ese campo. Pendiente de probar en dispositivo: `manual-testing.md`, bloque 9.
- [ ] **Borrado de cuenta y Storage** — `delete_member` no limpia los ficheros del miembro borrado (el borrado de la propia cuenta sí lo intenta desde el cliente): origen de los 80 huérfanos borrados el 2026-09-28.
- [x] **Tests tras el cierre de seguridad** — hecho el 2026-09-29: Fase 4 test 5 invertido, tests 0/4/5/6 ajustados y Fase 9 nueva (71 tests). Fases 0-9 dos veces seguidas: 218/218 en ambas, sin residuos. Ese mismo día la Fase 9 pasó a 72 tests (control de `keepalive()`) y, con el refuerzo de la barrera de limpieza (Fase 0: 12 tests; Fase 8: 42), el total actual es 226. Detalle en `tests/README.md`.

## Camino a la App Store (iOS)

- [x] **Preparación de EAS** — `app.json` (HabitTeam, `com.luishernanz.habitteam`, scheme `habitapp`, solo iPhone, permisos de cámara y fotos en ES/EN, sin micrófono), `eas.json` (perfil `production`, número de build remoto). `expo-doctor` 21/21 y bundle iOS sin secretos del `.env`, comprobados el 2026-09-29.
- [x] **Primer build de tienda** — `eas build --platform ios --profile production`: **build 3**, versión 1.0.0, commit `4b6393d`, terminado el 2026-09-29 (lo lanza Luis; credenciales de Apple gestionadas por EAS).
- [ ] **Envío a App Store Connect** — `eas submit --platform ios --latest`, en curso el 2026-09-29 (en cola de EAS). Se verifica cuando el build aparezca procesado en TestFlight.
- [ ] **Pruebas en dispositivo con TestFlight** — repasar `manual-testing.md` en el iPhone con el build nativo, en especial el bloque 2 (deep link de recuperación con un correo real) y los textos de permisos en ES/EN.
- [ ] **Ficha de App Store** — metadatos, capturas de iPhone, URL de la política de privacidad (`https://habitteam.app/privacidad`) y cuestionario de privacidad de datos, antes de enviar a revisión.
- [ ] **Limitación conocida del build 3: intercambiar asignado/validador** — desde el 2026-09-30 la base de datos impide que una misma persona sea asignada y validadora del mismo hábito (`sql/2026-09-30_asignado_no_validador.sql`). El build 3 guarda la edición en un orden (asignados antes de borrar validadores) que choca con esa regla, así que **no se pueden intercambiar los papeles de asignado/validador entre dos personas en una sola edición**: da el error "Una misma persona no puede estar asignada…". Mientras tanto, hacerlo **en dos pasos** (primero quitar a cada persona de su lista y guardar; después marcarlas en la nueva y guardar). Lo corrige `AdminScreen.js` (commit del 2026-09-30), que llega a TestFlight con el **build 4** (no hay `expo-updates`, así que los cambios de JavaScript requieren build). Crear hábitos y editarlos sin intercambiar papeles funciona igual en el build 3. La web ya está corregida (Vercel).

- [ ] **Limitación conocida del build 4: "Todo al día ✓" tapa pendientes nuevos (Validar)** — encontrada por Luis el 2026-10-05 en el iPad de Lucia. Si en una sesión se vacía la lista de Validar (votar el último pendiente → "Todo al día ✓" → Inicio) y **sin cerrar la app** llega un pendiente nuevo, al ir a Validar (tocando el aviso o la pestaña) se sigue viendo "Todo al día ✓" aunque el contador marque 1. Causa: `allDone` (`ValidateHabitScreen.js`) se activaba y nunca volvía a `false` mientras la pantalla siguiera montada, y las pestañas no se desmontan al cambiar de pestaña ni al ir a segundo plano. **Workaround en el build 4: cerrar la app del todo y volver a abrirla.** Deslizar para actualizar **no** lo resuelve: la pantalla de "Todo al día ✓" no tiene esa opción y además tapa la lista aunque se recargue. Además, ninguna pantalla se recargaba al volver a primer plano: con Inicio o Actividad como pestaña activa, los datos se quedaban viejos hasta cambiar de pestaña.
  - **Arreglado en el código el 2026-10-05, pendiente del build 5** (solo JavaScript; sin `expo-updates`, llega con el próximo build). Tres commits:
    - `allDone` se resetea en cada carga, y el temporizador de 1 s a Inicio se cancela al recargar, al salir de la pantalla y al desmontar;
    - recarga común `lib/useReloadOnFocus.js` en Validar, Inicio y Actividad: al enfocar; al volver a primer plano si la pantalla está enfocada y la última carga tiene más de 30 s; siempre al tocar un aviso (parámetro `pushAt` de RootNavigator); nunca dos cargas a la vez. El contador de Validar también se refresca al volver a primer plano;
    - el contador y la lista usan la misma regla (`lib/pendingValidations.js`).
  - **Hallazgo del contador del admin:** el número rojo de la pestaña Validar no incluía los hábitos de la empresa **sin ningún validador** (que el admin sí ve en la lista) ni filtraba por empresa, así que a un admin le podía marcar menos de lo que veía. Comprobado el 2026-10-05 con los datos reales (solo lectura): hoy coinciden (Lucia 1, Luis 0) porque Luis no tiene hábitos sin validadores. Efecto secundario del arreglo: el contador de caducados se calcula siempre (antes se saltaba si no había pendientes de validar, y la pestaña podía quedar desactivada con caducados pendientes).
  - **No confirmado:** en el primer fallo, Luis vio que la lista aparecía "al navegar un poco por la app". Con `allDone` atascado eso no debería ocurrir hasta un arranque en frío; posiblemente iOS reinició la app en segundo plano.
  - Pruebas manuales: `manual-testing.md`, bloque 3b ("Recarga al tocar un aviso o al volver a primer plano").

## Credenciales de Apple (referencia)

Qué credenciales existen y para qué sirve cada una (comprobado con la salida
de `eas build` del build 4, el 2026-09-30). **Los identificadores concretos no
se guardan en este repositorio, que es público.** Se consultan en el panel de
**Apple Developer** (Certificates, Identifiers & Profiles; Keys) y con
**`eas credentials`** (EAS los gestiona).

- **Clave APNs (push):** la clave `.p8` con la que se firman los envíos a
  APNs. La creó EAS el 2026-09-30. Las claves `.p8` **no caducan**. Es la
  única de la cuenta (límite: 2 por cuenta; ver `push-notifications-plan.md`).
- **Team ID:** el identificador de la cuenta de Apple Developer (cuenta
  individual de Luis).
- **Certificado de distribución:** firma los builds de tienda. **Caduca el
  2027-09-29**: es la fecha de 2027 que se veía en `eas credentials`. Hay que
  renovarlo antes; EAS lo pedirá en el primer build posterior a esa fecha.
- **Perfil de aprovisionamiento (App Store):** el anterior quedó invalidado al
  activar la capacidad Push, y EAS generó uno nuevo con el build 4, que caduca
  con el certificado (2027-09-29). Una anotación antigua confundió el
  identificador de ese perfil anterior con el Team ID; se aclaró el
  2026-10-02 con la salida de `eas credentials`.
- **App Store Connect API Key:** guardada en EAS. La usó el build 4 para
  regenerar el perfil sin pedir el login de Apple, y la usa `eas submit`.
- **Apple ID numérico de la app (`ascAppId`):** está en `eas.json`, porque
  EAS lo necesita para enviar a TestFlight.

## Notificaciones push (estado a 2026-10-02)

- **Etapas 0-2 (clave APNs, almacenamiento de tokens, cliente):** completas. El cliente está probado en el build 4 (TestFlight).
- **Etapa 3, avisos por evento: completa.** Los tres tipos están confirmados de punta a punta el 2026-10-02 con dos dispositivos reales (iPhone de Luis, iPad de Lucia; `manual-testing.md`, bloque 3c), con las entregas en `ticket_ok`:
  - "pendiente de validar";
  - "hábito asignado";
  - "resultado de la validación".

  Piezas: triggers en la base, `pg_net` y la Edge Function `push-events`; cubiertos por la Fase 11 (45 tests). Diseño en `push-etapa3-diseno.md` y `push-etapa3b-diseno.md`.
- **Pendiente:**
  - el **resumen de validación cuando algún validador no vota**: hueco aceptado, quinta pieza aparte, pendiente de decidir cuántas horas esperar y a qué hora enviarlo;
  - la **consulta de *receipts*** de Expo (la confirmación definitiva de Apple), que en el plan iba en la etapa 6 y no entró en el diseño del recordatorio. Hoy los tokens muertos solo se desactivan cuando Expo los rechaza en el ticket;
  - activar la exigencia de *Enhanced Push Security* en EAS (Luis). Hoy la función ya envía con `EXPO_ACCESS_TOKEN`.
- **Recordatorio diario (etapa 6): completo.** Programado con `pg_cron` desde el 2026-10-02 a las 22:01 de Madrid. La prueba real (3 y 4/10) está superada (`manual-testing.md`, bloque 3d): 3 recordatorios a las 20:00, todos en `ticket_ok`, sin duplicados y sin fallos en las ejecuciones horarias.
- **Lo pendiente de push no necesita un build nuevo** (es de servidor). El arreglo de la recarga de Validar/Inicio/Actividad sí: va en el build 5 (ver "Limitación conocida del build 4").

## Hallazgos de proceso

### 🟠 Trigger de push aplicado sin ensayo con ROLLBACK — 2026-10-02

- **Qué se esperaba:** como en todos los cambios de base anteriores, un ensayo
  del SQL dentro de una transacción terminada en `ROLLBACK` y, solo después,
  la aplicación con copia de seguridad. Luis había aprobado aplicar el trigger
  (`sql/2026-10-02b_push_events_trigger.sql`), pero el ensayo era un paso
  previo obligatorio.
- **Qué pasó:** el fichero estaba bien escrito como fichero de *aplicación*,
  con su propio `begin; … commit;`, igual que todos los SQL versionados. El
  fallo estuvo en cómo Code montó el ensayo: abrió una transacción en psql
  (`begin;`) e incluyó el fichero con `\i`, suponiendo que esa transacción
  exterior lo envolvería. No fue así. El `begin;` del fichero solo produjo un
  aviso (*"there is already a transaction in progress"*) y su `commit;`
  confirmó la transacción abierta: el trigger quedó aplicado. Además, el
  ensayo ni siquiera terminaba en `ROLLBACK`.
  - En el ensayo de la parte 1 (`2026-10-02_push_events.sql`), una hora
    antes, sí se había hecho bien: se quitó el `commit;` con `sed` y se añadió
    `rollback;` al final.
  - `ON_ERROR_STOP` no lo paró porque era un aviso, no un error.
- **Daño:** ninguno. El cambio estaba aprobado, la copia
  (`~/habitapp-backups/2026-10-02-pre-push-trigger/`) se hizo antes y la
  Fase 11 lo verificó (30/30). Pero se saltó una salvaguarda acordada, y con
  un SQL no aprobado el resultado habría sido un cambio en producción sin
  aprobación.
- **Causa de fondo:** el mismo fichero servía para ensayar y para aplicar, y
  convertirlo en ensayo dependía de transformarlo a mano en cada ocasión.
  Cada vez se hacía de una forma distinta.
- **Salvaguarda (aprobada por Luis y adoptada el 2026-10-02):**
  - Los SQL nuevos no llevan `begin`/`commit`/`rollback`: solo el cambio en
    sí. La transacción la ponen siempre los scripts.
  - `scripts/sql-ensayo.sh <fichero>` lo ejecuta entre `BEGIN` y `ROLLBACK`.
    Da el ensayo por fallido ante cualquier error, ante un aviso de
    transacción (*"already a transaction in progress"* / *"there is no
    transaction in progress"*), si la última orden no fue `ROLLBACK`, o si la
    huella del catálogo cambia entre antes y después: funciones con su cuerpo
    y permisos, tablas, columnas, restricciones, triggers, policies,
    extensiones, esquemas y nombres de secretos de Vault.
  - `scripts/sql-aplica.sh <fichero>` hace la copia de seguridad en
    `~/habitapp-backups/AAAA-MM-DD-pre-<nombre>/` y ejecuta el fichero en una
    sola transacción (`psql --single-transaction`, `ON_ERROR_STOP`).
  - Los dos rechazan el fichero **antes de conectarse** si contiene, fuera de
    comentarios, cadenas y cuerpos `$$…$$`, sentencias `BEGIN`, `COMMIT`,
    `ROLLBACK`, `END`, `ABORT`, `START TRANSACTION`, `SAVEPOINT`, `RELEASE` o
    `PREPARE TRANSACTION`, o metacomandos de psql (`\i`, `\c`, …). Lo hace
    `scripts/sql-sin-transaccion.py`. Probado con el fichero del trigger
    (rechazado por su `begin`/`commit`, no por el `begin`/`end` de plpgsql),
    con variantes (`COMMIT` en mayúsculas, `\i`, `start transaction`), con un
    ensayo inocuo (OK, catálogo sin cambios) y con un ensayo con error
    (fallido).
  - Regla en `workflow.md`: en la base solo se ensaya y se aplica con esos
    dos scripts. Los SQL ya aplicados se quedan tal cual, como historial.
