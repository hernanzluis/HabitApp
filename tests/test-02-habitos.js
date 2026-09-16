// Fase 2: hábitos, asignación y validadores — centrado en probar el
// comportamiento REAL de las políticas RLS (habits/habit_assignments/
// habit_validators), no lo que parece razonable que debería hacer.
// Ejecutar con: node tests/test-02-habitos.js

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  getClientForUser,
  cleanupTestData,
  assertEqual,
  assertRejected,
} = require('./test-helpers');

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}
function checkRejected(error, message) {
  const pass = assertRejected(error, message);
  results.push({ pass, message });
}

async function run() {
  console.log('== Fase 2: hábitos, asignación, validadores ==\n');

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    // ---- Setup: dos empresas, para poder probar aislamiento cross-tenant ----
    console.log('Setup: creando adminA (Company A), memberA (miembro de A) y adminB (Company B)');
    const adminA = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyA-${Date.now()}`);
    const adminB = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyB-${Date.now()}`);

    const memberAEmail = `${TEST_PREFIX}${Date.now()}-memberA@habitapp-test.local`;
    const codeA = Math.floor(100000 + Math.random() * 900000).toString();
    const { error: codeErr } = await supabaseAdmin.from('activation_codes').insert({
      code: codeA,
      full_name: `${TEST_PREFIX}MemberA`,
      email: memberAEmail,
      company_id: adminA.companyId,
    });
    if (codeErr) throw codeErr;
    const memberA = await joinAsTestMember(codeA);

    const clientAdminA = await getClientForUser(adminA.email, adminA.password);
    const clientMemberA = await getClientForUser(memberA.email, memberA.password);
    const clientAdminB = await getClientForUser(adminB.email, adminB.password);
    console.log('Setup OK\n');

    // ---- Test 1: el admin crea un hábito ----
    console.log('Test 1: el admin crea un hábito en su propia empresa');
    const { data: habit1, error: habit1Err } = await clientAdminA
      .from('habits')
      .insert({
        title: `${TEST_PREFIX}Habit1`,
        company_id: adminA.companyId,
        created_by: adminA.userId,
        is_active: true, // sin default en la columna: si se omite queda NULL
      })
      .select('id, company_id, created_by, is_active, recurrence')
      .single();
    if (habit1Err) throw habit1Err;

    check(habit1.company_id, adminA.companyId, 'Test 1: el hábito queda en la company del admin');
    check(habit1.is_active, true, 'Test 1: is_active queda en true (no NULL)');
    check(habit1.recurrence, 'daily', 'Test 1: recurrence tiene el default "daily"');

    // ---- Test 2: un miembro normal NO puede crear un hábito directamente ----
    console.log('\nTest 2: un miembro normal no puede crear un hábito (solo admin)');
    const { error: memberHabitErr } = await clientMemberA.from('habits').insert({
      title: `${TEST_PREFIX}HabitByMember`,
      company_id: memberA.companyId,
      created_by: memberA.userId,
      is_active: true,
    });
    checkRejected(memberHabitErr, 'Test 2: INSERT en habits por un no-admin es rechazado por RLS');

    // Segundo hábito, creado por el admin, para los tests de asignación/validador
    // (necesario porque el test 2 confirma que el miembro no puede crear el suyo propio).
    const { data: habit2, error: habit2Err } = await clientAdminA
      .from('habits')
      .insert({
        title: `${TEST_PREFIX}Habit2`,
        company_id: adminA.companyId,
        created_by: adminA.userId,
        is_active: true,
      })
      .select('id')
      .single();
    if (habit2Err) throw habit2Err;

    // ---- Test 3: el admin asigna al miembro a un hábito ----
    console.log('\nTest 3: el admin asigna al miembro al hábito 1');
    const { error: assignByAdminErr } = await clientAdminA
      .from('habit_assignments')
      .insert({ habit_id: habit1.id, user_id: memberA.userId });
    if (assignByAdminErr) throw assignByAdminErr;

    const { count: assignCount1, error: assignCount1Err } = await supabaseAdmin
      .from('habit_assignments').select('id', { count: 'exact', head: true })
      .eq('habit_id', habit1.id).eq('user_id', memberA.userId);
    if (assignCount1Err) throw assignCount1Err;
    check(assignCount1, 1, 'Test 3: existe la fila habit_assignments (admin -> miembro, hábito 1)');

    // ---- Test 4: HALLAZGO — un miembro normal SÍ puede auto-asignarse ----
    // La policy real de habit_assignments INSERT es "cualquier autenticado,
    // con tal de que el hábito sea de su propia empresa" — no exige ser admin.
    // Es intencional (documentado en database.md), pero contraintuitivo: uno
    // esperaría que solo el admin gestionase asignaciones.
    console.log('\nTest 4: un miembro normal SÍ puede auto-asignarse a un hábito (policy real, no es un bug)');
    const { error: selfAssignErr } = await clientMemberA
      .from('habit_assignments')
      .insert({ habit_id: habit2.id, user_id: memberA.userId });
    if (selfAssignErr) throw selfAssignErr;

    const { count: assignCount2, error: assignCount2Err } = await supabaseAdmin
      .from('habit_assignments').select('id', { count: 'exact', head: true })
      .eq('habit_id', habit2.id).eq('user_id', memberA.userId);
    if (assignCount2Err) throw assignCount2Err;
    check(assignCount2, 1, 'Test 4: el miembro pudo auto-asignarse al hábito 2 (INSERT no exige is_admin())');

    // ---- Test 5: el admin añade al miembro como validador ----
    console.log('\nTest 5: el admin añade al miembro como validador del hábito 2');
    const { error: validatorByAdminErr } = await clientAdminA
      .from('habit_validators')
      .insert({ habit_id: habit2.id, user_id: memberA.userId });
    if (validatorByAdminErr) throw validatorByAdminErr;

    const { count: validatorCount1, error: validatorCount1Err } = await supabaseAdmin
      .from('habit_validators').select('id', { count: 'exact', head: true })
      .eq('habit_id', habit2.id).eq('user_id', memberA.userId);
    if (validatorCount1Err) throw validatorCount1Err;
    check(validatorCount1, 1, 'Test 5: existe la fila habit_validators (admin -> miembro, hábito 2)');

    // ---- Test 6: un miembro normal NO puede añadirse como validador ----
    console.log('\nTest 6: un miembro normal no puede añadirse a sí mismo como validador (solo admin)');
    const { error: selfValidatorErr } = await clientMemberA
      .from('habit_validators')
      .insert({ habit_id: habit1.id, user_id: memberA.userId });
    checkRejected(selfValidatorErr, 'Test 6: INSERT en habit_validators por un no-admin es rechazado por RLS');

    // ---- Test 7: aislamiento cross-empresa ----
    console.log('\nTest 7: un admin de OTRA empresa no puede asignar gente a un hábito ajeno');
    const { error: crossTenantErr } = await clientAdminB
      .from('habit_assignments')
      .insert({ habit_id: habit1.id, user_id: adminB.userId });
    checkRejected(crossTenantErr, 'Test 7: INSERT en habit_assignments sobre un hábito de OTRA empresa es rechazado por RLS');

    // ---- Test 8: HALLAZGO — nada impide ser asignado Y validador del mismo hábito ----
    // AdminScreen.js hace estos dos roles mutuamente excluyentes solo en el
    // cliente (checkboxes que se desmarcan entre sí) — no hay ninguna
    // constraint ni policy en la base de datos que lo impida. El miembro ya
    // quedó asignado (test 4) Y validador (test 5) del hábito 2 sin que nada
    // lo bloquee; este test lo deja explícito en vez de dejarlo como efecto
    // colateral de los tests anteriores.
    console.log('\nTest 8: nada en la BD impide ser asignado y validador del mismo hábito a la vez');
    const { count: bothCount, error: bothErr } = await supabaseAdmin
      .from('habit_assignments').select('id', { count: 'exact', head: true })
      .eq('habit_id', habit2.id).eq('user_id', memberA.userId);
    if (bothErr) throw bothErr;
    check(bothCount, 1, 'Test 8: el miembro sigue asignado al hábito 2 (de test 4) Y es validador (de test 5) — sin conflicto en la BD');
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
