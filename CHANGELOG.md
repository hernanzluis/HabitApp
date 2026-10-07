# Changelog — HabitTeam (app iOS)

Una entrada por build enviado a TestFlight o a la App Store, de más reciente a
más antiguo. Cada build tiene un tag `build-N` sobre el commit exacto del que
salió (según EAS). La app no usa `expo-updates`: cualquier cambio de la app
(JavaScript incluido) solo llega a los usuarios con un build nuevo.

Los cambios del servidor (Supabase) no dependen de ningún build y se aplican
en cuanto se despliegan; están aparte, al final, porque importan para saber
qué deshacer en un rollback.

---

## Sin publicar (en `master`, viajará en el build 5)

### Arreglado
- **Validar: los pendientes nuevos ya no quedan tapados por "Todo al día ✓".**
  Si en una sesión se vaciaba la lista votando el último pendiente y, sin
  cerrar la app, llegaba otro, la pantalla seguía mostrando "Todo al día ✓"
  aunque el contador de la pestaña marcara 1. Encontrado con el build 4 el
  2026-10-05 (`dfd03a6`).
- **Las pantallas se actualizan solas.** Validar, Inicio y Actividad se
  recargan al volver a la app desde segundo plano (si llevaban más de 30 s
  sin cargar) y siempre al tocar un aviso que lleva a ellas, aunque ya fueran
  la pantalla abierta. El número rojo de la pestaña Validar también se
  actualiza al volver a la app (`c1015be`).
- **El número rojo de Validar coincide con la lista.** Antes no contaba los
  hábitos del grupo sin ningún validador (que el administrador sí ve en la
  lista), así que a un administrador le podía marcar menos. Además, el
  aviso de hábitos caducados ahora se calcula siempre (`24e8171`).

Pruebas pendientes en el dispositivo: `docs/manual-testing.md`, bloque 3b
("Recarga al tocar un aviso o al volver a primer plano").

### Nuevo
- **Icono propio de la app en iOS**, aportado por Luis, en lugar del de
  plantilla de Expo (`assets/icon.png`). Se ve en la pantalla de inicio y en
  TestFlight a partir del build 5.

### Pendiente (no entra en el build 5 salvo que se decida antes)
- La pantalla de arranque sigue con la imagen de plantilla: necesita el
  símbolo sin fondo en PNG transparente, que Luis aún no tiene.
- Icono de Android y favicon de la app, de plantilla (no urgente: la v1 es
  solo iPhone).
- Web (habitteam-web, sin build): `logo192.png`, `logo512.png`,
  `favicon.ico` y `manifest.json`, que aún dice "React App".
- El icono procede de un WebP comprimido de 54 KB: si Luis aporta una versión
  de mejor calidad, se repite el relleno de las esquinas con el mismo script.

---

## Build 4 — versión 1.0.0 (`build-4`, commit `ef139fe`)

Compilado en EAS el 2026-09-30, con el envío a TestFlight programado en EAS ese
mismo día. Instalado desde TestFlight y probado en el dispositivo el 2026-10-02.

