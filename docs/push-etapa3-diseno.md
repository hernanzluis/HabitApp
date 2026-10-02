# Notificaciones push — diseño de la etapa 3

**Estado (2026-10-02): implementada, pendiente de la prueba real.** Hechos
los pasos 1-4 de "Pasos para aplicarlo" (al final); faltan el 5 (activar la
exigencia en EAS) y el 6 (Luis y Lucia). Escrito como diseño el mismo día;
**cambios respecto al diseño** al implementarlo:

- **`PUSH_WEBHOOK_SECRET` vive solo en Vault** (`push_webhook_secret`),
  generado dentro de la base con `gen_random_bytes` (nadie lo ha visto). No se
  copia a los secretos de Edge Functions: la función lo comprueba llamando a
  `push_webhook_secret_ok` (solo `service_role`). Así no hizo falta ningún
  paso de Luis para este secreto. La comparación es en SQL, no en tiempo
  constante (no explotable con la latencia de red de por medio).
- **Deduplicación:** PostgREST no puede expresar `ON CONFLICT` sobre un
  índice único **parcial**, así que la función inserta cada aviso y trata el
  error `23505` (duplicado) como "ya avisado": a ese destinatario no se le
  envía. Mismo efecto.
- **La función está en JavaScript** (`index.js`, con `entrypoint` en
  `supabase/config.toml`): un `.ts` en el repo hacía que Expo instalara
  TypeScript y creara `tsconfig.json` en la app.
- El texto guardado en `notification_log` va en el idioma del dispositivo del
  destinatario usado más recientemente; los mensajes, uno por dispositivo en
  su propio idioma.
- **`pg_net` da permisos a `anon`/`authenticated` que no podemos revocar**:
  riesgo conocido y regla permanente en `database.md` ("Notificaciones push
  por eventos"), comprobado siempre por la Fase 11, test 7.
- Expo responde a un token inexistente con un ticket `DeviceNotRegistered`
  ("is not a valid Expo push token"): la Fase 11 lo usa para probar la
  desactivación de tokens.

Objetivo: cuando alguien completa un hábito, sus validadores reciben
automáticamente un aviso "pendiente de validar". Es el primero de los tres
avisos por eventos; los tipos 3 y 1 (etapas 4 y 5) reutilizarán la misma
función y el mismo mecanismo.

```
App (HabitDetailScreen)          Postgres                         Edge Function            Expo / APNs
INSERT habit_logs  ───────►  trigger AFTER INSERT  ──pg_net──►  push-events  ──HTTP──►  push/send ──► iPhone
(status 'pending')           (asíncrono, tras commit)            (Service Role)
```

---

## 1. Secretos: dónde vive cada uno

Hay **dos** secretos. Ninguno entra en el repo, en el bundle de la app ni en
ningún commit, y ninguno se pega en el chat.

| Secreto | Para qué | Dónde vive | Quién lo fija |
|---|---|---|---|
| `EXPO_ACCESS_TOKEN` | Token de acceso de **Enhanced Push Security** de EAS: con la seguridad activada, Expo rechaza cualquier envío que no lo lleve | **Solo** como secreto de las Edge Functions de Supabase | Luis |
| `PUSH_WEBHOOK_SECRET` | Que solo la base de datos pueda llamar a la función (ver sección 2) | Secreto de las Edge Functions **y** en **Supabase Vault** (para que el trigger lo lea) | Code, generado aleatoriamente y sin mostrarlo, tras aprobación |

**Cómo fija Luis `EXPO_ACCESS_TOKEN` sin pegarlo en ningún sitio.** Dos
opciones, ambas dejan el valor fuera del historial del shell:

- **Opción A, dashboard (sin instalar nada):** Supabase → proyecto →
  **Edge Functions → Secrets** → *Add new secret* → nombre
  `EXPO_ACCESS_TOKEN`, valor pegado ahí.
- **Opción B, terminal** (requiere iniciar sesión una vez en el CLI de
  Supabase con `npx supabase login`, que abre el navegador):
  ```bash
  read -rs "EXPO_ACCESS_TOKEN?Pega el token de EAS y pulsa Enter: " && npx supabase secrets set EXPO_ACCESS_TOKEN="$EXPO_ACCESS_TOKEN" --project-ref uvsngemnftpysjvxslhu && unset EXPO_ACCESS_TOKEN
  ```
  `read -s` no muestra lo que se pega y el valor no queda en el historial (la
  línea guardada solo contiene `$EXPO_ACCESS_TOKEN`). Se comprueba con
  `npx supabase secrets list --project-ref uvsngemnftpysjvxslhu`, que
  muestra el nombre y un *hash*, nunca el valor.

**Orden importante con EAS:** en cuanto Luis active *Enhanced Push Security*
en expo.dev, **cualquier envío sin el token falla**, incluidos los envíos de
prueba a mano que se hicieron en la etapa 2. Por eso: 1) Luis genera el token
y lo guarda como secreto en Supabase; 2) se despliega y prueba la función;
3) **solo entonces** activa la exigencia en EAS. Si se activa antes, nada se
rompe en la app, pero no saldría ningún aviso hasta tener la función.

