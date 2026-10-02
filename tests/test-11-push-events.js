// Fase 11: notificaciones push — avisos por evento: "pendiente de validar"
// (tests 1-8), "hábito asignado" (9), "resultado de la validación" (10) y el
// recordatorio diario (11, con la hora simulada: p_now / "now").
// sql/2026-10-02_push_events.sql, 2026-10-02b, 2026-10-02c, 2026-10-02d,
// supabase/functions/push-events, docs/push-etapa3-diseno.md, 3b y etapa6.
// Ejecutar con: node tests/test-11-push-events.js
//
// Llama a la Edge Function desplegada. Los tokens son falsos
// (ExponentPushToken[zztest-…]) y pertenecen a usuarios zztest-: Expo los
// rechaza y no llega nada a ningún teléfono. El secreto del webhook se lee de
// Vault con SUPABASE_DB_URL y nunca se imprime.

const { Client } = require('pg');
const {
  TEST_PREFIX,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseAdmin,
  getAnonClient,
  getClientForUser,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  resetActivationRateLimit,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/push-events`;

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}
function checkError(error, pattern, message) {
  const pass = !!error && pattern.test(error.message);
  console.log(`  ${pass ? '✓' : '✗'} ${message}${error ? ` (${error.message})` : ' (sin error)'}`);
  results.push({ pass, message });
}

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (label) => `ExponentPushToken[${TEST_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}]`;

async function addMember(admin, label) {
  const email = `${TEST_PREFIX}${Date.now()}-${label}@habitapp-test.local`;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await must(supabaseAdmin.from('activation_codes').insert({ code, email, full_name: `${TEST_PREFIX}${label}`, company_id: admin.companyId }));
  await resetActivationRateLimit();
  const m = await joinAsTestMember(code);
  return { ...m, client: await getClientForUser(m.email, m.password) };
}

async function registerToken(client, locale, timeZone = 'Europe/Madrid') {
  const token = tok(locale);
  await must(client.rpc('register_push_token', { p_token: token, p_platform: 'ios', p_locale: locale, p_time_zone: timeZone }));
  return token;
}

// Log pendiente creado SIN disparar el trigger (se inserta 'validated' y se
// pasa a 'pending'; el trigger solo escucha INSERT): para las llamadas directas.
// habit_logs_one_per_day: un log por hábito, usuario y día → fechas distintas.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
async function quietPendingLog(habitId, userId, days = 1) {
  const log = await must(supabaseAdmin.from('habit_logs').insert({ habit_id: habitId, user_id: userId, status: 'validated', created_at: daysAgo(days) }).select('id').single());
  await must(supabaseAdmin.from('habit_logs').update({ status: 'pending' }).eq('id', log.id));
  return log.id;
}

async function callFunction(body, secret) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const recipientsOf = async (logId) =>
  (await must(supabaseAdmin.rpc('push_recipients_for_validation', { p_log_id: logId }))).map((r) => r.recipient_id).sort();
// Avisos de un tipo filtrando por columnas (p. ej. { habit_id, recipient_id }).
const noticesOf = async (type, filters) => {
  let q = supabaseAdmin.from('notification_log').select('id, recipient_id, type, title, body, data').eq('type', type);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  return must(q);
};
// Espera a que el trigger (pg_net → push-events) deje al menos `min` avisos y
// da un margen por si llegara alguno de más.
async function waitNotices(type, filters, min = 1) {
  let rows = [];
  for (let i = 0; i < 20 && rows.length < min; i++) {
    await sleep(1000);
    rows = await noticesOf(type, filters);
  }
  await sleep(2000);
  return noticesOf(type, filters);
}
const newHabit = async (companyId, createdBy, title, extra = {}) =>
  must(supabaseAdmin.from('habits').insert({ title, company_id: companyId, created_by: createdBy, is_active: true, ...extra }).select('id').single());

const notificationsOf = async (logId) =>
  must(supabaseAdmin.from('notification_log').select('id, recipient_id, type, title, body, data').eq('log_id', logId).eq('type', 'validation_pending'));

async function run() {
  console.log('== Fase 11: avisos push por evento ==\n');
  console.log('Limpieza previa...');
  await cleanupTestData();
  console.log('OK\n');

  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await pg.connect();

  try {
    const { rows: secretRows } = await pg.query("select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret'");
    if (secretRows.length !== 1) throw new Error('no existe push_webhook_secret en Vault');
    const secret = secretRows[0].decrypted_secret;

    // Empresa A: admin, autor (asignado), validador y un miembro sin papel.
    const A = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyPushEvA-${Date.now()}`);
    const author = await addMember(A, 'Autor');
    const validator = await addMember(A, 'Validador');
    const bystander = await addMember(A, 'Otro');
    // Empresa B: admin y miembro.
    const B = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyPushEvB-${Date.now()}`);
    const memberB = await addMember(B, 'MiembroB');
    const cA = await getClientForUser(A.email, A.password);
    const cB = await getClientForUser(B.email, B.password);

    const habitTitle = `${TEST_PREFIX}Fruta`;
    const habitV = await must(supabaseAdmin.from('habits').insert({ title: habitTitle, company_id: A.companyId, created_by: A.userId, is_active: true }).select('id').single());
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitV.id, user_id: author.userId }));
    await must(supabaseAdmin.from('habit_validators').insert({ habit_id: habitV.id, user_id: validator.userId }));
    const habitNoV = await must(supabaseAdmin.from('habits').insert({ title: `${TEST_PREFIX}SinValidador`, company_id: A.companyId, created_by: A.userId, is_active: true }).select('id').single());
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitNoV.id, user_id: author.userId }));
    const habitB = await must(supabaseAdmin.from('habits').insert({ title: `${TEST_PREFIX}HabitB`, company_id: B.companyId, created_by: B.userId, is_active: true }).select('id').single());
    await must(supabaseAdmin.from('habit_validators').insert({ habit_id: habitB.id, user_id: B.userId }));

    // Tokens: el validador tiene dos dispositivos (es y en); todos los demás uno.
    const validatorTokenEs = await registerToken(validator.client, 'es');
    const validatorTokenEn = await registerToken(validator.client, 'en');
    await registerToken(author.client, 'es');
    await registerToken(bystander.client, 'es');
    await registerToken(cA, 'es');
    await registerToken(cB, 'es');
    await registerToken(memberB.client, 'es');

    // ---- Test 1: destinatarios ----
    console.log('Test 1: push_recipients_for_validation');
    const log1 = await quietPendingLog(habitV.id, author.userId);
    check(await recipientsOf(log1), [validator.userId], 'Test 1a: hábito con validador → solo el validador (ni el autor, ni el admin, ni otra empresa)');
    const log2 = await quietPendingLog(habitNoV.id, author.userId);
    check(await recipientsOf(log2), [A.userId], 'Test 1b: hábito sin validadores → los admins de la empresa');
    const logByValidator = await quietPendingLog(habitV.id, validator.userId);
    check(await recipientsOf(logByValidator), [], 'Test 1c: el autor nunca se avisa a sí mismo');
    const logValidated = await must(supabaseAdmin.from('habit_logs').insert({ habit_id: habitV.id, user_id: author.userId, status: 'validated', created_at: daysAgo(2) }).select('id').single());
    check(await recipientsOf(logValidated.id), [], 'Test 1d: un log ya validado no tiene destinatarios');
    const logB = await quietPendingLog(habitB.id, memberB.userId);
    check(await recipientsOf(logB), [B.userId], 'Test 1e: en la empresa B, solo su validador');

    // ---- Test 2: las funciones SQL no son para clientes ----
    console.log('\nTest 2: las funciones de la etapa 3 solo las ejecuta service_role');
    checkError((await author.client.rpc('push_recipients_for_validation', { p_log_id: log1 })).error, /permission denied/, 'Test 2a: authenticated no ejecuta push_recipients_for_validation');
    checkError((await getAnonClient().rpc('push_webhook_secret_ok', { p_secret: 'x' })).error, /permission denied/, 'Test 2b: anon no ejecuta push_webhook_secret_ok');
    checkError((await author.client.rpc('push_webhook_secret_ok', { p_secret: 'x' })).error, /permission denied/, 'Test 2c: authenticated no ejecuta push_webhook_secret_ok');

    // ---- Test 3: autenticación y validación de la Edge Function ----
    console.log('\nTest 3: la Edge Function rechaza llamadas sin el secreto o mal formadas');
    const body1 = { type: 'validation_pending', log_id: log1 };
    check((await callFunction(body1)).status, 401, 'Test 3a: sin cabecera x-webhook-secret → 401');
    check((await callFunction(body1, 'falso')).status, 401, 'Test 3b: con un secreto falso → 401');
    check((await fetch(FUNCTION_URL)).status, 405, 'Test 3c: GET → 405');
    check((await callFunction({ type: 'otro', log_id: log1 }, secret)).status, 400, 'Test 3d: tipo no soportado → 400');
    check((await callFunction({ type: 'validation_pending', log_id: 'no-uuid' }, secret)).status, 400, 'Test 3e: log_id no válido → 400');
    check((await notificationsOf(log1)).length, 0, 'Test 3f: ninguna de esas llamadas ha registrado avisos');

    // ---- Test 4: ensayo (dry_run) ----
    console.log('\nTest 4: dry_run devuelve los mensajes sin insertar ni enviar');
    const dry = await callFunction({ ...body1, dry_run: true }, secret);
    const dryMessages = (dry.body?.messages ?? []).map((m) => ({ recipient: m.recipient_id, locale: m.locale, title: m.title, body: m.body, data: m.data }))
      .sort((a, b) => a.locale.localeCompare(b.locale));
    const data1 = { type: 'validation_pending', log_id: log1, habit_id: habitV.id };
    check([dry.status, dry.body?.dry_run, dry.body?.recipients], [200, true, [validator.userId]], 'Test 4a: responde con el validador como único destinatario');
    check(dryMessages, [
      { recipient: validator.userId, locale: 'en', title: 'To validate', body: `${TEST_PREFIX}Autor completed “${habitTitle}”. You have a proof to validate.`, data: data1 },
      { recipient: validator.userId, locale: 'es', title: 'Pendiente de validar', body: `${TEST_PREFIX}Autor ha completado «${habitTitle}». Tienes una prueba por validar.`, data: data1 },
    ], 'Test 4b: un mensaje por dispositivo, cada uno en su idioma');
    check((await notificationsOf(log1)).length, 0, 'Test 4c: dry_run no registra nada');

    // ---- Test 5: envío real a Expo (tokens falsos) ----
    console.log('\nTest 5: envío a Expo y registro de avisos y entregas');
    const sent = await callFunction(body1, secret);
    check([sent.status, sent.body?.recipients, sent.body?.notifications, sent.body?.deliveries], [200, 1, 1, 2], 'Test 5a: un destinatario, un aviso, dos entregas');
    const notifs = await notificationsOf(log1);
    // El texto del registro va en el idioma del dispositivo usado más recientemente (aquí, el 'en').
    check(notifs.map((n) => [n.recipient_id, n.title]), [[validator.userId, 'To validate']], 'Test 5b: notification_log tiene una única fila, para el validador');
    const deliveries = notifs.length
      ? await must(supabaseAdmin.from('push_deliveries').select('status, error, ticket_id, push_tokens(token)').eq('notification_id', notifs[0].id))
      : [];
    check(deliveries.map((d) => d.push_tokens?.token).sort(), [validatorTokenEn, validatorTokenEs].sort(), 'Test 5c: una entrega por cada token del validador');
    check(deliveries.every((d) => d.status !== 'queued'), true, 'Test 5d: ninguna entrega queda en "queued" (todas tienen el resultado de Expo)');
    console.log(`    (resultado de Expo con tokens falsos: ${[...new Set(deliveries.map((d) => `${d.status} ${d.error ?? ''}`.trim()))].join(' | ')})`);
    const notRegistered = deliveries.filter((d) => /DeviceNotRegistered/.test(d.error ?? ''));
    if (notRegistered.length) {
      const { data: still } = await supabaseAdmin.from('push_tokens').select('token, enabled').in('token', [validatorTokenEs, validatorTokenEn]);
      check(still.every((t) => t.enabled === false), true, 'Test 5e: los tokens que Expo da por no registrados quedan desactivados');
    }

    // ---- Test 6: deduplicación ----
    console.log('\nTest 6: el mismo log no se avisa dos veces');
    const again = await callFunction(body1, secret);
    check([again.status, again.body?.notifications, again.body?.deliveries], [200, 0, 0], 'Test 6a: segunda llamada → ningún aviso ni entrega nueva');
    check((await notificationsOf(log1)).length, 1, 'Test 6b: sigue habiendo una sola fila en notification_log');

    // ---- Test 7: el esquema net (pg_net) no es alcanzable por clientes ----
    console.log('\nTest 7: pg_net no queda al alcance de anon/authenticated');
    const netRes = await fetch(`${SUPABASE_URL}/rest/v1/_http_response?select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Accept-Profile': 'net' },
    });
    const netBody = await netRes.json().catch(() => null);
    check([netRes.status, netBody?.code], [406, 'PGRST106'], 'Test 7a: la API rechaza el esquema net (no está entre los expuestos)');
    const { rows: netFns } = await pg.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ~ '\\mnet\\.'
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
       order by 1`);
    check(netFns.map((r) => r.proname), [], 'Test 7b: ninguna función de public ejecutable por anon/authenticated usa net');

    // ---- Test 8: el trigger, de punta a punta ----
    console.log('\nTest 8: un log pendiente creado desde la app avisa solo al validador');
    const { rows: trg } = await pg.query(`
      select pg_get_triggerdef(t.oid) as def,
             has_function_privilege('authenticated', t.tgfoid, 'execute') as auth_exec
        from pg_trigger t where t.tgrelid = 'public.habit_logs'::regclass and t.tgname = 'habit_logs_push_validation_pending'`);
    check(trg.length === 1 && /AFTER INSERT/.test(trg[0].def) && /status = 'pending'/.test(trg[0].def), true, 'Test 8a: el trigger existe, AFTER INSERT y solo para status pending');
    check(trg[0]?.auth_exec, false, 'Test 8b: su función no es ejecutable por clientes');

    const appLog = await must(author.client.from('habit_logs').insert({ habit_id: habitV.id, user_id: author.userId, status: 'pending' }).select('id').single());
    let appNotifs = [];
    for (let i = 0; i < 20 && !appNotifs.length; i++) {
      await sleep(1000);
      appNotifs = await notificationsOf(appLog.id);
    }
    await sleep(2000); // margen por si llegara un segundo aviso
    appNotifs = await notificationsOf(appLog.id);
    check(appNotifs.map((n) => n.recipient_id), [validator.userId], 'Test 8c: llega un único aviso, al validador (ni al autor, ni al admin, ni a otra empresa)');

    const validatedLog = await must(supabaseAdmin.from('habit_logs').insert({ habit_id: habitV.id, user_id: author.userId, status: 'validated', created_at: daysAgo(3) }).select('id').single());
    await sleep(5000);
    const { count: validatedNotifs } = await supabaseAdmin.from('notification_log').select('id', { count: 'exact', head: true }).eq('log_id', validatedLog.id);
    check(validatedNotifs, 0, 'Test 8d: un log insertado ya validado no genera aviso');

    // ---- Test 9: "hábito asignado" ----
    console.log('\nTest 9: aviso de hábito asignado');
    const adminName = `${TEST_PREFIX}Admin`;
    const habitAsTitle = `${TEST_PREFIX}Asignado`;
    const habitAs = await newHabit(A.companyId, A.userId, habitAsTitle);
    // El admin asigna con su propio cliente (camino de AdminScreen): actor = admin.
    const asAuthor = await must(cA.from('habit_assignments').insert({ habit_id: habitAs.id, user_id: author.userId }).select('id').single());
    const assignedRecipients = async (assignmentId, actorId) =>
      (await must(supabaseAdmin.rpc('push_recipients_for_assignment', { p_assignment_id: assignmentId, p_actor_id: actorId }))).map((r) => r.recipient_id);
    check(await assignedRecipients(asAuthor.id, A.userId), [author.userId], 'Test 9a: destinatario = el asignado');
    check(await assignedRecipients(asAuthor.id, author.userId), [], 'Test 9b: nunca quien hizo la asignación');
    const authorAssigned = await waitNotices('habit_assigned', { habit_id: habitAs.id, recipient_id: author.userId });
    check(authorAssigned.map((n) => [n.title, n.body]), [['Nuevo hábito', `${adminName} te ha asignado «${habitAsTitle}».`]],
      'Test 9c: con el trigger, un aviso para el asignado, con el nombre de quien asigna');

    // Ensayo con un token recién registrado (los anteriores pueden estar ya desactivados por Expo).
    await registerToken(author.client, 'es');
    const dryAs = await callFunction({ type: 'habit_assigned', assignment_id: asAuthor.id, actor_id: null, dry_run: true }, secret);
    check([dryAs.status, [...new Set((dryAs.body?.messages ?? []).map((m) => m.body))]], [200, [`Te han asignado «${habitAsTitle}».`]],
      'Test 9d: dry_run sin actor (desde SQL): texto impersonal');

    // El admin se asigna a sí mismo, una asignación entre empresas y un hábito inactivo: sin aviso.
    const habitOff = await newHabit(A.companyId, A.userId, `${TEST_PREFIX}Inactivo`, { is_active: false });
    await must(cA.from('habit_assignments').insert({ habit_id: habitAs.id, user_id: A.userId }));
    const asCross = await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitAs.id, user_id: memberB.userId }).select('id').single());
    const asOff = await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitOff.id, user_id: bystander.userId }).select('id').single());
    check([await assignedRecipients(asCross.id, null), await assignedRecipients(asOff.id, null)], [[], []],
      'Test 9e: nadie de otra empresa ni por un hábito inactivo');
    await sleep(5000);
    const noNotice = [
      (await noticesOf('habit_assigned', { habit_id: habitAs.id, recipient_id: A.userId })).length,
      (await noticesOf('habit_assigned', { habit_id: habitAs.id, recipient_id: memberB.userId })).length,
      (await noticesOf('habit_assigned', { habit_id: habitOff.id })).length,
    ];
    check(noNotice, [0, 0, 0], 'Test 9f: con el trigger, ningún aviso al admin que se asigna, a otra empresa ni por un hábito inactivo');

    // Editar el hábito como AdminScreen: borrar todas las asignaciones y reinsertar (autor + uno nuevo).
    await must(cA.from('habit_assignments').delete().eq('habit_id', habitAs.id));
    await must(cA.from('habit_assignments').insert([{ habit_id: habitAs.id, user_id: author.userId }, { habit_id: habitAs.id, user_id: bystander.userId }]));
    const bystanderAssigned = await waitNotices('habit_assigned', { habit_id: habitAs.id, recipient_id: bystander.userId });
    const authorAfterEdit = await noticesOf('habit_assigned', { habit_id: habitAs.id, recipient_id: author.userId });
    check([authorAfterEdit.length, bystanderAssigned.length], [1, 1], 'Test 9g: al editar no se reavisa a quien ya estaba y sí al nuevo');

    // ---- Test 10: "resultado de la validación" ----
    console.log('\nTest 10: aviso de resultado de la validación');
    const resultOf = async (logId) => (await must(supabaseAdmin.rpc('push_validation_result_for_log', { p_log_id: logId })))[0] ?? null;
    const habitRTitle = `${TEST_PREFIX}DosValidadores`;
    const habitR = await newHabit(A.companyId, A.userId, habitRTitle);
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitR.id, user_id: author.userId }));
    await must(supabaseAdmin.from('habit_validators').insert([{ habit_id: habitR.id, user_id: validator.userId }, { habit_id: habitR.id, user_id: bystander.userId }]));
    const logR = await must(author.client.from('habit_logs').insert({ habit_id: habitR.id, user_id: author.userId, status: 'pending' }).select('id').single());

    await must(validator.client.from('habit_validations').insert({ habit_log_id: logR.id, validator_id: validator.userId, status: 'validated' }));
    await sleep(5000);
    const r1 = await resultOf(logR.id);
    check([r1?.ready, r1?.validated_count, (await noticesOf('validation_result', { log_id: logR.id })).length], [false, 1, 0],
      'Test 10a: tras el primer voto de dos, sin aviso (falta un validador)');

    await must(bystander.client.from('habit_validations').insert({ habit_log_id: logR.id, validator_id: bystander.userId, status: 'rejected' }));
    const resR = await waitNotices('validation_result', { log_id: logR.id });
    check(resR.map((n) => [n.recipient_id, n.title, n.body]), [[author.userId, 'Resultado de la validación', `«${habitRTitle}»: validado (1 a favor, 1 en contra).`]],
      'Test 10b: tras el segundo voto, un único aviso para el autor con los recuentos');
    const againR = await callFunction({ type: 'validation_result', log_id: logR.id }, secret);
    check([againR.status, againR.body?.notifications, (await noticesOf('validation_result', { log_id: logR.id })).length], [200, 0, 1],
      'Test 10c: otra llamada para el mismo log no repite el aviso');
    await registerToken(author.client, 'es'); // el envío del 10b ya desactivó los anteriores
    const dryR = await callFunction({ type: 'validation_result', log_id: logR.id, dry_run: true }, secret);
    check([...new Set((dryR.body?.messages ?? []).filter((m) => m.locale === 'es').map((m) => m.body))], [`«${habitRTitle}»: validado (1 a favor, 1 en contra).`],
      'Test 10d: dry_run con el mismo texto');

    // Todo en contra, con un único validador.
    const habitR2Title = `${TEST_PREFIX}UnValidador`;
    const habitR2 = await newHabit(A.companyId, A.userId, habitR2Title);
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitR2.id, user_id: author.userId }));
    await must(supabaseAdmin.from('habit_validators').insert({ habit_id: habitR2.id, user_id: validator.userId }));
    const logR2 = await must(author.client.from('habit_logs').insert({ habit_id: habitR2.id, user_id: author.userId, status: 'pending' }).select('id').single());
    await must(validator.client.from('habit_validations').insert({ habit_log_id: logR2.id, validator_id: validator.userId, status: 'rejected' }));
    const resR2 = await waitNotices('validation_result', { log_id: logR2.id });
    check(resR2.map((n) => n.body), [`«${habitR2Title}»: no validado (1 en contra).`], 'Test 10e: todo en contra → "no validado"');

    // Hábito sin validadores: vota el admin (fallback).
    const logNoV = await must(author.client.from('habit_logs').insert({ habit_id: habitNoV.id, user_id: author.userId, status: 'pending' }).select('id').single());
    await must(cA.from('habit_validations').insert({ habit_log_id: logNoV.id, validator_id: A.userId, status: 'validated' }));
    const resNoV = await waitNotices('validation_result', { log_id: logNoV.id });
    check(resNoV.map((n) => n.recipient_id), [author.userId], 'Test 10f: sin validadores, el voto del admin cierra el resultado');

    // Autor de otra empresa (log forzado con la clave de servicio): nunca recibe nada.
    const logCross = await must(supabaseAdmin.from('habit_logs').insert({ habit_id: habitR2.id, user_id: memberB.userId, status: 'pending', created_at: daysAgo(1) }).select('id').single());
    await must(supabaseAdmin.from('habit_validations').insert({ habit_log_id: logCross.id, validator_id: validator.userId, status: 'validated' }));
    await sleep(5000);
    check([await resultOf(logCross.id), (await noticesOf('validation_result', { log_id: logCross.id })).length], [null, 0],
      'Test 10g: un autor de otra empresa no tiene resultado ni aviso');

    // Catálogo de los dos triggers nuevos.
    const { rows: trg2 } = await pg.query(`
      select t.tgname, has_function_privilege('authenticated', t.tgfoid, 'execute') as auth_exec,
             pg_get_triggerdef(t.oid) ~ 'AFTER INSERT' as after_insert
        from pg_trigger t where t.tgname in ('habit_assignments_push_assigned', 'habit_validations_push_result') order by 1`);
    check(trg2.map((r) => [r.tgname, r.after_insert, r.auth_exec]),
      [['habit_assignments_push_assigned', true, false], ['habit_validations_push_result', true, false]],
      'Test 10h: los dos triggers existen, AFTER INSERT, y sus funciones no son de clientes');

    // ---- Test 11: recordatorio diario, con la hora simulada ----
    // Toda llamada lleva user_ids zztest-: con un "now" inventado, sin ese
    // filtro, el recordatorio podría llegar a usuarios reales.
    console.log('\nTest 11: recordatorio diario (hora simulada)');
    const candidatesAt = async (now, userIds) =>
      must(supabaseAdmin.rpc('push_reminder_candidates', { p_now: now, p_user_ids: userIds }));
    const pendingAt = async (userId, tz, now) =>
      (await must(supabaseAdmin.rpc('pending_habits_for_user', { p_user_id: userId, p_time_zone: tz, p_now: now }))).map((x) => x.title);
    const logAt = (habitId, userId, iso) =>
      must(supabaseAdmin.from('habit_logs').insert({ habit_id: habitId, user_id: userId, status: 'validated', created_at: iso }));
    const assign = (habitId, userId) => must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habitId, user_id: userId }));

    // Empresa C propia: A ya está en el tope de miembros de su plan.
    const C = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyPushRecC-${Date.now()}`);
    const tokyo = await addMember(C, 'Tokio');
    const kolkata = await addMember(C, 'Calcuta');
    const madrid = await addMember(C, 'Madrid');
    const ny = await addMember(C, 'NuevaYork');
    const nyDone = await addMember(C, 'NuevaYorkHecho');
    const daily = await newHabit(C.companyId, C.userId, `${TEST_PREFIX}Diario`);
    for (const u of [tokyo, kolkata, madrid, nyDone]) await assign(daily.id, u.userId);

    // Pendientes en hora local de Nueva York. "Ahora" = 2026-10-08T00:30Z = miércoles 7/10 20:30 EDT.
    // Cada caso está elegido para que un cálculo con fechas UTC dé otro resultado.
    const NOW_NY = '2026-10-08T00:30:00Z';
    const nyHabit = async (title, extra) => {
      const x = await newHabit(C.companyId, C.userId, `${TEST_PREFIX}${title}`, extra);
      await assign(x.id, ny.userId);
      return x;
    };
    const d1 = await nyHabit('D1-hecho-hoy');
    await logAt(d1.id, ny.userId, '2026-10-07T23:30:00Z');            // 19:30 local de hoy (día UTC: mañana)
    const d2 = await nyHabit('D2-hecho-ayer');
    await logAt(d2.id, ny.userId, '2026-10-07T03:00:00Z');            // 23:00 local del martes
    const o1 = await nyHabit('O1-una-vez', { recurrence: 'once' });
    await logAt(o1.id, ny.userId, '2026-10-01T12:00:00Z');
    const w1 = await nyHabit('W1-semana-2-de-3', { recurrence: 'weekly_x', weekly_target: 3 });
    await logAt(w1.id, ny.userId, '2026-10-05T03:00:00Z');            // domingo 4/10 23:00 local: semana anterior
    await logAt(w1.id, ny.userId, '2026-10-06T12:00:00Z');
    await logAt(w1.id, ny.userId, '2026-10-07T02:00:00Z');            // martes 22:00 local
    const w2 = await nyHabit('W2-semana-3-de-3', { recurrence: 'weekly_x', weekly_target: 3 });
    await logAt(w2.id, ny.userId, '2026-10-05T12:00:00Z');
    await logAt(w2.id, ny.userId, '2026-10-06T12:00:00Z');
    await logAt(w2.id, ny.userId, '2026-10-07T02:00:00Z');
    const m1 = await nyHabit('M1-mes-1-de-2', { recurrence: 'monthly_x', monthly_target: 2 });
    await logAt(m1.id, ny.userId, '2026-10-01T02:00:00Z');            // 30/09 22:00 local: mes anterior
    await logAt(m1.id, ny.userId, '2026-10-02T12:00:00Z');
    const m2 = await nyHabit('M2-mes-2-de-2', { recurrence: 'monthly_x', monthly_target: 2 });
    await logAt(m2.id, ny.userId, '2026-10-02T12:00:00Z');
    await logAt(m2.id, ny.userId, '2026-10-03T12:00:00Z');
    await nyHabit('E1-caducado', { expires_at: '2026-10-07T12:00:00Z' });
    await nyHabit('I1-inactivo', { is_active: false });
    const xB = await newHabit(B.companyId, B.userId, `${TEST_PREFIX}X1-otra-empresa`);
    await assign(xB.id, ny.userId);
    // nyDone: su único hábito diario, hecho hoy en hora local.
    await logAt(daily.id, nyDone.userId, '2026-10-07T23:00:00Z');

    // Los avisos "hábito asignado" de este montaje van a los tokens que existan
    // al procesarse; con tokens falsos, Expo los rechaza y la función los
    // desactiva. Por eso los tokens se registran cuando ya se han procesado.
    await waitNotices('habit_assigned', { recipient_id: ny.userId }, 8);
    for (const u of [tokyo, kolkata, madrid, nyDone]) await waitNotices('habit_assigned', { recipient_id: u.userId, habit_id: daily.id });
    await registerToken(tokyo.client, 'es', 'Asia/Tokyo');
    await registerToken(kolkata.client, 'es', 'Asia/Kolkata');
    await registerToken(madrid.client, 'es', 'Europe/Madrid');
    await registerToken(ny.client, 'es', 'America/New_York');
    await registerToken(nyDone.client, 'es', 'America/New_York');

    // Franja de las 20 (y la 21 de reintento) en Tokio (UTC+9) y en India (UTC+5:30).
    const hoursHit = async (user, isoList) =>
      (await Promise.all(isoList.map((iso) => candidatesAt(iso, [user.userId])))).map((rows) => rows.map((r) => [r.local_date, r.local_hour])[0] ?? null);
    check(await hoursHit(tokyo, ['2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z', '2026-10-05T13:00:00Z']),
      [null, ['2026-10-05', 20], ['2026-10-05', 21], null], 'Test 11a: Tokio: candidato solo a las 20 y a las 21 locales, con su fecha local');
    check(await hoursHit(kolkata, ['2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z']),
      [null, ['2026-10-05', 20]], 'Test 11b: India (+5:30): la ejecución de las 15:00 UTC cae a las 20:30 locales');

    // Cambios de hora en Madrid: cada día local, exactamente una hora 20 y una 21.
    const dstSweep = async (startIso) => {
      const hits = {};
      const start = Date.parse(startIso);
      const runs = await Promise.all(Array.from({ length: 72 }, (_, i) => candidatesAt(new Date(start + i * 3600000).toISOString(), [madrid.userId])));
      runs.forEach((rows) => rows.forEach((r) => { (hits[r.local_date] ??= []).push(r.local_hour); }));
      return hits;
    };
    check(await dstSweep('2026-10-24T00:00:00Z'), { '2026-10-24': [20, 21], '2026-10-25': [20, 21], '2026-10-26': [20, 21] },
      'Test 11c: fin del horario de verano (25/10, día de 25 h): una franja de las 20 y una de las 21 por día');
    check(await dstSweep('2026-03-28T00:00:00Z'), { '2026-03-28': [20, 21], '2026-03-29': [20, 21], '2026-03-30': [20, 21] },
      'Test 11d: inicio del horario de verano (29/03, día de 23 h): una franja de las 20 y una de las 21 por día');

    check(await pendingAt(ny.userId, 'America/New_York', NOW_NY),
      [`${TEST_PREFIX}D2-hecho-ayer`, `${TEST_PREFIX}M1-mes-1-de-2`, `${TEST_PREFIX}W1-semana-2-de-3`],
      'Test 11e: pendientes en día/semana/mes LOCAL (no UTC); sin "once" hechos, metas cumplidas, caducados, inactivos ni otra empresa');

    check(await pendingAt(nyDone.userId, 'America/New_York', NOW_NY), [], 'Test 11f: quien lo tiene todo hecho no tiene pendientes');

    // Edge Function, siempre con user_ids zztest-.
    const reminder = (extra) => callFunction({ type: 'daily_reminder', now: NOW_NY, user_ids: [ny.userId, nyDone.userId], ...extra }, secret);
    check([(await reminder({ user_ids: 'x' })).status, (await reminder({ now: 'ayer' })).status], [400, 400], 'Test 11g: parámetros no válidos → 400');
    const dryRem = await reminder({ dry_run: true });
    check([dryRem.body?.candidates?.map((c) => [c.user_id, c.local_date, c.pending_count]), [...new Set((dryRem.body?.messages ?? []).map((m) => m.body))]],
      [[[ny.userId, '2026-10-07', 3]], ['Te quedan 3 hábitos por completar hoy.']], 'Test 11h: dry_run: solo el usuario con pendientes, con su fecha local y el recuento');
    const sentRem = await reminder();
    const remRows = await noticesOf('daily_reminder', { recipient_id: ny.userId });
    check([sentRem.body?.candidates, sentRem.body?.notifications, remRows.map((n) => [n.title, n.body])],
      [1, 1, [['Recordatorio', 'Te quedan 3 hábitos por completar hoy.']]], 'Test 11i: envío: un recordatorio, para quien le queda algo');
    check((await noticesOf('daily_reminder', { recipient_id: nyDone.userId })).length, 0, 'Test 11j: nada a quien lo tiene todo hecho');
    const retryRem = await reminder({ now: '2026-10-08T01:30:00Z' });   // franja de las 21
    check([retryRem.body?.notifications, (await noticesOf('daily_reminder', { recipient_id: ny.userId })).length], [0, 1],
      'Test 11k: la ejecución de las 21 no repite el recordatorio del mismo día local');

    const { rows: remFns } = await pg.query(`
      select proname, has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') as client_exec
        from pg_proc where proname in ('pending_habits_for_user', 'push_reminder_candidates', 'push_cron_tick') order by 1`);
    check(remFns.map((r) => [r.proname, r.client_exec]),
      [['pending_habits_for_user', false], ['push_cron_tick', false], ['push_reminder_candidates', false]],
      'Test 11l: las funciones del recordatorio no son ejecutables por clientes');
  } finally {
    await pg.end();
    console.log('\nLimpieza final...');
    await cleanupTestData();
    console.log('OK');
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n== Resumen: ${passed}/${results.length} pasaron ==`);
  if (failed > 0) {
    console.log('\nFallos:');
    results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.message}`));
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error('\nERROR FATAL (el test no pudo completarse):', e.message);
  process.exitCode = 1;
});