### Nuevo
- **Notificaciones push** (`ef139fe`). La app pide permiso con una
  explicación previa (solo la primera vez), registra el dispositivo con su
  idioma y zona horaria, y lo da de baja al cerrar sesión. En Perfil hay una
  fila "Notificaciones" (Activadas / Activar / Desactivadas · Ajustes).
  Al tocar un aviso se abre su pantalla: "Pendiente de validar" → Validar;
  "Resultado de la validación" → estadísticas del hábito; el resto → Inicio.
  Probado en el dispositivo el 2026-10-02 (`docs/manual-testing.md`,
  bloque 3b). En el build 4 solo existía la parte de la app: los avisos
  reales los envía el servidor desde el 2026-10-02 (ver "Cambios de
  servidor").

### Arreglado
- **Una misma persona ya no puede ser asignada y validadora del mismo
  hábito** (`3ee86e4`). Era un caso real: un hábito así no lo podía validar
  nadie. Administración marca en gris a quien ya está en la otra lista,
  avisa si se intenta y, al editar, guarda en un orden que permite
  intercambiar los papeles de dos personas en una sola edición (en el
  build 3 había que hacerlo en dos pasos).

### Limitación conocida
- "Todo al día ✓" puede tapar pendientes nuevos en Validar. Solución
  temporal: cerrar la app del todo y volver a abrirla. Arreglado para el
  build 5 (ver "Sin publicar").

---

## Build 3 — versión 1.0.0 (`build-3`, commit `4b6393d`)

Compilado en EAS el 2026-09-29. Es el primer build de tienda. El envío a App
Store Connect se lanzó ese mismo día; **no hay registro en el repositorio de
cuándo terminó de procesarse en TestFlight**.

### Contenido
- Primera versión enviada a TestFlight, con la app tal como estaba en ese
  commit: hábitos compartidos dentro de un grupo, validados por otros
  miembros con una foto como prueba; alta creando un grupo o con código de
  activación; recuperación de contraseña por correo; estadísticas por
  hábito, actividad del grupo, perfil y administración del grupo.
- Solo iPhone (`supportsTablet: false`, `4b6393d`).
- Textos de los permisos del sistema en español e inglés; la app ya no pide
  acceso al micrófono (`1134e8e`).

### Seguridad y datos en este build
- **Alta segura** (`3dcc0a8`): la pantalla de registro deja de modificar
  directamente los códigos de activación (lo hace el servidor) y todos los
  errores del alta se muestran con un texto traducido.
- Administración: se quita el campo de email del modal de miembro, que no
  tenía efecto porque el email lo sincroniza el servidor (`fa72834`).

### Limitación conocida
- No se podían intercambiar los papeles de asignado y validador entre dos
  personas en una sola edición (hacerlo en dos pasos). Arreglado en el
  build 4.

---

## Cambios de servidor sin build (Supabase)

Se aplican en cuanto se despliegan, sean cuales sean los builds instalados.
El SQL de cada cambio está versionado en `sql/` (con copia de seguridad
previa en cada aplicación) y la Edge Function en `supabase/functions/`.

| Fecha | Cambio | Ficheros | Commit |
|---|---|---|---|
| 2026-09-28 | Registro seguro: las RPC de alta exigen la sesión del propio usuario, toman el email de Auth y ligan el código de activación a su invitado; límite de intentos dentro de la RPC | `sql/2026-09-28_registro_seguro.sql`, `2026-09-28b` | `3dcc0a8` |
| 2026-09-28 | Cierre de la API pública: lecturas solo de la propia empresa, sin acceso para usuarios sin sesión (salvo comprobar un código de activación), Storage con listado por empresa, tabla `invitations` eliminada | `sql/2026-09-28c` a `2026-09-28h` | `18ba9d2` |
| 2026-09-29 | Ping anti-pausa del proyecto (`keepalive()`, llamado por GitHub Actions) | `sql/2026-09-29_keepalive.sql`, `.github/workflows/supabase-keepalive.yml` | `a1e876c` |
| 2026-09-30 | Triggers que impiden que una persona sea asignada y validadora del mismo hábito | `sql/2026-09-30_asignado_no_validador.sql` | `3ee86e4` |
| 2026-09-30 | Almacenamiento de dispositivos para push y registro de avisos (`push_tokens`, `notification_log`, `push_deliveries`, RPC de alta y baja) | `sql/2026-09-30b_push_tokens.sql` | `cbefb9b` |
| 2026-10-02 | Aviso "Pendiente de validar": `pg_net`, trigger en `habit_logs` y Edge Function `push-events` | `sql/2026-10-02_push_events.sql`, `2026-10-02b`, `supabase/functions/push-events/` | `d424421` |
| 2026-10-02 | Avisos "Nuevo hábito" y "Resultado de la validación" (triggers en `habit_assignments` y `habit_validations`) | `sql/2026-10-02c_push_events_asignado_resultado.sql` | `5e7249b` |
| 2026-10-02 | Recordatorio diario a las 20:00 locales: funciones SQL, `pg_cron` y tarea horaria | `sql/2026-10-02d`, `2026-10-02e`, `2026-10-02f` | `7155309`, `2d85606`, `d3272a1` |
| 2026-10-05 | Seguridad reforzada de push en Expo (exige token de acceso; la función ya lo enviaba). Configuración de la cuenta de Expo, sin cambio de código | — | — |

**Rollback:** el build 3 sigue funcionando con el servidor actual, con la
limitación ya descrita (intercambiar asignado y validador en dos pasos) y sin
push. Los avisos push llegan a cualquier build desde el 4. Las piezas del
servidor que envían avisos (triggers, `push-events` y la tarea de
`pg_cron`) están descritas en `docs/database.md`; quitarlas no requiere
ningún build.
