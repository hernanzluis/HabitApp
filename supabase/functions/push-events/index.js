// Edge Function push-events (JavaScript, no TypeScript: un .ts en el repo
// haría que Expo configurase TypeScript en la app) — notificaciones push por
// eventos. Diseño: docs/push-etapa3-diseno.md y docs/push-etapa3b-diseno.md.
//
// La llaman los triggers (pg_net) con la cabecera x-webhook-secret (secreto
// en Vault) y uno de estos cuerpos:
//   { "type": "validation_pending", "log_id": "<uuid>" }            habit_logs
//   { "type": "habit_assigned", "assignment_id": "<uuid>",
//     "actor_id": "<uuid>" | null }                                 habit_assignments
//   { "type": "validation_result", "log_id": "<uuid>" }             habit_validations
//   { "type": "daily_reminder" }                                    pg_cron (push_cron_tick)
// El recordatorio acepta además "now" (ISO), "user_ids" (uuid[]) y
// "simulate_expo_failure": SOLO para los tests. Un "now" exige user_ids no
// vacío (400 si no): con una hora inventada y sin ese filtro el aviso podría
// llegar a usuarios reales. simulate_expo_failure solo vale junto a user_ids.
// El tick de pg_cron no manda ninguno de los tres.
// Con "dry_run": true devuelve los mensajes que enviaría sin insertar ni
// enviar nada.
//
// Secretos: EXPO_ACCESS_TOKEN (Enhanced Push Security de EAS) como secreto de
// Edge Functions; la clave de servicio la inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const SOMEONE = { es: 'Alguien', en: 'Someone' };

