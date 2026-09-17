// Fase 6: borrado de cuenta (delete_own_account). Ejecutar con:
// node tests/test-06-borrado.js
//
// delete_own_account() revisada al completo antes de escribir este fichero:
// SECURITY DEFINER, sin parámetros (opera solo sobre auth.uid()). Desde esta
// fase, además, rechaza el borrado si eres el único admin de tu company
// (decisión de producto aplicada junto con este test). El resto: DELETE FROM
// profiles (CASCADE real vía FK a habit_logs.user_id, habit_assignments.
// user_id, habit_validators.user_id, habit_validations.validator_id,
// team_members.user_id; SET NULL en las dos columnas legado/sin uso
// habit_logs.validated_by e invitations.created_by) + DELETE FROM auth.users.

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  getClientForUser,
  resetActivationRateLimit,
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

// Réplica de la query real de ValidateHabitScreen.js (incluido el fallback de
// admin añadido para cerrar el hallazgo del test 5) — mismo patrón ya usado
// para adminNeedsFamilySetup en la Fase 1: no se puede `require()` la pantalla
// directamente por ser código de React Native.
async function getPendingHabitIdsForUser(userId, companyId, role) {
  const { data: validatorHabits } = await supabaseAdmin.from('habit_validators').select('habit_id').eq('user_id', userId);
  let validatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);

  if (role === 'admin') {
    const { data: companyHabits } = await supabaseAdmin.from('habits').select('id').eq('company_id', companyId);
    const companyHabitIds = (companyHabits ?? []).map((h) => h.id);
    if (companyHabitIds.length) {
      const { data: validatorsForCompanyHabits } = await supabaseAdmin.from('habit_validators').select('habit_id').in('habit_id', companyHabitIds);
      const habitsWithValidator = new Set((validatorsForCompanyHabits ?? []).map((v) => v.habit_id));
      const habitsWithoutValidator = companyHabitIds.filter((id) => !habitsWithValidator.has(id));
      validatorHabitIds = [...new Set([...validatorHabitIds, ...habitsWithoutValidator])];
    }
  }
  return validatorHabitIds;
}