**Despliegue de la función:** necesita el CLI de Supabase con sesión iniciada
(`npx supabase login`) o pegar el código en el editor del dashboard. Si Luis
inicia sesión en el CLI en este Mac, Code puede desplegar (el token de sesión
queda en el llavero del Mac, no en el repo). Es una concesión de acceso: se
decide aparte.

## 2. El disparador (Database Webhook)

- **Evento:** `AFTER INSERT` en `habit_logs`, **`FOR EACH ROW WHEN
  (new.status = 'pending')`**. Solo INSERT: la app crea el log con
  `status = 'pending'` (`HabitDetailScreen`) y **ningún código ni trigger lo
  actualiza después** (comprobado el 2026-10-02: el único `insert` está en
  `HabitDetailScreen`, y en la base no hay triggers sobre `habit_logs` ni
  funciones que hagan `UPDATE habit_logs`), así que el INSERT es exactamente "hay algo pendiente de
  validar". No se escucha UPDATE: si algún día se cambiara el estado, no
  volvería a avisar.
- **Implementación:** en vez del asistente de Database Webhooks del
  dashboard (que guarda las cabeceras, incluido el secreto, en texto plano
  dentro de la definición del trigger), una función de trigger propia
  `notify_push_validation_pending()` (`SECURITY DEFINER`) que llama a
  `net.http_post` leyendo `PUSH_WEBHOOK_SECRET` de **Vault**
  (`vault.decrypted_secrets`). Es el mismo mecanismo que usa el webhook del
  dashboard (`pg_net`), sin el secreto a la vista.
- **Qué envía:** solo `{ "type": "validation_pending", "log_id": … }`. La
  función vuelve a leer todo de la base con la Service Role Key: no se fía de
  lo que llegue en el cuerpo.
- **Asíncrono:** `pg_net` no bloquea el INSERT; la petición sale **después
  del commit** (si la transacción se deshace, no sale nada). Timeout de la
  petición: 5 s.
- **Requiere instalar la extensión `pg_net`** (hoy disponible, no instalada).
- **Protección de la función:** se despliega con `verify_jwt = false`
  (`supabase/config.toml`), porque quien llama es la base, no un usuario, y
  exige la cabecera `x-webhook-secret` igual a `PUSH_WEBHOOK_SECRET`
  (comparación en tiempo constante). Sin ella responde 401 sin hacer nada.

**Duplicados.** Aunque el mismo log llegara dos veces (un reintento manual,
una llamada de prueba), el índice único
`notification_log_pending_uniq (recipient_id, log_id) where type =
'validation_pending'` lo impide a nivel de datos. La función inserta en
`notification_log` con *upsert* que **ignora los duplicados**
(`ON CONFLICT DO NOTHING`) y pide de vuelta solo las filas realmente
insertadas: **solo a esos destinatarios se les envía**. Una segunda llamada
para el mismo log no inserta nada y no envía nada.

## 3. La Edge Function `push-events`, paso a paso

1. **Autenticación:** método POST y `x-webhook-secret` correcto; si no, 401.
2. **Lectura:** el log por `log_id` con su hábito (`title`, `company_id`) y el
   nombre del autor. Si no existe o ya no está `pending`, responde 200
   "omitido" sin hacer nada.
3. **Destinatarios:** función SQL nueva
   `push_recipients_for_validation(log_id)` (`SECURITY DEFINER`, solo
   ejecutable por `service_role`), la misma regla que `ValidateHabitScreen`:
   - los `habit_validators` del hábito, **excluyendo al autor del log**;
   - si el hábito no tiene ningún validador, los **admins de la empresa del
     hábito** (fallback), excluyendo al autor;
   - siempre filtrando a perfiles **de la misma empresa** que el hábito.

   Al estar en SQL se testea sola en `tests/`, sin enviar nada.
