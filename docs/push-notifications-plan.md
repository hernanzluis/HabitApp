# Notificaciones push — propuesta para la v1.1

**Estado: PROPUESTA, sin implementar.** Fecha: 2026-09-30. No se ha tocado
código, base de datos ni builds.

**Regla de aprobación (decidida por Luis el 2026-09-30):** cada etapa que
toque base de datos, Edge Functions o builds necesita su **aprobación expresa
en el chat antes de aplicarse**, igual que los cambios de seguridad (copia de
seguridad y ensayo con `ROLLBACK` cuando aplique). Ver sección 7.

**Decisiones tomadas (2026-09-30):** recordatorio a las **20:00 hora local**;
el tipo 3 manda **un aviso resumido por log, no uno por voto** (sección 4);
las preferencias por tipo de notificación quedan **fuera de la v1.1**
(pendiente de v2, en `project.md`).

Cuatro tipos, todos en esta primera versión:

| # | Tipo | Destinatario | Disparador |
|---|---|---|---|
| 1 | Te han asignado un hábito nuevo | El asignado | INSERT en `habit_assignments` |
| 2 | Hay algo pendiente de validar | Validadores del hábito (o el admin si no tiene ninguno) | INSERT en `habit_logs` |
| 3 | Resultado de la validación de tu hábito (resumido) | Quien completó el hábito | INSERT en `habit_validations` (un aviso por log, ver sección 4) |
| 4 | Recordatorio diario de hábitos pendientes | Cada usuario con hábitos sin completar hoy | Programado (cron) |

---

## 1. Estado actual (comprobado el 2026-09-30)

- **App:** no hay `expo-notifications`, `expo-device` ni ningún registro de
  tokens (ni en `package.json`, ni en `node_modules`, ni en el código). La
  campana de la cabecera de Home solo muestra "Próximamente"
  (`navigation/RootNavigator.js:208`).
- **Web:** nada relacionado con push.
- **Supabase:** no hay carpeta `supabase/` ni Edge Functions en el repo; no
  hay tabla de tokens; ningún trigger hace llamadas HTTP. Extensiones
  **disponibles pero no instaladas**: `pg_cron` 1.6.4, `pg_net` 0.20.4,
  `http` 1.6. **Instalada**: `supabase_vault` 0.3.1 (para guardar secretos).
- **Build:** `eas.json` tiene un perfil `development` con
  `developmentClient: true`, pero `expo-dev-client` no está instalado.

## 2. Cliente (app móvil)

### Qué se añade
- Dependencias: `expo-notifications` y `expo-device` (con
  `npx expo install`, versiones de SDK 57). `expo-constants` ya está.
- `app.json`: plugin `["expo-notifications", { … }]`. En iOS añade el
  entitlement `aps-environment` (lo que activa la capacidad Push en el
  build). Sin `enableBackgroundRemoteNotifications` (no hace falta: no hay
  notificaciones silenciosas). **Es un cambio nativo: exige build nuevo.**
- Un módulo `lib/push.js`: permisos, registro del token, handler de primer
  plano y navegación al tocar.

### Flujo de permiso
- **No pedirlo al abrir la app por primera vez.** iOS solo muestra el diálogo
  del sistema **una vez**; si el usuario lo rechaza sin contexto, solo puede
  reactivarlo desde Ajustes.
- Pedirlo **en contexto**, con una pantalla/alerta previa propia que explique
  para qué sirve: tras el primer login, o la primera vez que se completa un
  hábito o se abre la pestaña Validar. Solo si el usuario acepta esa
  explicación se llama a `requestPermissionsAsync()`.
- Comprobar `Device.isDevice`: en el simulador no hay token de push.

### Registro del token
- Tras conceder el permiso **y en cada arranque con sesión** (el token puede
  cambiar tras reinstalar o restaurar):
  `Notifications.getExpoPushTokenAsync({ projectId })` con el `projectId` de
  `app.json` → RPC `register_push_token(token, platform, locale, time_zone)`.
  - `locale`: idioma activo de la app (`i18n.language`), para mandar el texto
    en ES o EN. Se vuelve a registrar al cambiar el idioma en Perfil.
  - `time_zone`: `Localization.getCalendars()[0].timeZone` (p. ej.
    `Europe/Madrid`), para el recordatorio diario (sección 4).