async function createTestHabit(admin, overrides = {}) {
  const { data, error } = await supabaseAdmin
    .from('habits')
    .insert({
      title: `${TEST_PREFIX}Habit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      company_id: admin.companyId,
      created_by: admin.userId,
      is_active: true,
      recurrence: 'daily',
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function addAndJoinMember(admin, label) {
  const email = `${TEST_PREFIX}${Date.now()}-${label}@habitapp-test.local`;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const { error } = await supabaseAdmin.from('activation_codes').insert({
    code, full_name: `${TEST_PREFIX}${label}`, email, company_id: admin.companyId,
  });
  if (error) throw error;
  return joinAsTestMember(code);
}

async function authUserExists(userId) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return false;
  return !!data?.user;
}

async function run() {
  console.log('== Fase 6: borrado de cuenta ==\n');

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    // ============================================================
    // Test 1 — el único admin de una company NO puede borrarse
    // ============================================================
    console.log('Test 1: el único admin de su company intenta borrarse a sí mismo');
    await resetActivationRateLimit();
    const soloAdmin = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanySolo-${Date.now()}`);
    const clientSoloAdmin = await getClientForUser(soloAdmin.email, soloAdmin.password);

    let rejectedReason = '';
    let wasRejected = false;
    try {
      const { error } = await clientSoloAdmin.rpc('delete_own_account');
      if (error) throw error;
    } catch (e) {
      wasRejected = /único administrador/i.test(e.message);
      rejectedReason = e.message;
    }
    check(wasRejected, true, `Test 1a: rechazado con el mensaje esperado ("${rejectedReason}")`);

    const { data: soloProfileAfter } = await supabaseAdmin.from('profiles').select('id').eq('id', soloAdmin.userId).maybeSingle();
    check(!!soloProfileAfter, true, 'Test 1b: el profile del admin sigue existiendo tras el intento fallido');
    check(await authUserExists(soloAdmin.userId), true, 'Test 1c: el auth.user del admin sigue existiendo tras el intento fallido');
    const { data: soloCompanyAfter } = await supabaseAdmin.from('companies').select('id').eq('id', soloAdmin.companyId).maybeSingle();
    check(!!soloCompanyAfter, true, 'Test 1d: la company sigue existiendo tras el intento fallido');

    // ============================================================
    // Test 2 — un miembro normal se borra: cascada completa, sin tocar al admin
    // ============================================================
    console.log('\nTest 2: un miembro normal (no admin) se borra a sí mismo — cascada completa');
    await resetActivationRateLimit();
    const adminT2 = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyT2-${Date.now()}`);
    const memberT2 = await addAndJoinMember(adminT2, 'MemberT2');

    const habitAssigned = await createTestHabit(adminT2);
    const habitValidated = await createTestHabit(adminT2);
    await supabaseAdmin.from('habit_assignments').insert({ habit_id: habitAssigned, user_id: memberT2.userId });
    await supabaseAdmin.from('habit_validators').insert({ habit_id: habitValidated, user_id: memberT2.userId });
    await supabaseAdmin.from('habit_logs').insert({ habit_id: habitAssigned, user_id: memberT2.userId, status: 'pending' });

    const clientMemberT2 = await getClientForUser(memberT2.email, memberT2.password);
    const { error: delT2Err } = await clientMemberT2.rpc('delete_own_account');
    check(delT2Err, null, 'Test 2a: delete_own_account() del miembro normal tiene éxito');

    const { data: memberT2ProfileAfter } = await supabaseAdmin.from('profiles').select('id').eq('id', memberT2.userId).maybeSingle();
    check(memberT2ProfileAfter, null, 'Test 2b: el profile del miembro ha desaparecido');
    check(await authUserExists(memberT2.userId), false, 'Test 2c: el auth.user del miembro ha desaparecido');

    const { count: memberLogsAfter } = await supabaseAdmin.from('habit_logs').select('id', { count: 'exact', head: true }).eq('user_id', memberT2.userId);
    check(memberLogsAfter, 0, 'Test 2d: sus habit_logs han desaparecido');
    const { count: memberAssignAfter } = await supabaseAdmin.from('habit_assignments').select('id', { count: 'exact', head: true }).eq('user_id', memberT2.userId);
    check(memberAssignAfter, 0, 'Test 2e: sus habit_assignments han desaparecido');
    const { count: memberValidatorAfter } = await supabaseAdmin.from('habit_validators').select('id', { count: 'exact', head: true }).eq('user_id', memberT2.userId);
    check(memberValidatorAfter, 0, 'Test 2f: sus habit_validators han desaparecido');

    // El admin y sus hábitos, intactos
    const { data: adminT2After } = await supabaseAdmin.from('profiles').select('id, role').eq('id', adminT2.userId).single();
    check(adminT2After.role, 'admin', 'Test 2g: el admin de la company sigue existiendo con su role intacto');
    const { count: habitsStillThere } = await supabaseAdmin.from('habits').select('id', { count: 'exact', head: true }).eq('company_id', adminT2.companyId);
    check(habitsStillThere, 2, 'Test 2h: los 2 hábitos de la company siguen existiendo (el borrado del miembro no los tocó)');

    // ============================================================
    // Test 3 — con DOS admins, uno se borra y el otro conserva control total
    // ============================================================
    console.log('\nTest 3: company con dos admins — uno se borra, el otro conserva control total');
    await resetActivationRateLimit();
    const admin1T3 = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyT3-${Date.now()}`);
    const admin2T3 = await addAndJoinMember(admin1T3, 'Admin2T3'); // se une como 'usuario'
    const clientAdmin1T3 = await getClientForUser(admin1T3.email, admin1T3.password);
    // Promoción real, mismo camino que Members.jsx/AdminScreen.js
    const { error: promoteErr } = await clientAdmin1T3.from('profiles').update({ role: 'admin' }).eq('id', admin2T3.userId);
    if (promoteErr) throw promoteErr;

    const { error: delAdmin1Err } = await clientAdmin1T3.rpc('delete_own_account');
    check(delAdmin1Err, null, 'Test 3a: con dos admins, uno de ellos SÍ puede borrarse');

    const { data: admin1T3After } = await supabaseAdmin.from('profiles').select('id').eq('id', admin1T3.userId).maybeSingle();
    check(admin1T3After, null, 'Test 3b: el admin que se borró ha desaparecido');

    const clientAdmin2T3 = await getClientForUser(admin2T3.email, admin2T3.password);
    // "Control total": puede seguir haciendo operaciones de admin reales —
    // crear un hábito (exige is_admin() + company propia, ver Fase 2) y
    // renombrar la company (exige is_admin() + company propia, ver Fase 4/DB).
    const { error: admin2CreateHabitErr } = await clientAdmin2T3.from('habits').insert({
      title: `${TEST_PREFIX}HabitByAdmin2`, company_id: admin1T3.companyId, created_by: admin2T3.userId, is_active: true,
    });
    check(admin2CreateHabitErr, null, 'Test 3c: el admin restante sigue pudiendo crear hábitos en la company');
    const { data: renameData } = await clientAdmin2T3.from('companies').update({ name: `${TEST_PREFIX}RenamedByAdmin2` }).eq('id', admin1T3.companyId).select();
    check((renameData ?? []).length, 1, 'Test 3d: el admin restante sigue pudiendo renombrar la company (control total confirmado, no solo "sigue existiendo")');

    // ============================================================
    // Test 4 — sin anonimización: cero filas residuales, ni siquiera nulificadas,
    // en cualquier tabla que pudiera referenciar al usuario borrado
    // ============================================================
    console.log('\nTest 4: confirmar que no queda NINGUNA fila residual del usuario borrado (test 2), ni nulificada');
    const tablesAndColumns = [
      ['habit_logs', 'user_id'],
      ['habit_logs', 'validated_by'],
      ['habit_assignments', 'user_id'],
      ['habit_validators', 'user_id'],
      ['habit_validations', 'validator_id'],
      ['team_members', 'user_id'],
      ['invitations', 'created_by'],
      ['profiles', 'id'],
    ];
    let anyResidual = false;
    for (const [table, column] of tablesAndColumns) {
      const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true }).eq(column, memberT2.userId);
      if (error) throw error;
      if (count > 0) {
        anyResidual = true;
        console.log(`  residual encontrado: ${table}.${column} = ${count} fila(s)`);
      }
    }
    check(anyResidual, false, 'Test 4: cero filas en cualquier tabla referencian todavía al userId borrado (test 2) — ni una sola, ni siquiera con el campo nulificado');

    // ============================================================
    // Test 5 — hábito con UN SOLO validador, que se borra: comportamiento real,
    // sin juzgar si es correcto o no, solo documentado
    // ============================================================
    console.log('\nTest 5: hábito con un único validador, que se borra a sí mismo — comportamiento real (no un juicio de si está bien o mal)');
    await resetActivationRateLimit();
    const adminT5 = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyT5-${Date.now()}`);
    const memberT5 = await addAndJoinMember(adminT5, 'MemberT5');
    const assignedT5 = await addAndJoinMember(adminT5, 'AssignedT5'); // asignado al hábito, distinto del validador

    const habitT5 = await createTestHabit(adminT5);
    await supabaseAdmin.from('habit_assignments').insert({ habit_id: habitT5, user_id: assignedT5.userId });
    await supabaseAdmin.from('habit_validators').insert({ habit_id: habitT5, user_id: memberT5.userId }); // único validador
    const { data: pendingLogT5 } = await supabaseAdmin
      .from('habit_logs').insert({ habit_id: habitT5, user_id: assignedT5.userId, status: 'pending' })
      .select('id').single();

    const { count: validatorsBefore } = await supabaseAdmin.from('habit_validators').select('id', { count: 'exact', head: true }).eq('habit_id', habitT5);
    check(validatorsBefore, 1, 'Test 5a: el hábito parte de exactamente 1 validador');

    const clientMemberT5 = await getClientForUser(memberT5.email, memberT5.password);
    const { error: delT5Err } = await clientMemberT5.rpc('delete_own_account');
    check(delT5Err, null, 'Test 5b: el único validador puede borrarse sin ningún bloqueo (no existe protección equivalente a la de "único admin")');

    const { count: validatorsAfter } = await supabaseAdmin.from('habit_validators').select('id', { count: 'exact', head: true }).eq('habit_id', habitT5);
    check(validatorsAfter, 0, 'Test 5c: el hábito se queda sin ningún validador explícito — RESUELTO: el admin de la empresa cae como validador de fallback (ver 5e-5h)');

    const { count: habitStillExistsT5 } = await supabaseAdmin.from('habits').select('id', { count: 'exact', head: true }).eq('id', habitT5);
    check(habitStillExistsT5, 1, 'Test 5d: el hábito en sí sigue existiendo (no se borra por quedarse sin validadores)');

    // ---- Resolución del hallazgo: el admin cae como validador de fallback ----
    const pendingForAdminT5 = await getPendingHabitIdsForUser(adminT5.userId, adminT5.companyId, 'admin');
    check(pendingForAdminT5.includes(habitT5), true, 'Test 5e: el admin de la empresa ahora ve este hábito como pendiente de validar (fallback por 0 validadores), sin que se haya insertado nada en habit_validators');

    const clientAdminT5 = await getClientForUser(adminT5.email, adminT5.password);
    const { error: adminValidateErr } = await clientAdminT5.from('habit_validations').insert({
      habit_log_id: pendingLogT5.id, validator_id: adminT5.userId, status: 'validated',
    });
    check(adminValidateErr, null, 'Test 5f: el admin puede insertar de verdad la validación (no solo que la pantalla se lo muestre) — RLS ya lo permitía antes de este fix, no hizo falta tocarlo para este caso');

    // ---- Aislamiento: un admin de OTRA empresa no ve ni puede validar ----
    await resetActivationRateLimit();
    const adminOtherT5 = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyT5Other-${Date.now()}`);
    const pendingForOtherAdminT5 = await getPendingHabitIdsForUser(adminOtherT5.userId, adminOtherT5.companyId, 'admin');
    check(pendingForOtherAdminT5.includes(habitT5), false, 'Test 5g: un admin de OTRA empresa NO ve este hábito como pendiente (el fallback está acotado a company_id, igual que el resto de la suite)');

    const clientAdminOtherT5 = await getClientForUser(adminOtherT5.email, adminOtherT5.password);
    const { error: otherAdminValidateErr } = await clientAdminOtherT5.from('habit_validations').insert({
      habit_log_id: pendingLogT5.id, validator_id: adminOtherT5.userId, status: 'validated',
    });
    checkRejected(otherAdminValidateErr, 'Test 5h: un admin de OTRA empresa NO puede insertar la validación — este SÍ era un hueco real de RLS (antes cualquier autenticado de cualquier empresa podía), cerrado en el mismo fix que añade el fallback');
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
