// Edge Function push-events (JavaScript, no TypeScript: un .ts en el repo
// haría que Expo configurase TypeScript en la app) — notificaciones push por eventos (etapa 3:
// "pendiente de validar"). Diseño: docs/push-etapa3-diseno.md.
//
// La llama el trigger habit_logs_push_validation_pending (pg_net) con
//   { "type": "validation_pending", "log_id": "<uuid>" }
// y la cabecera x-webhook-secret (secreto en Vault). Con "dry_run": true
// devuelve los mensajes que enviaría sin insertar ni enviar nada.
//
// Secretos: EXPO_ACCESS_TOKEN (Enhanced Push Security de EAS) como secreto de
// Edge Functions; la clave de servicio la inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXTS = {
  es: {
    title: 'Pendiente de validar',
    body: (name, habit) => `${name} ha completado «${habit}». Tienes una prueba por validar.`,
    someone: 'Alguien',
  },
  en: {
    title: 'To validate',
    body: (name, habit) => `${name} completed “${habit}”. You have a proof to validate.`,
    someone: 'Someone',
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function adminClient() {
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      key = JSON.parse(secretKeys).default ?? key;
    } catch {
      // se queda con la clave legacy
    }
  }
  return createClient(Deno.env.get('SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function texts(locale, authorName, habitTitle) {
  const t = TEXTS[locale === 'en' ? 'en' : 'es'];
  return { title: t.title, body: t.body(authorName?.trim() || t.someone, habitTitle) };
}

async function handleValidationPending(db, logId, dryRun) {
  // 1. Se relee todo desde la base: no se confía en el cuerpo recibido.
  const { data: log, error: logErr } = await db
    .from('habit_logs').select('id, user_id, habit_id, status').eq('id', logId).maybeSingle();
  if (logErr) throw logErr;
  if (!log || log.status !== 'pending') return { skipped: 'not_pending' };

  const [{ data: habit, error: habitErr }, { data: author, error: authorErr }] = await Promise.all([
    db.from('habits').select('title').eq('id', log.habit_id).single(),
    db.from('profiles').select('full_name').eq('id', log.user_id).maybeSingle(),
  ]);
  if (habitErr) throw habitErr;
  if (authorErr) throw authorErr;

  // 2. Destinatarios: validadores (o admins si no hay), sin el autor, misma empresa.
  const { data: recipientRows, error: recErr } = await db.rpc('push_recipients_for_validation', { p_log_id: logId });
  if (recErr) throw recErr;
  const recipients = (recipientRows ?? []).map((r) => r.recipient_id);
  if (!recipients.length) return { recipients: 0, notifications: 0, deliveries: 0 };

  // 3. Tokens activos de los destinatarios (puede haber varios por persona).
  const { data: tokenRows, error: tokErr } = await db
    .from('push_tokens').select('id, user_id, token, locale')
    .in('user_id', recipients).eq('enabled', true)
    .order('last_seen_at', { ascending: false });
  if (tokErr) throw tokErr;
  const tokens = tokenRows ?? [];
  const data = { type: 'validation_pending', log_id: logId, habit_id: log.habit_id };

  if (dryRun) {
    return {
      dry_run: true,
      recipients,
      messages: tokens.map((t) => ({ recipient_id: t.user_id, push_token_id: t.id, locale: t.locale, ...texts(t.locale, author?.full_name, habit.title), data })),
    };
  }

  // 4. Un aviso lógico por destinatario. El índice único
  //    notification_log_pending_uniq (recipient_id, log_id) es la
  //    deduplicación: si ya existe (23505), a ese destinatario no se le envía.
  const messages = [];
  let notifications = 0;
  for (const recipientId of recipients) {
    const own = tokens.filter((t) => t.user_id === recipientId);
    const logText = texts(own[0]?.locale, author?.full_name, habit.title);
    const { data: notif, error: insErr } = await db.from('notification_log')
      .insert({ type: 'validation_pending', recipient_id: recipientId, log_id: logId, habit_id: log.habit_id, ...logText, data })
      .select('id').single();
    if (insErr) {
      if (insErr.code === '23505') continue;
      throw insErr;
    }
    notifications++;
    if (!own.length) continue;

    const deliveries = own.map((t) => ({ id: crypto.randomUUID(), notification_id: notif.id, push_token_id: t.id, status: 'queued' }));
    const { error: delErr } = await db.from('push_deliveries').insert(deliveries);
    if (delErr) throw delErr;
    own.forEach((t, i) => messages.push({ deliveryId: deliveries[i].id, token: t, ...texts(t.locale, author?.full_name, habit.title), data }));
  }

  // 5. Envío a Expo en lotes y registro del ticket de cada mensaje.
  const counts = await sendToExpo(db, messages);
  return { recipients: recipients.length, notifications, deliveries: messages.length, ...counts };
}

async function sendToExpo(db, messages) {
  const counts = { ticket_ok: 0, ticket_error: 0 };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!accessToken) console.warn('push-events: falta EXPO_ACCESS_TOKEN; se envía sin él');

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    let tickets = null;
    let batchError = null;
    try {
      const res = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((m) => ({ to: m.token.token, title: m.title, body: m.body, data: m.data, sound: 'default' }))),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(payload?.data)) {
        const e = payload?.errors?.[0];
        batchError = `http_${res.status}${e ? `: ${e.code ?? ''} ${e.message ?? ''}`.trimEnd() : ''}`;
      } else {
        tickets = payload.data;
      }
    } catch (e) {
      batchError = `network: ${e instanceof Error ? e.message : String(e)}`;
    }

    for (let j = 0; j < batch.length; j++) {
      const m = batch[j];
      const ticket = tickets?.[j];
      let update;
      if (ticket?.status === 'ok') {
        update = { status: 'ticket_ok', ticket_id: ticket.id ?? null };
        counts.ticket_ok++;
      } else {
        const code = ticket?.details?.error;
        update = { status: 'ticket_error', error: batchError ?? `${code ?? 'error'}: ${ticket?.message ?? 'sin ticket'}` };
        counts.ticket_error++;
        if (code === 'DeviceNotRegistered') {
          const { error } = await db.from('push_tokens').update({ enabled: false }).eq('id', m.token.id);
          if (error) console.error('push-events: no se pudo desactivar el token', m.token.id, error.message);
        }
      }
      const { error } = await db.from('push_deliveries').update(update).eq('id', m.deliveryId);
      if (error) console.error('push-events: no se pudo actualizar la entrega', m.deliveryId, error.message);
    }
  }
  return counts;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = adminClient();
  const secret = req.headers.get('x-webhook-secret');
  if (!secret) return json({ error: 'unauthorized' }, 401);
  const { data: secretOk, error: secretErr } = await db.rpc('push_webhook_secret_ok', { p_secret: secret });
  if (secretErr) {
    console.error('push-events: fallo comprobando el secreto', secretErr.message);
    return json({ error: 'internal' }, 500);
  }
  if (secretOk !== true) return json({ error: 'unauthorized' }, 401);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (payload?.type !== 'validation_pending') return json({ error: 'unsupported_type' }, 400);
  if (!payload.log_id || !UUID_RE.test(payload.log_id)) return json({ error: 'invalid_log_id' }, 400);

  try {
    const result = await handleValidationPending(db, payload.log_id, payload.dry_run === true);
    console.log('push-events', payload.log_id, JSON.stringify(result));
    return json(result);
  } catch (e) {
    console.error('push-events: error', payload.log_id, e instanceof Error ? e.message : JSON.stringify(e));
    return json({ error: 'internal' }, 500);
  }
});