- **Al cerrar sesión:** RPC `unregister_push_token(token)` **antes** del
  `signOut()` (después ya no hay sesión para llamarla). Al borrar la cuenta,
  el `ON DELETE CASCADE` limpia sus tokens.

### Si el usuario deniega el permiso
- La app funciona igual, sin push. No se vuelve a pedir en cada arranque.
- En Perfil, una fila "Notificaciones: desactivadas — Activar" que abre los
  Ajustes del sistema (`Linking.openSettings()`), y al volver a la app se
  relee el estado y, si ahora está concedido, se registra el token.

### Primer plano vs segundo plano
- **Segundo plano / app cerrada:** el sistema muestra la notificación; la
  app no ejecuta nada hasta que se toca.
- **Primer plano:** `Notifications.setNotificationHandler` con
  `shouldShowBanner: true`, `shouldShowList: true`, `shouldPlaySound: false`,
  `shouldSetBadge: false` (sin contador en el icono en la v1.1: se quedaría
  desfasado). Además, al recibirla en primer plano se recarga el dato
  afectado (p. ej. el badge de la pestaña Validar con `fetchPendingCount`).

### Qué abre cada notificación al tocarla
El servidor manda en `data` el tipo y los ids (`{ type, habit_id, log_id }`).
Con la app abierta: `addNotificationResponseReceivedListener`; con la app
cerrada (arranque en frío): `getLastNotificationResponse()` al montar. La
navegación espera a que `RootNavigator` tenga sesión (si no hay sesión, se
ignora y queda en Login).

| Tipo | Pantalla |
|---|---|
| 1. Hábito asignado | Pestaña **Home** (donde aparece el hábito nuevo) |
| 2. Pendiente de validar | Pestaña **ValidateHabit** (Validar) |
| 3. Aprobado / rechazado | **HabitStats** de ese hábito (muestra "Últimas validaciones"); como la ruta espera el objeto `habit`, se carga por `habit_id` antes de navegar |
| 4. Recordatorio diario | Pestaña **Home** |

## 3. Almacenamiento: tabla `push_tokens`

```sql
create table public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null unique,          -- ExponentPushToken[...]
  platform    text not null check (platform in ('ios', 'android')),
  locale      text not null default 'es' check (locale in ('es', 'en')),
  time_zone   text not null default 'Europe/Madrid',
  enabled     boolean not null default true, -- false tras DeviceNotRegistered
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_id_idx on public.push_tokens (user_id) where enabled;
alter table public.push_tokens enable row level security;
```

- **Un token por dispositivo**, único. Un usuario puede tener varios
  (iPhone + iPad en el futuro).
- **RLS:** solo SELECT y DELETE de las filas propias
  (`user_id = auth.uid()`, `to authenticated`). **Sin INSERT/UPDATE directos:**
  el alta pasa por la RPC `register_push_token` (`SECURITY DEFINER`), que
  hace *upsert por token* asignándolo a `auth.uid()`. Así, si en un
  dispositivo cierra sesión Luis y entra Lucia, el token pasa a Lucia sin que
  Luis siga recibiendo sus avisos — con RLS normal Lucia no podría tocar la
  fila de Luis. `anon`: nada (como el resto de tablas desde el 2026-09-28).
- **Lectura para enviar:** solo la Edge Function, con la Service Role Key.
- **`notification_log`** (tabla auxiliar, sin acceso de clientes): `type`,
  `recipient_id`, `habit_id`, `log_id`, `ticket_id`, `status`, `sent_at`.
  Sirve para (a) no duplicar avisos (sección 4), (b) comprobar los *receipts*
  de Expo y desactivar tokens muertos, y (c) depurar.

## 4. Envío desde el servidor

### Eventos (tipos 1-3): comparación