4. **Registro y deduplicación:** una fila en `notification_log` por
   destinatario (`type 'validation_pending'`, `recipient_id`, `log_id`,
   `habit_id`, `title`, `body`, `data`), con `ON CONFLICT DO NOTHING`; sigue
   solo con las insertadas.
5. **Tokens:** los `push_tokens` con `enabled = true` de esos destinatarios
   (puede haber varios por persona).
6. **Mensajes:** uno por token, en el idioma del token (`locale`):
   - ES: título "Pendiente de validar", cuerpo "Lucia ha completado «Comer
     todos los dias fruta». Tienes una prueba por validar."
   - EN: "To validate" / "Lucia completed “…”. You have a proof to validate."
   - `data: { type: 'validation_pending', log_id, habit_id }` (la app ya
     navega a **Validar** con ese tipo, probado en la etapa 2), `sound:
     'default'`.
7. **Envío:** una fila `push_deliveries` por token (`queued`) y POST a
   `https://exp.host/--/api/v2/push/send` en lotes de hasta 100, con
   `Authorization: Bearer ${EXPO_ACCESS_TOKEN}`.
8. **Respuesta de Expo:** Expo devuelve un *ticket* por mensaje, en el mismo
   orden. Por cada uno se actualiza `push_deliveries`: `ticket_ok` +
   `ticket_id`, o `ticket_error` + `error`. Si el error es
   `DeviceNotRegistered`, ese token pasa a `enabled = false`.
9. **Resultado:** responde con un resumen (`recipients`, `notifications`,
   `ticket_ok`, `ticket_error`).

**Modo de ensayo (`dry_run: true` en el cuerpo):** hace los pasos 1-3 y 6 y
devuelve los mensajes que enviaría, **sin insertar ni enviar nada**. Lo usan
los tests y el ensayo previo a los datos reales.

Los **receipts** (la confirmación definitiva de Apple, unos minutos después)
no se consultan en esta etapa: quedan para el cron de la etapa 6, que pasará
de `ticket_ok` a `receipt_ok`/`receipt_error` y desactivará los tokens
muertos. Mientras tanto, Code puede consultarlos a mano.

## 4. Cómo se prueba antes de tocar datos reales

Todo con datos `zztest-`, en este orden:

1. **Función desplegada, sin trigger todavía.** Llamadas directas con el
   secreto:
   - sin secreto o con uno falso → 401;
   - `dry_run` sobre un log de prueba → destinatarios y textos correctos.
2. **Montaje de prueba:** empresa A con admin, un miembro **asignado** y un
   miembro **validador**; empresa B con su admin y un miembro. Tokens falsos
   con formato de Expo (`ExponentPushToken[zztest-…]`) para todos.
3. **Envío real a Expo con tokens falsos** (llamada directa, sin `dry_run`):
   - `notification_log`: **una** fila, para el validador; ninguna para el
     asignado (autor), ninguna para la empresa B;
   - `push_deliveries`: la fila del validador con el ticket de Expo (con un
     token falso, previsiblemente `DeviceNotRegistered` → token desactivado);
   - repetir la llamada → **cero** filas nuevas (deduplicación).
4. **Con el trigger aplicado (tras aprobación):** el miembro asignado inserta
   un log `pending` con su propio cliente (el camino real de la app) →
   esperar unos segundos → mismas comprobaciones que el punto 3, esta vez
   pasando por `pg_net` de verdad. También: un log insertado como
   `validated` **no** genera aviso.
5. **Solo al final, datos reales:** Lucia completa un hábito en su iPhone →
   Luis (validador) recibe "Pendiente de validar" → al tocarla, Validar.

## 5. Qué puede fallar y qué pasa entonces