const TEXTS = {
  daily_reminder: {
    es: ({ count }) => ({ title: 'Recordatorio', body: count === 1 ? 'Te queda 1 hábito por completar hoy.' : `Te quedan ${count} hábitos por completar hoy.` }),
    en: ({ count }) => ({ title: 'Reminder', body: count === 1 ? 'You have 1 habit left for today.' : `You have ${count} habits left for today.` }),
  },
  validation_pending: {
    es: ({ author, habit }) => ({ title: 'Pendiente de validar', body: `${author} ha completado «${habit}». Tienes una prueba por validar.` }),
    en: ({ author, habit }) => ({ title: 'To validate', body: `${author} completed “${habit}”. You have a proof to validate.` }),
  },
  habit_assigned: {
    es: ({ actor, habit }) => ({ title: 'Nuevo hábito', body: actor ? `${actor} te ha asignado «${habit}».` : `Te han asignado «${habit}».` }),
    en: ({ actor, habit }) => ({ title: 'New habit', body: actor ? `${actor} assigned you “${habit}”.` : `You've been assigned “${habit}”.` }),
  },
  validation_result: {
    es: ({ habit, validated, rejected }) => {
      const pro = `${validated} a favor`;
      const con = `${rejected} en contra`;
      return {
        title: 'Resultado de la validación',
        body: validated > 0
          ? `«${habit}»: validado (${rejected > 0 ? `${pro}, ${con}` : pro}).`
          : `«${habit}»: no validado (${con}).`,
      };
    },
    en: ({ habit, validated, rejected }) => {
      const pro = `${validated} for`;
      const con = `${rejected} against`;
      return {
        title: 'Validation result',
        body: validated > 0
          ? `“${habit}”: validated (${rejected > 0 ? `${pro}, ${con}` : pro}).`
          : `“${habit}”: not validated (${con}).`,
      };
    },
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

// Textos en el idioma pedido; los nombres vacíos pasan a "Alguien"/"Someone".
function texts(type, locale, vars) {
  const lang = locale === 'en' ? 'en' : 'es';
  const v = { ...vars };
  if ('author' in v) v.author = v.author?.trim() || SOMEONE[lang];
  if ('actor' in v) v.actor = v.actor?.trim() || null;
  return TEXTS[type][lang](v);
}

async function fullName(db, userId) {
  if (!userId) return null;
  const { data, error } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data?.full_name ?? null;
}

// Envío común a los tres tipos. `notice` = { type, recipients, vars, keys, data }:
// - recipients: user_ids ya filtrados por la función SQL del tipo
// - vars: variables de los textos; keys: log_id/habit_id para notification_log
// Un aviso lógico por destinatario en notification_log: su índice único del
// tipo es la deduplicación (23505 = ya avisado → a ese no se le envía).
// notice.releaseOnBatchFailure: si el envío a Expo falla para TODAS las
// entregas de un aviso por un fallo del lote entero (red, error HTTP), se
// borra el aviso de notification_log (y sus entregas, en cascada) para que un
// reintento pueda reenviarlo. Solo el recordatorio diario lo usa: tiene el
// reintento de las 21:00; los avisos por evento no tienen reintento.
async function notify(db, notice, dryRun) {
  const { type, recipients, vars, keys, data } = notice;
  if (!recipients.length) return dryRun ? { dry_run: true, recipients: [], messages: [] } : { recipients: 0, notifications: 0, deliveries: 0 };

  // Tokens activos (puede haber varios por persona); el más reciente primero.
  const { data: tokenRows, error: tokErr } = await db
    .from('push_tokens').select('id, user_id, token, locale')
    .in('user_id', recipients).eq('enabled', true)
    .order('last_seen_at', { ascending: false });
  if (tokErr) throw tokErr;
  const tokens = tokenRows ?? [];

  if (dryRun) {
    return {
      dry_run: true,
      recipients,
      messages: tokens.map((t) => ({ recipient_id: t.user_id, push_token_id: t.id, locale: t.locale, ...texts(type, t.locale, vars), data })),
    };
  }

  const messages = [];
  let notifications = 0;
  for (const recipientId of recipients) {
    const own = tokens.filter((t) => t.user_id === recipientId);
    // El texto del registro, en el idioma de su dispositivo más reciente.
    const logText = texts(type, own[0]?.locale, vars);
    const { data: notif, error: insErr } = await db.from('notification_log')
      .insert({ type, recipient_id: recipientId, ...keys, ...logText, data })
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
    own.forEach((t, i) => messages.push({ deliveryId: deliveries[i].id, notificationId: notif.id, token: t, ...texts(type, t.locale, vars), data }));
  }

  const counts = await sendToExpo(db, messages, notice.simulateExpoFailure === true);
  const result = { recipients: recipients.length, notifications, deliveries: messages.length, ...counts };
  if (notice.releaseOnBatchFailure) {
    const byNotif = new Map();
    for (const m of messages) byNotif.set(m.notificationId, [...(byNotif.get(m.notificationId) ?? []), m]);
    const released = [...byNotif].filter(([, ms]) => ms.every((m) => m.batchError)).map(([id]) => id);
    if (released.length) {
      console.error('push-events: fallo del lote en Expo, se liberan para reintento', type, released.length, byNotif.get(released[0])[0].batchError);
      const { error } = await db.from('notification_log').delete().in('id', released);
      if (error) console.error('push-events: no se pudieron liberar los avisos', error.message);
      else result.released = released.length;
    }
  }
  return result;
}

// ---- validation_pending: un log nuevo → sus validadores (o los admins) ----
async function handleValidationPending(db, { log_id: logId }, dryRun) {
  const { data: log, error: logErr } = await db
    .from('habit_logs').select('id, user_id, habit_id, status').eq('id', logId).maybeSingle();
  if (logErr) throw logErr;
  if (!log || log.status !== 'pending') return { skipped: 'not_pending' };

  const [{ data: habit, error: habitErr }, author] = await Promise.all([
    db.from('habits').select('title').eq('id', log.habit_id).single(),
    fullName(db, log.user_id),
  ]);
  if (habitErr) throw habitErr;

  const { data: rows, error } = await db.rpc('push_recipients_for_validation', { p_log_id: logId });
  if (error) throw error;
  return notify(db, {
    type: 'validation_pending',
    recipients: (rows ?? []).map((r) => r.recipient_id),
    vars: { author, habit: habit.title },
    keys: { log_id: logId, habit_id: log.habit_id },
    data: { type: 'validation_pending', log_id: logId, habit_id: log.habit_id },
  }, dryRun);
}

// ---- habit_assigned: una asignación nueva → el asignado (si no es el actor) ----
async function handleHabitAssigned(db, { assignment_id: assignmentId, actor_id: actorId }, dryRun) {
  const { data: rows, error } = await db.rpc('push_recipients_for_assignment', { p_assignment_id: assignmentId, p_actor_id: actorId ?? null });
  if (error) throw error;
  if (!rows?.length) return dryRun ? { dry_run: true, recipients: [], messages: [] } : { skipped: 'no_recipient' };

  const habitId = rows[0].habit_id;
  const [{ data: habit, error: habitErr }, actor] = await Promise.all([
    db.from('habits').select('title').eq('id', habitId).single(),
    fullName(db, actorId),
  ]);
  if (habitErr) throw habitErr;
  return notify(db, {
    type: 'habit_assigned',
    recipients: rows.map((r) => r.recipient_id),
    vars: { actor, habit: habit.title },
    keys: { habit_id: habitId },
    data: { type: 'habit_assigned', habit_id: habitId },
  }, dryRun);
}

// ---- validation_result: un voto → el autor, solo cuando han votado todos ----
async function handleValidationResult(db, { log_id: logId }, dryRun) {
  const { data: rows, error } = await db.rpc('push_validation_result_for_log', { p_log_id: logId });
  if (error) throw error;
  const r = rows?.[0];
  if (!r) return { skipped: 'no_recipient' };
  if (!r.ready) return { skipped: 'not_ready', validated: r.validated_count, rejected: r.rejected_count };

  const { data: habit, error: habitErr } = await db.from('habits').select('title').eq('id', r.habit_id).single();
  if (habitErr) throw habitErr;
  return notify(db, {
    type: 'validation_result',
    recipients: [r.recipient_id],
    vars: { habit: habit.title, validated: r.validated_count, rejected: r.rejected_count },
    keys: { log_id: logId, habit_id: r.habit_id },
    data: { type: 'validation_result', log_id: logId, habit_id: r.habit_id },
  }, dryRun);
}

// ---- daily_reminder: cada hora, a quien tiene las 20 (o las 21) y le queda algo ----
async function handleDailyReminder(db, { now, user_ids: userIds, simulate_expo_failure: simulateExpoFailure }, dryRun) {
  const { data: candidates, error } = await db.rpc('push_reminder_candidates', {
    p_now: now ?? new Date().toISOString(),
    p_user_ids: userIds ?? null,
  });
  if (error) throw error;

  const total = { candidates: candidates?.length ?? 0, notifications: 0, deliveries: 0, ticket_ok: 0, ticket_error: 0 };
  const messages = [];
  for (const c of candidates ?? []) {
    const r = await notify(db, {
      type: 'daily_reminder',
      recipients: [c.user_id],
      vars: { count: c.pending_count },
      keys: { local_date: c.local_date },
      data: { type: 'daily_reminder' },
      releaseOnBatchFailure: true,
      simulateExpoFailure: simulateExpoFailure === true,
    }, dryRun);
    if (dryRun) messages.push(...r.messages);
    else for (const k of ['notifications', 'deliveries', 'ticket_ok', 'ticket_error', 'released']) total[k] = (total[k] ?? 0) + (r[k] ?? 0);
  }
  return dryRun ? { dry_run: true, candidates: candidates ?? [], messages } : total;
}

const HANDLERS = {
  daily_reminder: {
    handle: handleDailyReminder,
    valid: (p) => {
      const hasUsers = Array.isArray(p.user_ids) && p.user_ids.length > 0;
      return (p.user_ids == null || (hasUsers && p.user_ids.length <= 100 && p.user_ids.every(isUuid)))
        && (p.now == null || (typeof p.now === 'string' && !Number.isNaN(Date.parse(p.now)) && hasUsers))
        && (p.simulate_expo_failure == null || (p.simulate_expo_failure === true && hasUsers));
    },
    error: 'invalid_reminder_params',
  },
  validation_pending: { handle: handleValidationPending, valid: (p) => isUuid(p.log_id), error: 'invalid_log_id' },
  habit_assigned: {
    handle: handleHabitAssigned,
    valid: (p) => isUuid(p.assignment_id) && (p.actor_id == null || isUuid(p.actor_id)),
    error: 'invalid_assignment',
  },
  validation_result: { handle: handleValidationResult, valid: (p) => isUuid(p.log_id), error: 'invalid_log_id' },
};

async function sendToExpo(db, messages, simulateFailure = false) {
  const counts = { ticket_ok: 0, ticket_error: 0 };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!accessToken) console.warn('push-events: falta EXPO_ACCESS_TOKEN; se envía sin él');

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    let tickets = null;
    let batchError = simulateFailure ? 'simulated: fallo del lote (test)' : null;
    if (!simulateFailure) try {
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
        if (batchError) m.batchError = batchError;
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
  const handler = HANDLERS[payload?.type];
  if (!handler) return json({ error: 'unsupported_type' }, 400);
  if (!handler.valid(payload)) return json({ error: handler.error }, 400);

  const ref = payload.log_id ?? payload.assignment_id ?? payload.now ?? '';
  try {
    const result = await handler.handle(db, payload, payload.dry_run === true);
    console.log('push-events', payload.type, ref, JSON.stringify(result));
    return json(result);
  } catch (e) {
    console.error('push-events: error', payload.type, ref, e instanceof Error ? e.message : JSON.stringify(e));
    return json({ error: 'internal' }, 500);
  }
});
