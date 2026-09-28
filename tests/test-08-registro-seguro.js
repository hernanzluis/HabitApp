// Fase 8: registro seguro — handle_new_user_registration y
// handle_activation_registration tras sql/2026-09-28_registro_seguro.sql.
// Ejecutar con: node tests/test-08-registro-seguro.js
//
// Antes de ese SQL, las dos RPCs eran SECURITY DEFINER, ejecutables por anon
// y sin comprobar auth.uid(): cualquiera con la anon key (pública) podía
// crear perfiles para otro user_id, con otro email, y probar códigos de
// activación sin límite de intentos (el rate limiting vivía solo en
// check_activation_code). Ver tests/README.md, hallazgo de la Fase 8.

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TEST_PREFIX,
  supabaseAdmin,
  testEmail,
  randomPassword,
  getAnonClient,
  getClientForUser,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  resetActivationRateLimit,
  cleanupTestData,
  assertEqual,
  assertRejected,
} = require('./test-helpers');

const LOCK_MSG = /bloqueado temporalmente/;

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}
// Además de que haya error, exige el motivo concreto: un rechazo por otra
// causa (p. ej. un profile duplicado) no demuestra que la comprobación exista.
function checkRejected(error, message, pattern) {
  let pass;
  if (error && pattern && !pattern.test(error.message)) {
    console.error(`  ✗ ${message}`);
    console.error(`      rechazado, pero por otro motivo: "${error.message}" (se esperaba ${pattern})`);
    pass = false;
  } else {
    pass = assertRejected(error, message);
  }
  results.push({ pass, message });
}

// auth.user sin profile, con cliente ya autenticado como él.
async function createBareUser(email = testEmail()) {
  const password = randomPassword();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = await getClientForUser(email, password);
  return { userId: data.user.id, email, password, client };
}

async function insertCode(companyId, email, extra = {}) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const { error } = await supabaseAdmin.from('activation_codes').insert({
    code, email, full_name: `${TEST_PREFIX}Invitado`, company_id: companyId, ...extra,
  });
  if (error) throw error;
  return code;
}

async function readCode(code) {
  const { data, error } = await supabaseAdmin
    .from('activation_codes').select('used, failed_attempts, locked_until').eq('code', code).single();
  if (error) throw error;
  return data;
}