| Opción | Pros | Contras |
|---|---|---|
| **A. Database Webhook → Edge Function** (recomendada) | Se dispara con cualquier escritura (app, web, SQL): no depende de que el cliente "se acuerde". Asíncrono vía `pg_net` (no bloquea ni hace fallar el INSERT). Toda la lógica y los textos ES/EN en un solo sitio (TypeScript/Deno). Los secretos (token de acceso de Expo) viven en los secretos de la función | `pg_net` no reintenta: si la función falla, ese aviso se pierde (queda en `net._http_response`). Hay que desplegar Edge Functions (CLI de Supabase o dashboard) |
| B. La app llama a una Edge Function tras cada acción | Sencillo de entender | Hay que hacerlo en app **y** web; se salta si el cliente falla o lo evita; lógica duplicada |
| C. Trigger que llama directamente a la API de Expo con `pg_net` | Sin Edge Function | Textos, i18n y selección de destinatarios en PL/pgSQL; el token de Expo guardado en la base; gestión de *receipts* incómoda |
| D. Servidor propio escuchando Realtime | Control total | Un servidor siempre encendido: justo lo que el proyecto evita |

**Recomendación: A.** Una Edge Function `push-events` recibe el webhook
(verifica un secreto compartido en una cabecera) y decide destinatarios:

- **Tipo 1 (INSERT `habit_assignments`)** → el `user_id` asignado.
  **Trampa a resolver:** al **editar** un hábito, AdminScreen y la web borran
  y reinsertan **todas** las asignaciones, así que cada edición volvería a
  avisar a todos. Solución: la función solo avisa si en `notification_log` no
  hay ya un tipo 1 para ese (`habit_id`, `user_id`). Opcionalmente, más
  adelante, que las pantallas guarden solo las diferencias.
- **Tipo 2 (INSERT `habit_logs`)** → los `habit_validators` del hábito; si no
  tiene ninguno, los admins de la empresa (misma regla de fallback que
  ValidateHabitScreen). Nunca el propio autor del log.
- **Tipo 3 (INSERT `habit_validations`)** → el autor del log
  (`habit_logs.user_id`), **un solo aviso resumido por log**, no uno por voto:
  - Se envía cuando **han votado todos** los validadores del hábito (o, si no
    tiene ninguno, el admin del fallback), con el resumen: "Tu hábito X: 2
    aprobaciones, 1 rechazo".
  - Si alguien no llega a votar nunca, el aviso no saldría. Para eso, la
    pasada de las 20:00 (la misma del recordatorio) manda el resumen de los
    logs con **al menos un voto** y sin aviso de tipo 3, que tengan más de
    unas horas.
  - Nunca más de un tipo 3 por log (control con `notification_log`).

La selección de destinatarios se escribe como **funciones SQL** (p. ej.
`push_recipients_for_log(log_id)`), llamadas desde la función: así se pueden
testear en `tests/` sin enviar nada.

### Recordatorio diario (tipo 4)
- **Mecanismo:** `pg_cron` + `pg_net` (lo que Supabase ofrece como "Cron"),
  que llama **cada hora** a una Edge Function `daily-reminder`. Cada hora, la
  función toma los tokens cuyo `time_zone` local marca las **20:00** (hora
  propuesta, ajustable) y a esos usuarios les manda el recordatorio. Así cada
  uno lo recibe a su hora local sin un cron por zona horaria.
- **No mandarlo a quien ya completó todo:** una función SQL
  `pending_habits_for_user(user_id, local_date)` devuelve sus hábitos
  asignados, activos, que **hoy (día local)** siguen pendientes, con las
  mismas reglas que HomeScreen: `daily` sin log hoy; `once` sin ningún log y
  sin caducar; `weekly_x`/`monthly_x` sin llegar al objetivo del periodo (y
  sin log hoy). Si devuelve 0 filas, no se envía. El texto dice cuántos
  quedan ("Te quedan 2 hábitos por completar hoy").
- **Ojo con el día:** la app cuenta "hoy" en hora **local**, pero el índice
  único `habit_logs_one_per_day` usa el día **UTC**. Para el recordatorio se
  calcula en local (con `time_zone`); la discrepancia del índice (un log a las
  00:30 hora de Madrid cuenta en BD como el día UTC anterior) es previa y se
  documentará aparte.
- **Solo una vez al día por usuario**, aunque tenga varios dispositivos o la
  función se reintente: control con `notification_log` (tipo 4, fecha local).

