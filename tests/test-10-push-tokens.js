// Fase 10: notificaciones push, etapa 1 — almacenamiento de tokens y
// registro de avisos (sql/2026-09-30b_push_tokens.sql,
// docs/push-notifications-plan.md). Ejecutar con: node tests/test-10-push-tokens.js
//
// No se envía ninguna notificación: los tokens son falsos pero con el formato
// de Expo (ExponentPushToken[zztest-…]) y pertenecen a usuarios zztest-, que
// cleanupTestData() borra; push_tokens y notification_log caen en cascada.

const {
  TEST_PREFIX,
  supabaseAdmin,
  testEmail,
  randomPassword,
  getAnonClient,
  getClientForUser,
  createTestCompanyAndAdmin,
  advanceHabitLog,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

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

const tok = (label) => `ExponentPushToken[${TEST_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}]`;
const register = (client, token, platform = 'ios', locale = 'es', tz = 'Europe/Madrid') =>
  client.rpc('register_push_token', { p_token: token, p_platform: platform, p_locale: locale, p_time_zone: tz });

async function bareUser() {
  const email = testEmail();
  const password = randomPassword();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { userId: data.user.id, email, password, client: await getClientForUser(email, password) };
}

async function run() {
  console.log('== Fase 10: tokens de push y registro de avisos ==\n');
  console.log('Limpieza previa...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    const A = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyPushA-${Date.now()}`);
    const B = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyPushB-${Date.now()}`);
    const cA = await getClientForUser(A.email, A.password);
    const cB = await getClientForUser(B.email, B.password);
    const anon = getAnonClient();

    // ---- Test 1: alta del token propio ----
    console.log('Test 1: un usuario registra el token de su dispositivo');
    const tokenA = tok('A');
    const { error: e1 } = await register(cA, tokenA);
    check(e1, null, 'Test 1a: register_push_token funciona');
    const { data: rowsA } = await cA.from('push_tokens').select('token, platform, locale, time_zone, enabled');
    check(rowsA, [{ token: tokenA, platform: 'ios', locale: 'es', time_zone: 'Europe/Madrid', enabled: true }], 'Test 1b: ve su token con los datos guardados');
    const { error: e1c } = await register(cA, tokenA);
    const { data: rowsA2 } = await cA.from('push_tokens').select('id');
    check([e1c, rowsA2.length], [null, 1], 'Test 1c: registrar otra vez el mismo token no lo duplica');

    // ---- Test 2: datos inválidos ----
    console.log('\nTest 2: la RPC valida lo que recibe');
    checkError((await register(cA, 'token-falso')).error, /invalid_push_token/, 'Test 2a: token sin formato de Expo');
    checkError((await register(cA, tok('x'), 'windows')).error, /invalid_platform/, 'Test 2b: plataforma no válida');
    checkError((await register(cA, tok('x'), 'ios', 'fr')).error, /invalid_locale/, 'Test 2c: idioma no válido');
    checkError((await register(cA, tok('x'), 'ios', 'es', 'Marte/Olympus')).error, /invalid_time_zone/, 'Test 2d: zona horaria no válida');

    // ---- Test 3: sin escritura directa ----
    console.log('\nTest 3: ningún cliente escribe directamente en las tablas');
    checkError((await cA.from('push_tokens').insert({ user_id: A.userId, token: tok('directo'), platform: 'ios' })).error,
      /permission denied/, 'Test 3a: INSERT directo en push_tokens');
    checkError((await cA.from('push_tokens').update({ locale: 'en' }).eq('token', tokenA)).error,
      /permission denied/, 'Test 3b: UPDATE directo en push_tokens');
    checkError((await cA.from('notification_log').select('id')).error, /permission denied/, 'Test 3c: leer notification_log');
    checkError((await cA.from('push_deliveries').select('id')).error, /permission denied/, 'Test 3d: leer push_deliveries');

    // ---- Test 4: aislamiento entre usuarios ----
    console.log('\nTest 4: cada usuario solo ve sus tokens');
    const { data: bSeesA } = await cB.from('push_tokens').select('id').eq('token', tokenA);
    check(bSeesA.length, 0, 'Test 4: B no ve el token de A');

    // ---- Test 5: cambio de cuenta en el mismo dispositivo ----
    console.log('\nTest 5: si en el mismo dispositivo entra otra cuenta, el token pasa a ella');
    const { error: e5 } = await register(cB, tokenA, 'ios', 'en');
    check(e5, null, 'Test 5a: B registra el mismo token');
    const { data: bNow } = await cB.from('push_tokens').select('locale').eq('token', tokenA);
    const { data: aNow } = await cA.from('push_tokens').select('id').eq('token', tokenA);
    check([bNow.length, bNow[0]?.locale, aNow.length], [1, 'en', 0], 'Test 5b: ahora es de B (en inglés) y A ya no lo ve');

    // ---- Test 6: baja del token ----
    console.log('\nTest 6: solo el dueño da de baja su token');
    check((await cA.rpc('unregister_push_token', { p_token: tokenA })).data, false, 'Test 6a: A no puede dar de baja el token de B');
    check((await cB.rpc('unregister_push_token', { p_token: tokenA })).data, true, 'Test 6b: B sí');
    const { data: bAfter } = await cB.from('push_tokens').select('id').eq('token', tokenA);
    check(bAfter.length, 0, 'Test 6c: el token ya no existe');

    // ---- Test 7: sin sesión ----
    console.log('\nTest 7: sin sesión no se registra ni se lee nada');
    checkError((await register(anon, tok('anon'))).error, /permission denied/, 'Test 7a: anon no ejecuta register_push_token');
    checkError((await anon.from('push_tokens').select('id')).error, /permission denied/, 'Test 7b: anon no lee push_tokens');

    // ---- Test 8: borrar la cuenta borra sus tokens ----
    console.log('\nTest 8: al borrar el usuario de Auth se borran sus tokens (ON DELETE CASCADE)');
    const C = await bareUser();
    const tokenC = tok('C');
    await register(C.client, tokenC);
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(C.userId);
    if (delErr) throw delErr;
    const { count: cLeft } = await supabaseAdmin.from('push_tokens').select('id', { count: 'exact', head: true }).eq('token', tokenC);
    check(cLeft, 0, 'Test 8: no queda el token del usuario borrado');

    // ---- Test 9: tope de 10 dispositivos activos ----
    console.log('\nTest 9: máximo 10 dispositivos activos por usuario');
    const D = await bareUser();
    for (let i = 0; i < 10; i++) {
      const { error } = await register(D.client, tok(`D${i}`));
      if (error) throw new Error(`alta ${i} de D: ${error.message}`);
    }
    checkError((await register(D.client, tok('D10'))).error, /too_many_push_tokens/, 'Test 9: el 11.º dispositivo se rechaza');

    // ---- Test 10: deduplicación de notification_log (Service Role, como la Edge Function) ----
    console.log('\nTest 10: notification_log no admite avisos duplicados');
    const { data: habit, error: hErr } = await supabaseAdmin.from('habits')
      .insert({ title: `${TEST_PREFIX}HabitPush`, company_id: A.companyId, created_by: A.userId, is_active: true })
      .select('id').single();
    if (hErr) throw hErr;
    const logId = await advanceHabitLog({ habitId: habit.id, userId: A.userId, daysAgo: 0 });
    const ins = (row) => supabaseAdmin.from('notification_log').insert({ title: 't', body: 'b', ...row });
    check((await ins({ type: 'habit_assigned', recipient_id: A.userId, habit_id: habit.id })).error, null, 'Test 10a: primer aviso de asignación');
    checkError((await ins({ type: 'habit_assigned', recipient_id: A.userId, habit_id: habit.id })).error, /notification_log_assigned_uniq/, 'Test 10b: el mismo aviso de asignación otra vez (p. ej. tras editar el hábito)');
    check((await ins({ type: 'validation_result', recipient_id: A.userId, log_id: logId })).error, null, 'Test 10c: primer resumen de validación del log');
    checkError((await ins({ type: 'validation_result', recipient_id: A.userId, log_id: logId })).error, /notification_log_result_uniq/, 'Test 10d: un segundo resumen para el mismo log');
    check((await ins({ type: 'daily_reminder', recipient_id: A.userId, local_date: '2026-09-30' })).error, null, 'Test 10e: recordatorio del día');
    checkError((await ins({ type: 'daily_reminder', recipient_id: A.userId, local_date: '2026-09-30' })).error, /notification_log_reminder_uniq/, 'Test 10f: segundo recordatorio el mismo día local');
    checkError((await ins({ type: 'daily_reminder', recipient_id: A.userId })).error, /notification_log_shape/, 'Test 10g: recordatorio sin fecha local');
  } finally {
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