async function profileExists(userId) {
  const { data, error } = await supabaseAdmin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function countAttempts() {
  const { count, error } = await supabaseAdmin
    .from('activation_attempts').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

function activate(client, { userId, email, code }) {
  return client.rpc('handle_activation_registration', {
    user_id: userId, user_email: email, user_full_name: `${TEST_PREFIX}Invitado`, activation_code: code,
  });
}

function registerAdmin(client, { userId, email, companyName }) {
  return client.rpc('handle_new_user_registration', {
    user_id: userId, user_email: email, user_full_name: `${TEST_PREFIX}Admin`, company_name: companyName,
  });
}

async function run() {
  console.log('== Fase 8: registro seguro ==\n');
  console.log('Limpieza previa...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    // ---- Test 0: guarda de configuración ----
    console.log('Test 0 [GUARDA]: la confirmación de email está desactivada (mailer_autoconfirm)');
    const settings = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } }).then((r) => r.json());
    check(settings.mailer_autoconfirm, true,
      'Test 0: mailer_autoconfirm = true — si alguien reactiva "Confirm email", signUp deja de devolver sesión y todas las altas de la app fallan con not_authenticated');

    // ---- Test 1: camino real de la app ----
    console.log('\nTest 1: signUp real con la anon key + RPC con esa sesión (lo que hace SignUpScreen.onSignUp)');
    const anonSignup = getAnonClient();
    const adminEmail = testEmail();
    const { data: signUpData, error: signUpErr } = await anonSignup.auth.signUp({ email: adminEmail, password: randomPassword() });
    if (signUpErr) throw signUpErr;
    check(!!signUpData.session, true, 'Test 1a: auth.signUp devuelve sesión');
    const adminId = signUpData.user.id;
    const companyName = `${TEST_PREFIX}Company-${Date.now()}`;
    const { error: regErr } = await registerAdmin(anonSignup, { userId: adminId, email: adminEmail, companyName });
    check(regErr, null, 'Test 1b: handle_new_user_registration con la sesión del propio usuario funciona');
    const { data: adminProfile } = await supabaseAdmin.from('profiles').select('role, email, company_id').eq('id', adminId).single();
    check(adminProfile.role, 'admin', 'Test 1c: profile creado con role="admin"');
    check(adminProfile.email, adminEmail, 'Test 1d: profile.email es el de auth.users');
    const companyId = adminProfile.company_id;

    // ---- Test 2: sin sesión ----
    console.log('\nTest 2: llamadas sin sesión (anon) rechazadas');
    const anon = getAnonClient();
    const orphan = await createBareUser();
    const anonCompany = `${TEST_PREFIX}AnonCompany-${Date.now()}`;
    const { error: anonRegErr } = await registerAdmin(anon, { userId: orphan.userId, email: orphan.email, companyName: anonCompany });
    checkRejected(anonRegErr, 'Test 2a: anon no puede ejecutar handle_new_user_registration', /permission denied/);
    const { count: anonCompanies } = await supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }).eq('name', anonCompany);
    check(anonCompanies, 0, 'Test 2b: no se ha creado ninguna company');
    const orphanCode = await insertCode(companyId, orphan.email);
    const { error: anonActErr } = await activate(anon, { userId: orphan.userId, email: orphan.email, code: orphanCode });
    checkRejected(anonActErr, 'Test 2c: anon no puede ejecutar handle_activation_registration', /permission denied/);
    check((await readCode(orphanCode)).used, false, 'Test 2d: el código sigue sin usar');

    // ---- Test 3: user_id ajeno ----
    console.log('\nTest 3: un usuario autenticado no puede registrar a OTRO user_id');
    const userA = await createBareUser();
    const userB = await createBareUser();
    const { error: crossRegErr } = await registerAdmin(userA.client, { userId: userB.userId, email: userB.email, companyName: `${TEST_PREFIX}Cross-${Date.now()}` });
    checkRejected(crossRegErr, 'Test 3a: A llamando handle_new_user_registration con el user_id de B', /user_id_mismatch/);
    const codeForB = await insertCode(companyId, userB.email);
    const { error: crossActErr } = await activate(userA.client, { userId: userB.userId, email: userB.email, code: codeForB });
    checkRejected(crossActErr, 'Test 3b: A llamando handle_activation_registration con el user_id de B', /user_id_mismatch/);
    check(await profileExists(userB.userId), false, 'Test 3c: B sigue sin profile');
    check((await readCode(codeForB)).used, false, 'Test 3d: el código de B sigue sin usar');

    // ---- Test 4: email distinto del autenticado ----
    console.log('\nTest 4: email distinto del de auth.users rechazado');
    const userC = await createBareUser();
    const fakeEmail = testEmail();
    const { error: mailRegErr } = await registerAdmin(userC.client, { userId: userC.userId, email: fakeEmail, companyName: `${TEST_PREFIX}Mail-${Date.now()}` });
    checkRejected(mailRegErr, 'Test 4a: handle_new_user_registration con user_email ajeno', /email_mismatch/);
    const codeForFake = await insertCode(companyId, fakeEmail);
    const { error: mailActErr } = await activate(userC.client, { userId: userC.userId, email: fakeEmail, code: codeForFake });
    checkRejected(mailActErr, 'Test 4b: handle_activation_registration con user_email ajeno (el del código)', /email_mismatch/);
    check(await profileExists(userC.userId), false, 'Test 4c: C sigue sin profile');
    await resetActivationRateLimit();
    const { data: wrongOwner } = await activate(userC.client, { userId: userC.userId, email: userC.email, code: codeForFake });
    check(wrongOwner, 'invalid_code', 'Test 4d: C, con su email real, tampoco puede canjear un código emitido para otro email');
    const afterWrongOwner = await readCode(codeForFake);
    check([afterWrongOwner.used, afterWrongOwner.failed_attempts], [false, 0],
      'Test 4e: ese código sigue sin usar y sin fallos acumulados (un email incorrecto no permite bloquear el código de otro)');

    // ---- Test 5: profile ya existente ----
    console.log('\nTest 5: segunda llamada con un profile ya existente rechazada');
    const { error: dupErr } = await registerAdmin(anonSignup, { userId: adminId, email: adminEmail, companyName: `${TEST_PREFIX}Dup-${Date.now()}` });
    checkRejected(dupErr, 'Test 5a: handle_new_user_registration por segunda vez', /profile_already_exists/);
    const { count: adminCompanies } = await supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }).eq('admin_id', adminId);
    check(adminCompanies, 1, 'Test 5b: sigue habiendo una sola company con ese admin');

    // ---- Test 6: validación de company_name ----
    console.log('\nTest 6: company_name vacío o demasiado largo rechazado');
    const userD = await createBareUser();
    const { error: blankErr } = await registerAdmin(userD.client, { userId: userD.userId, email: userD.email, companyName: '   ' });
    checkRejected(blankErr, 'Test 6a: company_name en blanco', /invalid_company_name/);
    const { error: longErr } = await registerAdmin(userD.client, { userId: userD.userId, email: userD.email, companyName: `${TEST_PREFIX}${'x'.repeat(100)}` });
    checkRejected(longErr, 'Test 6b: company_name de más de 100 caracteres', /invalid_company_name/);

    // ---- Test 7: marcado atómico y reutilización ----
    console.log('\nTest 7: el código se marca usado dentro de la RPC y no se puede reutilizar');
    await resetActivationRateLimit();
    const memberEmail = testEmail();
    const memberCode = await insertCode(companyId, memberEmail);
    const member = await joinAsTestMember(memberCode);
    check((await readCode(memberCode)).used, true, 'Test 7a: tras la activación, used = true sin ningún UPDATE del cliente');
    const memberClient = await getClientForUser(member.email, member.password);
    const { error: delErr } = await memberClient.rpc('delete_own_account');
    if (delErr) throw delErr;
    // Mismo email (lo único que el código acepta) con una cuenta nueva.
    const reuser = await createBareUser(memberEmail);
    const { data: reuseResult, error: reuseErr } = await activate(reuser.client, { userId: reuser.userId, email: memberEmail, code: memberCode });
    check([reuseResult, reuseErr], ['invalid_code', null], 'Test 7b: reutilizar un código ya usado devuelve invalid_code');
    check(await profileExists(reuser.userId), false, 'Test 7c: no se crea profile');

    // ---- Test 8: rate limiting en llamadas directas ----
    console.log('\nTest 8: las llamadas fallidas directas a handle_activation_registration cuentan para el rate limiting');
    await resetActivationRateLimit();
    const userE = await createBareUser();
    const invented = [];
    for (let i = 0; i < 5; i++) {
      const { data, error } = await activate(userE.client, { userId: userE.userId, email: userE.email, code: `zzbad${i}` });
      invented.push(error ? `error: ${error.message}` : data);
    }
    check(invented, Array(5).fill('invalid_code'), 'Test 8a: 5 códigos inventados → invalid_code (sin excepción, para que el intento quede guardado)');
    check(await countAttempts(), 5, 'Test 8b: los 5 intentos fallidos están en activation_attempts');
    const { error: sixthErr } = await activate(userE.client, { userId: userE.userId, email: userE.email, code: 'zzbad5' });
    checkRejected(sixthErr, 'Test 8c: el 6º intento desde la misma IP se bloquea', LOCK_MSG);
    check(await countAttempts(), 5, 'Test 8d: las llamadas bloqueadas no alargan la ventana (no insertan)');
    const validForE = await insertCode(companyId, userE.email);
    const { data: validAfterBlock, error: validAfterBlockErr } = await activate(userE.client, { userId: userE.userId, email: userE.email, code: validForE });
    check([validAfterBlock, validAfterBlockErr], ['ok', null],
      'Test 8e: con la IP bloqueada, un código VÁLIDO emitido para tu propio email sí se canjea (el cupo de IP solo frena fallos)');

    await resetActivationRateLimit();
    const userF = await createBareUser();
    const deadCode = await insertCode(companyId, userF.email, { used: true });
    for (let i = 0; i < 5; i++) {
      await activate(userF.client, { userId: userF.userId, email: userF.email, code: deadCode });
    }
    const deadState = await readCode(deadCode);
    check(deadState.failed_attempts, 5, 'Test 8f: capa por código — 5 intentos sobre un código usado suman failed_attempts = 5');
    check(!!deadState.locked_until && new Date(deadState.locked_until) > new Date(), true, 'Test 8g: y el código queda con locked_until en el futuro');
    await resetActivationRateLimit();
    const { error: codeLockErr } = await activate(userF.client, { userId: userF.userId, email: userF.email, code: deadCode });
    checkRejected(codeLockErr, 'Test 8h: aun con la IP limpia, el código bloqueado rechaza el intento', LOCK_MSG);

    await resetActivationRateLimit();
    const happyEmail = testEmail();
    await joinAsTestMember(await insertCode(companyId, happyEmail));
    check(await countAttempts(), 1, 'Test 8i: una activación legítima solo gasta el intento de check_activation_code, no uno más en handle_activation_registration');

    // Regresión encontrada por la Fase 5: check_activation_code registra TODAS
    // sus llamadas; tras 4 fallos y un acierto en el paso 1 la IP llega a 5, y
    // el paso 2 no debe bloquear al usuario legítimo (ya tiene su auth.user).
    await resetActivationRateLimit();
    const typoEmail = testEmail();
    const typoCode = await insertCode(companyId, typoEmail);
    for (let i = 0; i < 4; i++) {
      await supabaseAdmin.rpc('check_activation_code', { p_code: `zztypo${i}` });
    }
    const { data: step1 } = await supabaseAdmin.rpc('check_activation_code', { p_code: typoCode });
    check([step1?.length, await countAttempts()], [1, 5], 'Test 8j: 4 errores + 1 acierto en check_activation_code → paso 1 superado, la IP queda en 5');
    const typoUser = await createBareUser(typoEmail);
    const { data: step2, error: step2Err } = await activate(typoUser.client, { userId: typoUser.userId, email: typoEmail, code: typoCode });
    check([step2, step2Err], ['ok', null], 'Test 8k: el paso 2 (handle_activation_registration) no bloquea a ese usuario legítimo');

    // ---- Test 9: email del código sin distinguir mayúsculas ni espacios ----
    console.log('\nTest 9: el email del código se compara sin mayúsculas ni espacios en los extremos');
    await resetActivationRateLimit();
    const userG = await createBareUser();
    const sloppyCode = await insertCode(companyId, `  ${userG.email.toUpperCase()}  `);
    const { data: sloppyResult, error: sloppyErr } = await activate(userG.client, { userId: userG.userId, email: userG.email, code: sloppyCode });
    check([sloppyResult, sloppyErr], ['ok', null], 'Test 9: un código emitido como "  EMAIL  " lo canjea el usuario con "email"');

    // ---- Test 10: gestión de códigos pendientes tras borrar la policy UPDATE no-admin ----
    console.log('\nTest 10: el admin sigue pudiendo editar y cancelar códigos pendientes; un miembro no puede tocarlos');
    const adminClient = anonSignup; // sesión del admin del test 1
    const pendingEmail = testEmail();
    const pendingCode = await insertCode(companyId, pendingEmail);
    const { data: pendingRow } = await supabaseAdmin.from('activation_codes').select('id').eq('code', pendingCode).single();
    const memberG = userG.client; // miembro de esa misma company desde el test 9
    const { data: memberUpd } = await memberG.from('activation_codes').update({ used: true }).eq('id', pendingRow.id).select('id');
    check(memberUpd?.length ?? 0, 0, 'Test 10a: un miembro normal no puede marcar como usado un código pendiente de su grupo (0 filas)');
    check((await readCode(pendingCode)).used, false, 'Test 10b: el código sigue sin usar');
    const newEmail = testEmail();
    const { data: adminUpd, error: adminUpdErr } = await adminClient.from('activation_codes')
      .update({ full_name: `${TEST_PREFIX}Editado`, email: newEmail }).eq('id', pendingRow.id).select('email');
    check([adminUpdErr, adminUpd?.[0]?.email], [null, newEmail], 'Test 10c: el admin edita nombre y email del código pendiente (AdminScreen.handleSavePending)');
    const { data: adminDel, error: adminDelErr } = await adminClient.from('activation_codes').delete().eq('id', pendingRow.id).select('id');
    check([adminDelErr, adminDel?.length], [null, 1], 'Test 10d: el admin cancela el código (DELETE, AdminScreen y Members.jsx)');
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