### Tokens muertos (*receipts*)
Expo responde con *tickets* y, unos minutos después, con *receipts*. Un cron
(p. ej. cada 30 min) consulta los receipts de los tickets recientes de
`notification_log` y, si alguno trae `DeviceNotRegistered`, pone ese token en
`enabled = false`. Así no se sigue enviando a apps desinstaladas.

### Limitaciones conocidas del diseño
- **El cron horario no escala a muchas zonas horarias.** Cada hora,
  `daily-reminder` recorre todos los tokens activos para quedarse con los que
  están en las 20:00 locales. Con el volumen actual (una familia, una zona
  horaria) no es ningún problema. Si algún día hubiera muchos usuarios
  repartidos en muchas zonas, habría que filtrar en SQL por zona horaria antes
  de recorrer, o precalcular la próxima hora de envío por usuario.
- **Límite de 2 claves APNs por cuenta de Apple** (ver sección 6). A tener en
  cuenta si alguna vez hay que **rotar credenciales**: no se puede crear una
  tercera clave sin revocar una, y revocar la clave en uso corta el push de
  la app hasta subir la nueva a EAS.

## 5. Servicio de envío: Expo Push frente a APNs directo

**Recomendación: Expo Push Service.**
- Una sola API HTTP (`https://exp.host/--/api/v2/push/send`), lotes de hasta
  100 mensajes, límite de 600/s por proyecto (de sobra).
- Usa la clave APNs que EAS ya gestiona para el proyecto; el mismo código
  sirve para Android (FCM) cuando llegue.
- Activar la **"enhanced push security"** del dashboard de EAS: exige un
  token de acceso en cada envío, guardado solo como secreto de la Edge
  Function. Sin ella, cualquiera que obtuviera un token de dispositivo podría
  mandar avisos a ese usuario.

APNs directo exigiría firmar JWT con la clave `.p8`, HTTP/2 y distinguir
sandbox/producción, sin ninguna ventaja real para este volumen.

## 6. Apple y credenciales

**Luis, en Apple Developer** (Certificates, Identifiers & Profiles →
Identifiers → `com.luishernanz.habitteam`): marcar la capacidad **Push
Notifications** y guardar. EAS suele sincronizar esta capacidad por sí solo
al hacer el build (al ver el entitlement `aps-environment` que añade el
plugin), pero conviene activarla a mano y comprobarla.

**Lo que hace `eas credentials` (o `eas build`, que lo pregunta)**, con el
login de Apple de Luis:
- Generar una **clave APNs** (Apple Push Notifications service key, `.p8`) en
  la cuenta de desarrollador y subirla a Expo, asociada al proyecto. Apple
  permite como máximo **2 claves APNs** por cuenta; si ya hubiera dos, habría
  que reutilizar o revocar una.
- **Regenerar el provisioning profile** para que incluya la capacidad Push.
- El certificado de distribución ya existente sigue valiendo.

Android (FCM) queda para cuando se publique en Google Play: exigirá subir las
credenciales FCM V1 a EAS.

## 7. Plan por etapas

Importante: **ninguna etapa con push real se puede probar en Expo Go** (el
push remoto necesita un binario con el entitlement y la clave APNs). Hace
falta **un build nativo con `expo-notifications`**. Propuesta: usar como banco
de pruebas builds de **TestFlight en prueba interna** (el mismo flujo `eas
build` + `eas submit` que el build 3). El build de la etapa 2 puede ser ya el
**build 4**, y como las etapas 3-7 son solo de servidor, **no necesitan
builds nuevos** salvo que cambie la navegación al tocar.

