// Fase 1: alta de admin, alta de miembro por código de activación, y la
// condición de datos que dispara la redirección a "Familia" para un admin
// recién creado. Ejecutar con: node tests/test-01-alta.js

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}

// Réplica exacta de la condición de DATOS en HomeScreen.js:184-212 que decide
// si se navega a AdminScreen({ initialTab: 'family' }). No incluye la parte de
// AsyncStorage('family_setup_done') porque es estado local de dispositivo, no
// de Supabase — para un usuario de test recién creado (que nunca ha tocado
// ningún dispositivo) ese flag siempre es null, así que no afecta al resultado.
async function adminNeedsFamilySetup(userId) {
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles').select('role, company_id').eq('id', userId).maybeSingle();
  if (profErr) throw profErr;
  if (!prof || prof.role !== 'admin' || !prof.company_id) return false;

  const { count, error: countErr } = await supabaseAdmin
    .from('habits').select('id', { count: 'exact', head: true })
    .eq('company_id', prof.company_id).eq('is_active', true);
  if (countErr) throw countErr;

  return (count ?? 0) === 0;
}

async function run() {
  console.log('== Fase 1: tests de alta ==\n');
  console.log(
    'NOTA: el test de authFlags.skipNextRedirect (test 5 de la fase) queda fuera ' +
    'de este script a propósito — es una condición de carrera de timing en el ' +
    'cliente (React state / onAuthStateChange), no algo verificable consultando ' +
    'datos en Supabase. Necesitaría un test de UI/E2E aparte, no encaja aquí.\n'
  );

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  const companyName = `${TEST_PREFIX}Company-${Date.now()}`;

  try {
    // ---- Test 1: crear admin ----
    console.log('Test 1: crear admin y su company');
    const admin = await createTestCompanyAndAdmin(companyName);

    const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
      .from('profiles').select('role, company_id').eq('id', admin.userId).single();
    if (adminProfileErr) throw adminProfileErr;

    const { data: company, error: companyErr } = await supabaseAdmin
      .from('companies').select('plan').eq('id', admin.companyId).single();
    if (companyErr) throw companyErr;

    check(adminProfile.role, 'admin', 'Test 1: el profile del admin tiene role="admin"');
    check(adminProfile.company_id, admin.companyId, 'Test 1: profile.company_id coincide con la company creada');
    check(company.plan, 'familiar', 'Test 1: la company nueva tiene plan="familiar" por defecto');

    // ---- Test 2: admin recién creado, sin hábitos activos ----
    console.log('\nTest 2: admin recién creado sin hábitos activos dispara "family setup"');
    const needsSetup1 = await adminNeedsFamilySetup(admin.userId);
    check(needsSetup1, true, 'Test 2: role=admin + company_id + 0 hábitos activos => needsFamilySetup=true');

    // ---- Test 3: segundo usuario se une con código de activación ----
    console.log('\nTest 3: generar código de activación y unir un segundo usuario');
    const memberEmail = `${TEST_PREFIX}${Date.now()}-member@habitapp-test.local`;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Mismo patrón que AdminScreen.handleGenerateCode (código de 6 dígitos, INSERT directo).
    const { error: codeInsertErr } = await supabaseAdmin.from('activation_codes').insert({
      code,
      full_name: `${TEST_PREFIX}Member`,
      email: memberEmail,
      company_id: admin.companyId,
    });
    if (codeInsertErr) throw codeInsertErr;

    const member = await joinAsTestMember(code);

    check(member.companyId, admin.companyId, 'Test 3: el segundo usuario queda en la misma company que el admin');

    const { data: memberProfile, error: memberProfileErr } = await supabaseAdmin
      .from('profiles').select('role').eq('id', member.userId).single();
    if (memberProfileErr) throw memberProfileErr;
    check(memberProfile.role, 'usuario', 'Test 3: el segundo usuario tiene role="usuario"');

    // ---- Test 4: qué apaga realmente "needs family setup" ----
    // OJO: la condición real (HomeScreen.js:184-212) depende de hábitos activos,
    // NO del número de miembros. Añadir un segundo miembro no la cambia. Se
    // decidió (opción A, ver conversación) verificar esto explícitamente y
    // luego crear un hábito activo real, que es el disparador de verdad.
    console.log('\nTest 4: qué apaga realmente la condición de "family setup"');

    const needsSetup2 = await adminNeedsFamilySetup(admin.userId);
    check(needsSetup2, true, 'Test 4a: tras añadir un segundo miembro (sin hábitos), needsFamilySetup SIGUE en true');

    const { error: habitInsertErr } = await supabaseAdmin.from('habits').insert({
      title: `${TEST_PREFIX}Habit`,
      company_id: admin.companyId,
      created_by: admin.userId,
      is_active: true, // sin default en la columna: si se omite queda NULL y no cuenta
    });
    if (habitInsertErr) throw habitInsertErr;

    const needsSetup3 = await adminNeedsFamilySetup(admin.userId);
    check(needsSetup3, false, 'Test 4b: tras crear un hábito activo, needsFamilySetup pasa a false');
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