| Fallo | Comportamiento | Cómo se ve |
|---|---|---|
| Expo devuelve error HTTP o no responde | Las entregas quedan `ticket_error`. **No se reintenta automáticamente** (la fila de `notification_log` ya existe y la deduplicación lo impediría): ese aviso se pierde. Es aceptable para un aviso informativo; el log sigue en Validar | `push_deliveries.status/error` |
| `EXPO_ACCESS_TOKEN` falta o es incorrecto (con la seguridad de EAS activada) | Expo rechaza todos los envíos | Todos los tickets en error (`InvalidCredentials` o similar) |
| Dispositivo desinstalado / token muerto (`DeviceNotRegistered`) | Ese token se desactiva (`enabled = false`); los demás tokens del usuario siguen. Si vuelve a abrir la app, `register_push_token` lo reactiva | `push_tokens.enabled` |
| La función tarda más de 5 s | `pg_net` da la petición por caducada, pero la función sigue ejecutándose y normalmente envía igual | `net._http_response.timed_out` |
| Supabase no alcanza la función (caída, error de despliegue) | El INSERT del log **no se ve afectado** (asíncrono); el aviso se pierde | `net._http_response` (status ≠ 200 o `error_msg`), solo durante **6 horas** |
| Secreto del webhook incorrecto | La función responde 401 y no hace nada | `net._http_response.status_code = 401` |
| El usuario no tiene ningún token (nunca aceptó el permiso, o cerró sesión) | Se registra la fila de `notification_log` pero no hay entregas | `notification_log` sin `push_deliveries` |

Diagnóstico rápido para Code (solo lectura): los últimos
`notification_log` + `push_deliveries`, y `net._http_response` de las últimas
horas.

**Efecto en la suite de tests:** muchas fases insertan logs `pending` de
prueba (p. ej. `advanceHabitLog`). Con el trigger, cada uno llamará a la
función. No envía nada real (los usuarios `zztest-` no tienen tokens salvo en
la fase nueva) y las filas de `notification_log` caen en cascada con la
limpieza, pero son llamadas de más. Se puede mitigar más adelante si
molesta.

## 6. Tests: automático frente a real

**Automático — Fase 11 nueva (`test-11-push-events.js`):**
- `push_recipients_for_validation`: validadores sin el autor; fallback a los
  admins cuando no hay validadores; nunca alguien de otra empresa; no
  ejecutable por clientes (`anon`/`authenticated`).
- La función, llamada directamente: 401 sin secreto o con secreto falso;
  `dry_run` con destinatarios y textos en el idioma de cada token; envío con
  tokens falsos → una fila de `notification_log` por destinatario, entrega
  registrada con el ticket de Expo, token desactivado si Expo responde
  `DeviceNotRegistered`; segunda llamada → nada nuevo.
- El trigger, de punta a punta (sí es automatizable: `pg_net` llama a la
  función real): un log `pending` insertado por el miembro genera el aviso
  del validador en unos segundos; uno `validated` no; nada para el autor ni
  para otra empresa.
- Catálogo: el trigger existe con su condición `WHEN`, la función de
  destinatarios no es ejecutable por clientes.

**Solo de verdad, a mano (`manual-testing.md`):** que el aviso **llega al
iPhone** de Luis cuando Lucia completa un hábito desde su app, en el idioma
correcto, y que al tocarlo abre Validar. La entrega real por APNs no la puede
comprobar ningún test.

## Pasos para aplicarlo (cada uno con aprobación)

1. ✅ **Luis:** genera el token de acceso en expo.dev (*Enhanced Push Security*,
   **sin activar todavía la exigencia**) y lo fija como secreto
   `EXPO_ACCESS_TOKEN` en Supabase (sección 1).
2. ✅ **Code (aprobación):** instalar `pg_net`; crear
   `push_recipients_for_validation`; generar `PUSH_WEBHOOK_SECRET` y
   guardarlo en Vault y en los secretos de la función. Con ensayo y copia.
   **Hecho el 2026-10-02** (`sql/2026-10-02_push_events.sql`; ensayo con
   ROLLBACK, copia en `~/habitapp-backups/2026-10-02-pre-push-events/`).
3. ✅ **Code (aprobación):** código de `supabase/functions/push-events` y
   despliegue; pruebas 1-3 de la sección 4; Fase 11. **Hecho el
   2026-10-02** (desplegada con `npx supabase functions deploy push-events
   --project-ref uvsngemnftpysjvxslhu --no-verify-jwt --use-api`).
4. ✅ **Code (aprobación):** el trigger; prueba 4 de la sección 4; Fase 11
   completa, fases 0-11 dos veces. **Hecho el 2026-10-02**
   (`sql/2026-10-02b_push_events_trigger.sql`, copia en
   `~/habitapp-backups/2026-10-02-pre-push-trigger/`; se aplicó directamente,
   sin ensayo con ROLLBACK previo, y se verificó con la Fase 11: 30/30).
5. **Luis:** activar la exigencia de *Enhanced Push Security* en EAS.
6. **Luis y Lucia:** la prueba real (sección 4, punto 5).