| Etapa | Qué | Dónde | Se prueba así | Build |
|---|---|---|---|---|
| 0 ✅ | Capacidad Push en el Bundle ID y clave APNs con `eas credentials` — **hecha el 2026-09-30**: clave APNs con **Key ID `66848HN7W9`** (el identificador real de Apple, visible en Apple Developer → Keys; una sola clave en la cuenta). La fecha "Expiration: 29 Sep 2027" que mostró `eas credentials` **no es de la clave**: Apple confirma que las claves `.p8` no caducan (Keys solo muestra "Created at"/"Updated at"). Coincide exactamente con un año después del primer build (29/09/2026), que es lo que dura un certificado de distribución: **muy probablemente es la caducidad del certificado de distribución, no confirmado**. La seguridad de envío de EAS se activa en la etapa 3 | Apple / EAS (Luis) | Aparece la clave en `eas credentials` | No |
| 1 ✅ | Tabla `push_tokens` + RPCs de registro/baja + `notification_log` (+ `push_deliveries`) — **aplicada el 2026-09-30** (`sql/2026-09-30b_push_tokens.sql`) | SQL (aprobada) | `tests/` (Fase 10, 28 tests) | No |
| 2 | Cliente: permiso en contexto, registro/baja del token, handler de primer plano, navegación al tocar | App | Envío manual desde la herramienta de push de Expo al token guardado; tocar cada `type` | **Sí (build 4, TestFlight interno)** |
| 3 | Edge Function `push-events` con modo *dry run* (devuelve los mensajes sin enviarlos) + webhook solo para el tipo 2 | Supabase (aprobación) | `tests/` en dry run + un envío real a Luis | No |
| 4 | Tipo 3 | Supabase | Igual | No |
| 5 | Tipo 1, con la deduplicación de ediciones | Supabase | Editar un hábito dos veces → un solo aviso | No |
| 6 | Recordatorio diario (`pg_cron` horario + `daily-reminder`) + receipts | Supabase (aprobación: instala `pg_cron`/`pg_net`) | Función de pendientes testeada; forzar la hora en dry run; un recordatorio real | No |
| 7 | Repaso completo en dispositivo y publicación | App Store | `manual-testing.md` | El que se publique |

## 8. Tests: qué es automático y qué es manual

**Automático (`tests/`, una Fase 10 nueva)**
- RLS de `push_tokens`: cada usuario ve y borra solo sus tokens; nadie puede
  insertar ni actualizar directamente; `anon` nada.
- `register_push_token`: crea, actualiza `last_seen_at`, y **reasigna** el
  token si cambia de usuario; rechaza `platform`/`locale` inválidos.
- `unregister_push_token` y cascada al borrar la cuenta.
- Funciones de destinatarios: tipo 2 (validadores; fallback a admins; nunca
  el autor), tipo 3 (el autor del log), tipo 1 (el asignado, sin duplicar
  tras una edición).
- `pending_habits_for_user`: por recurrencia y con fechas/zonas horarias
  fijadas (incluido el caso cerca de medianoche).
- La Edge Function en **dry run**: para un evento dado, qué mensajes y en qué
  idioma saldrían.
- Tokens de prueba inválidos → el procesado de *receipts* los desactiva
  (Expo responde con error; no llega nada a ningún móvil).
- Que los triggers de webhook existen (catálogo).

**Manual, solo en un iPhone real con el build de TestFlight
(`manual-testing.md`)**
- El diálogo de permiso: la pantalla previa, aceptar y denegar; reactivar
  desde Ajustes y que se registre el token al volver.
- Recibir cada uno de los 4 tipos con la app en primer plano, en segundo
  plano y cerrada.
- Que tocar cada tipo abre la pantalla correcta, también en arranque en frío.
- Idioma del texto según el idioma de la app (ES/EN).
- Cerrar sesión: dejar de recibir avisos de esa cuenta; entrar con otra en el
  mismo iPhone: recibir los de la nueva.
- El recordatorio llega a la hora local y **no** llega si ya se completó todo.
- Reinstalar la app → token nuevo y se sigue recibiendo.

Lo que nunca es automatizable: la entrega real por APNs, el diálogo del
sistema y la experiencia al tocar la notificación.

## Decisiones (tomadas el 2026-09-30)
- Recordatorio diario: **20:00 hora local**.
- Tipo 3: **un aviso resumido por log**, no uno por voto.
- Preferencias por tipo de notificación: **no entran en la v1.1**; pendiente
  de v2 (`project.md`). En la v1.1 solo existe el permiso del sistema.
- **Cada etapa** que toque base de datos, Edge Functions o builds necesita
  aprobación expresa de Luis en el chat antes de aplicarse.
