// Fase 11: notificaciones push, etapa 3 — aviso "pendiente de validar"
// (sql/2026-10-02_push_events.sql, sql/2026-10-02b_push_events_trigger.sql,
// supabase/functions/push-events, docs/push-etapa3-diseno.md).
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

async function registerToken(client, locale) {
  const token = tok(locale);
  await must(client.rpc('register_push_token', { p_token: token, p_platform: 'ios', p_locale: locale, p_time_zone: 'Europe/Madrid' }));
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
const notificationsOf = async (logId) =>
  must(supabaseAdmin.from('notification_log').select('id, recipient_id, type, title, body, data').eq('log_id', logId).eq('type', 'validation_pending'));

async function run() {
  console.log('== Fase 11: aviso push "pendiente de validar" ==\n');
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
