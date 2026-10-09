// Fase 12: regresión de la auditoría del 2026-10-09.
// Ejecutar con: node tests/test-12-regresion-auditoria.js
//
// Cada ataque que se demostró en la auditoría se reproduce aquí y debe
// rechazarse (S1-S4, sql/2026-10-09a..d). Cada bloqueo lleva su control
// positivo: el camino legítimo de la app sigue funcionando.
//
// R1 (límite por IP de check_activation_code esquivable con X-Forwarded-For)
// sigue ABIERTO a la espera de aprobación: el test 5 está marcado
// [CONOCIDO] y comprueba el comportamiento actual; cuando se arregle, fallará
// y habrá que invertirlo (es su propósito). Usa direcciones de documentación
// (203.0.113.x) y borra en el finally solo sus propias filas de intentos.

const {
  TEST_PREFIX,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseAdmin,
  getClientForUser,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  resetActivationRateLimit,
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
async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
async function addMember(admin, label) {
  const email = `${TEST_PREFIX}${Date.now()}-${label}@habitapp-test.local`;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await must(supabaseAdmin.from('activation_codes').insert({ code, email, full_name: `${TEST_PREFIX}${label}`, company_id: admin.companyId }));
  await resetActivationRateLimit();
  const m = await joinAsTestMember(code);
  return { ...m, client: await getClientForUser(m.email, m.password) };
}
const newHabit = (company, creator, title, extra = {}) =>
  must(supabaseAdmin.from('habits').insert({ title: `${TEST_PREFIX}${title}`, company_id: company, created_by: creator, is_active: true, ...extra }).select('id').single());

const DENIED = /permission denied|row-level security/;
const TEST_IPS = ['203.0.113.10', '203.0.113.11'];

async function run() {
  console.log('== Fase 12: regresión de la auditoría del 2026-10-09 ==\n');
  console.log('Limpieza previa...');
  await cleanupTestData();
  console.log('OK\n');
  const uploaded = { 'habit-photos': [], avatars: [] };

  try {
    const A = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyAuditA-${Date.now()}`);
    const cA = await getClientForUser(A.email, A.password);
    const author = await addMember(A, 'Autor');
    const validator = await addMember(A, 'Validador');
    const other = await addMember(A, 'Otro');
    const B = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyAuditB-${Date.now()}`);

    const habit = await newHabit(A.companyId, A.userId, 'Asignado');
    const habit2 = await newHabit(A.companyId, A.userId, 'OtroHabito');
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habit.id, user_id: author.userId }));
    await must(supabaseAdmin.from('habit_validators').insert({ habit_id: habit.id, user_id: validator.userId }));
    const log = await must(author.client.from('habit_logs').insert({ habit_id: habit.id, user_id: author.userId, status: 'pending' }).select('id, created_at').single());
    const logNow = async () => must(supabaseAdmin.from('habit_logs').select('status, created_at, photo_url, habit_id, user_id, notes').eq('id', log.id).single());
    const before = await logNow();

    // ---- Test 1 (S1): nadie modifica habit_logs desde un cliente ----
    console.log('Test 1 (S1): el autor y los validadores no pueden reescribir logs');
    checkError((await author.client.from('habit_logs').update({ status: 'validated' }).eq('id', log.id)).error, DENIED, 'Test 1a: el autor no puede autovalidar su log');
    checkError((await author.client.from('habit_logs').update({ created_at: '2026-01-01T12:00:00Z' }).eq('id', log.id)).error, DENIED, 'Test 1b: el autor no puede retrofechar su log');
    checkError((await author.client.from('habit_logs').update({ photo_url: 'https://example.com/x.jpg' }).eq('id', log.id)).error, DENIED, 'Test 1c: el autor no puede poner una foto externa');
    checkError((await author.client.from('habit_logs').update({ habit_id: habit2.id }).eq('id', log.id)).error, DENIED, 'Test 1d: el autor no puede mover su log a otro hábito');
    checkError((await validator.client.from('habit_logs').update({ status: 'rejected', notes: 'x' }).eq('id', log.id)).error, DENIED, 'Test 1e: un validador no puede cambiar el estado ni las notas del log ajeno');
    checkError((await validator.client.from('habit_logs').update({ user_id: validator.userId }).eq('id', log.id)).error, DENIED, 'Test 1f: un validador no puede apropiarse del log ajeno');
    checkError((await cA.from('habit_logs').update({ status: 'validated' }).eq('id', log.id)).error, DENIED, 'Test 1g: el admin tampoco lo modifica (la validación va en habit_validations)');
    check(await logNow(), before, 'Test 1h: control — el log sigue exactamente igual en BD');
    const vote = await validator.client.from('habit_validations').insert({ habit_log_id: log.id, validator_id: validator.userId, status: 'validated' });
    check(vote.error, null, 'Test 1i: control — el validador sigue votando (habit_validations)');

    // ---- Test 2 (S2): solo el admin asigna, y solo a miembros de su empresa ----
    console.log('\nTest 2 (S2): asignaciones solo por el admin y de su propia empresa');
    checkError((await other.client.from('habit_assignments').insert({ habit_id: habit2.id, user_id: other.userId })).error, DENIED, 'Test 2a: un miembro no puede auto-asignarse');
    checkError((await other.client.from('habit_assignments').insert({ habit_id: habit2.id, user_id: validator.userId })).error, DENIED, 'Test 2b: un miembro no puede asignar a otro (evita avisos push indebidos)');
    checkError((await cA.from('habit_assignments').insert({ habit_id: habit2.id, user_id: B.userId })).error, DENIED, 'Test 2c: ni el admin puede asignar a un usuario de otra empresa');
    const okAssign = await cA.from('habit_assignments').insert({ habit_id: habit2.id, user_id: other.userId });
    check(okAssign.error, null, 'Test 2d: control — el admin asigna a un miembro de su empresa');
    const okSelf = await cA.from('habit_assignments').insert({ habit_id: habit2.id, user_id: A.userId });
    check(okSelf.error, null, 'Test 2e: control — el admin puede asignarse un hábito a sí mismo');

    // ---- Test 3 (S3): solo logs de hábitos asignados al propio usuario ----
    console.log('\nTest 3 (S3): logs solo de hábitos asignados');
    checkError((await validator.client.from('habit_logs').insert({ habit_id: habit.id, user_id: validator.userId, status: 'pending' })).error, DENIED, 'Test 3a: un miembro no registra logs de un hábito que no tiene asignado');
    checkError((await other.client.from('habit_logs').insert({ habit_id: habit.id, user_id: author.userId, status: 'pending' })).error, DENIED, 'Test 3b: nadie registra un log a nombre de otro');
    const habitB = await newHabit(B.companyId, B.userId, 'HabitoB');
    checkError((await author.client.from('habit_logs').insert({ habit_id: habitB.id, user_id: author.userId, status: 'pending' })).error, DENIED, 'Test 3c: ni de un hábito de otra empresa');
    const okOther = await other.client.from('habit_logs').insert({ habit_id: habit2.id, user_id: other.userId, status: 'pending' });
    check(okOther.error, null, 'Test 3d: control — un miembro completa un hábito que tiene asignado');
    const okAdmin = await cA.from('habit_logs').insert({ habit_id: habit2.id, user_id: A.userId, status: 'pending' });
    check(okAdmin.error, null, 'Test 3e: control — el admin completa un hábito que se asignó a sí mismo');
    const once = await newHabit(A.companyId, A.userId, 'UnaVez', { recurrence: 'once' });
    await must(cA.from('habit_assignments').insert({ habit_id: once.id, user_id: author.userId }));
    const okOnce = await author.client.from('habit_logs').insert({ habit_id: once.id, user_id: author.userId, status: 'pending' });
    check(okOnce.error, null, 'Test 3f: control — un hábito de tipo "una vez" asignado se completa');

    // ---- Test 4 (S4): límites de tamaño y de tipo en Storage ----
    console.log('\nTest 4 (S4): límites de tamaño y tipo en los buckets');
    const up = async (client, bucket, path, buf, contentType) => {
      const r = await client.storage.from(bucket).upload(path, buf, { contentType, upsert: true });
      if (!r.error) uploaded[bucket].push(path);
      return r;
    };
    checkError((await up(author.client, 'habit-photos', `${author.userId}/${habit.id}/grande.jpg`, Buffer.alloc(11 * 1024 * 1024, 1), 'image/jpeg')).error,
      /maximum allowed size|too large|exceeded/i, 'Test 4a: una foto de 11 MB se rechaza (límite 10 MB)');
    checkError((await up(author.client, 'habit-photos', `${author.userId}/${habit.id}/pagina.html`, Buffer.from('<html>zztest</html>'), 'text/html')).error,
      /mime type|not supported|invalid/i, 'Test 4b: un fichero text/html se rechaza');
    checkError((await up(author.client, 'avatars', `${author.userId}/avatar.jpg`, Buffer.alloc(6 * 1024 * 1024, 1), 'image/jpeg')).error,
      /maximum allowed size|too large|exceeded/i, 'Test 4c: un avatar de 6 MB se rechaza (límite 5 MB)');
    const okPhoto = await up(author.client, 'habit-photos', `${author.userId}/${habit.id}/ok.jpg`, Buffer.alloc(500 * 1024, 1), 'image/jpeg');
    check(okPhoto.error, null, 'Test 4d: control — una foto jpeg de 500 kB (como las reales) se sube');
    const okAvatar = await up(author.client, 'avatars', `${author.userId}/avatar.jpg`, Buffer.alloc(200 * 1024, 1), 'image/jpeg');
    check(okAvatar.error, null, 'Test 4e: control — un avatar jpeg de 200 kB se sube');

    // ---- Test 5 [CONOCIDO] (R1): el límite por IP se separa por X-Forwarded-For ----
    console.log('\nTest 5 [CONOCIDO] (R1): el límite por IP de check_activation_code depende de X-Forwarded-For');
    const tryCode = async (xff) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_activation_code`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
        body: JSON.stringify({ p_code: '987650' }),
      });
      return res.status;
    };
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push(await tryCode(TEST_IPS[0]));
    check(statuses, [200, 200, 200, 200, 200, 400], 'Test 5a: control — con la misma cabecera, el 6.º intento se bloquea');
    check(await tryCode(TEST_IPS[1]), 200, 'Test 5b [CONOCIDO]: cambiando la cabecera se vuelve a intentar (pendiente de arreglo; invertir cuando se aplique)');
  } finally {
    console.log('\nLimpieza final...');
    for (const [bucket, paths] of Object.entries(uploaded)) {
      if (paths.length) await supabaseAdmin.storage.from(bucket).remove(paths);
    }
    for (const ip of TEST_IPS) await supabaseAdmin.from('activation_attempts').delete().like('ip_address', `${ip}%`);
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
