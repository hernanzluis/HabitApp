// Fase 5: límites de plan (plan_limits, check_member_limit, check_habit_limit).
// Ejecutar con: node tests/test-05-limites.js
//
// Test 1 del plan original ("company nueva -> plan='familiar' por defecto")
// NO se repite aquí: ya está cubierto por el test 1 de la Fase 1
// (test-01-alta.js). No es un hueco, está en otro fichero.

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  buildStreak,
  resetActivationRateLimit,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}

async function getPlanLimits(plan) {
  const { data, error } = await supabaseAdmin.from('plan_limits').select('*').eq('plan', plan).single();
  if (error) throw new Error(`getPlanLimits(${plan}): ${error.message}`);
  return data;
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

async function addTestMember(admin, label) {
  const email = `${TEST_PREFIX}${Date.now()}-${label}@habitapp-test.local`;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const { error } = await supabaseAdmin.from('activation_codes').insert({
    code, full_name: `${TEST_PREFIX}${label}`, email, company_id: admin.companyId,
  });
  if (error) throw error;
  return { code, email };
}

async function run() {
  console.log('== Fase 5: límites de plan ==\n');

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    const familiarLimits = await getPlanLimits('familiar');
    console.log(`plan_limits.familiar real: max_members=${familiarLimits.max_members}, max_active_habits=${familiarLimits.max_active_habits}, history_days=${familiarLimits.history_days}\n`);

    // ============================================================
    // Test 2 — check_habit_limit: 100% enforcement de CLIENTE, sin backstop
    // de servidor. La policy RLS de INSERT en habits solo comprueba
    // is_admin() + company_id — no cuenta hábitos. Se confirma tanto que la
    // RPC devuelve false en el límite como que un INSERT directo (saltándose
    // la RPC, como haría una llamada a la API fuera de la app) NO se bloquea.
    // ============================================================
    console.log(`Test 2: check_habit_limit (max_active_habits=${familiarLimits.max_active_habits} del plan familiar)`);
    const adminHabits = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyHabits-${Date.now()}`);
    const maxHabits = familiarLimits.max_active_habits;

    for (let i = 0; i < maxHabits - 1; i++) {
      await createTestHabit(adminHabits);
    }
    const { data: okBeforeLimit } = await supabaseAdmin.rpc('check_habit_limit', { p_company_id: adminHabits.companyId });
    check(okBeforeLimit, true, `Test 2a: con ${maxHabits - 1} hábitos activos (uno menos del límite), check_habit_limit = true`);

    await createTestHabit(adminHabits); // llega exactamente al límite
    const { data: okAtLimit } = await supabaseAdmin.rpc('check_habit_limit', { p_company_id: adminHabits.companyId });
    check(okAtLimit, false, `Test 2b: con ${maxHabits} hábitos activos (el límite exacto), check_habit_limit = false`);

    // La RPC dice que no hay hueco — pero nada en la base de datos impide
    // insertar el hábito nº ${maxHabits + 1} directamente, saltándose la RPC.
    const { error: bypassErr } = await supabaseAdmin.from('habits').insert({
      title: `${TEST_PREFIX}HabitBypass`, company_id: adminHabits.companyId, created_by: adminHabits.userId, is_active: true,
    });
    check(bypassErr, null, `Test 2c: un INSERT directo en habits nº ${maxHabits + 1} tiene éxito sin bloqueo — confirma que check_habit_limit no tiene backstop de servidor`);

    // ============================================================
    // Test 3 — check_member_limit, chequeo de CLIENTE (antes de generar el código)
    // ============================================================
    console.log(`\nTest 3: check_member_limit — chequeo de cliente (max_members=${familiarLimits.max_members} del plan familiar)`);
    // Esta fase hace muchas más llamadas a check_activation_code (una por
    // cada joinAsTestMember) que fases anteriores en una sola ejecución —
    // se resetea el contador de rate limiting antes de cada bloque que las
    // necesita, para no confundir "bloqueado por rate limit" con "bloqueado
    // por límite de miembros" (ver tests/README.md).
    await resetActivationRateLimit();
    const adminMembers = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyMembers-${Date.now()}`);
    const maxMembers = familiarLimits.max_members;

    // El admin ya cuenta como 1 miembro. Añadir (max-2) más para dejar 1 hueco.
    for (let i = 0; i < maxMembers - 2; i++) {
      const { code } = await addTestMember(adminMembers, `Member${i}`);
      await joinAsTestMember(code);
    }
    const { data: okOneSlotLeft } = await supabaseAdmin.rpc('check_member_limit', { p_company_id: adminMembers.companyId });
    check(okOneSlotLeft, true, `Test 3a: con ${maxMembers - 1} miembros totales (admin + ${maxMembers - 2}), queda 1 hueco, check_member_limit = true`);

    const { code: lastCode } = await addTestMember(adminMembers, 'LastMember');
    await joinAsTestMember(lastCode); // ocupa el último hueco -> total = maxMembers
    const { data: okAtMemberLimit } = await supabaseAdmin.rpc('check_member_limit', { p_company_id: adminMembers.companyId });
    check(okAtMemberLimit, false, `Test 3b: con ${maxMembers} miembros totales (el límite exacto), check_member_limit = false`);

    // ============================================================
    // Test 4 — el chequeo de SERVIDOR (dentro de handle_activation_registration)
    // es una guarda independiente del chequeo de cliente, no el mismo punto de
    // código con otro nombre. Escenario: se genera un código cuando SÍ hay
    // hueco (el chequeo de cliente lo aprobaría), pero para cuando se intenta
    // ACTIVARLO, otro miembro ya ocupó ese hueco — el chequeo de servidor debe
    // bloquear la activación aunque el código en sí sea válido.
    // ============================================================
    console.log('\nTest 4: el chequeo de SERVIDOR dentro de handle_activation_registration es una guarda independiente, no el mismo punto que el de cliente');
    await resetActivationRateLimit();
    const adminRace = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyRace-${Date.now()}`);
    for (let i = 0; i < familiarLimits.max_members - 2; i++) {
      const { code } = await addTestMember(adminRace, `RaceEarly${i}`);
      await joinAsTestMember(code);
    }
    // Ahora hay 1 hueco. Se genera un código para "el siguiente" pero NO se usa todavía.
    const { code: heldBackCode, email: heldBackEmail } = await addTestMember(adminRace, 'HeldBack');
    const { data: clientCheckPassed } = await supabaseAdmin.rpc('check_member_limit', { p_company_id: adminRace.companyId });
    check(clientCheckPassed, true, 'Test 4a: en el momento de generar el código, check_member_limit ya decía que había hueco (chequeo de cliente)');

    // Otro miembro distinto ocupa ese mismo hueco mientras el código anterior sigue sin usar.
    const { code: raceFillerCode } = await addTestMember(adminRace, 'RaceFiller');
    await joinAsTestMember(raceFillerCode); // total llega al límite

    // Ahora se intenta activar el código que se generó cuando SÍ había hueco.
    // Reset justo antes de esta llamada: ya van varias check_activation_code
    // en este mismo test (RaceEarly + RaceFiller) y lo que se quiere aislar
    // aquí es el chequeo de MIEMBROS, no que el rate limiting por IP se
    // adelante y dé un falso positivo con un mensaje distinto.
    await resetActivationRateLimit();
    let rejectedAtServer = false;
    let rejectedMessage = '';
    try {
      await joinAsTestMember(heldBackCode);
    } catch (e) {
      rejectedAtServer = /limit_members_reached/.test(e.message);
      rejectedMessage = e.message;
    }
    check(rejectedAtServer, true, `Test 4b: la activación del código generado-con-hueco es rechazada por el chequeo de SERVIDOR (mensaje: "${rejectedMessage}") — el chequeo de cliente ya había dado luz verde antes, así que son guardas independientes`);

    // El auth.user de heldBackEmail se creó (auth.signUp) antes de que la RPC
    // fallara al insertar el profile -> queda huérfano. cleanupTestData() ya
    // lo busca por auth.users.email con el prefijo, no solo por profiles.
    console.log(`  (nota: ${heldBackEmail} queda como auth.user huérfano hasta la limpieza — comportamiento esperado, ver README)`);

    // ============================================================
    // Test 5 — plan 'empresa': max_active_habits y max_members son NULL,
    // sin restricción real (no se asume, se confirma creando de verdad más
    // hábitos que el límite del plan familiar).
    // ============================================================
    console.log('\nTest 5: en plan "empresa" (max_active_habits=NULL), crear más hábitos que el límite de "familiar" no bloquea nada');
    const adminEnterprise = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyEnterprise-${Date.now()}`);
    const { error: planUpdateErr } = await supabaseAdmin.from('companies').update({ plan: 'empresa' }).eq('id', adminEnterprise.companyId);
    if (planUpdateErr) throw planUpdateErr;

    const habitsToCreate = familiarLimits.max_active_habits + 2; // deliberadamente por encima del límite de familiar
    for (let i = 0; i < habitsToCreate; i++) {
      await createTestHabit(adminEnterprise);
    }
    const { data: enterpriseOk } = await supabaseAdmin.rpc('check_habit_limit', { p_company_id: adminEnterprise.companyId });
    check(enterpriseOk, true, `Test 5: con ${habitsToCreate} hábitos activos (más que el límite de familiar), check_habit_limit sigue en true en plan "empresa"`);

    // ============================================================
    // Test 6 — history_days: 100% filtro de CLIENTE (confirmado: la query real
    // a habit_logs no lleva ningún filtro de fecha, ProfileScreen.js:310 /
    // HabitStatsScreen.js:318 recortan después, en JS, con
    // `logs.filter(l => new Date(l.created_at) >= cutoff)`). No hay enforcement
    // de servidor que testear — se replica la fórmula exacta sobre logs reales,
    // igual que se hizo con calculateStreak/featuredReward en la Fase 3.
    // ============================================================
    console.log(`\nTest 6: history_days=${familiarLimits.history_days} — filtro de cliente replicado sobre logs reales`);
    const adminHistory = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyHistory-${Date.now()}`);
    const habitHistory = await createTestHabit(adminHistory);
    const historyDays = familiarLimits.history_days;
    await buildStreak({
      habitId: habitHistory,
      userId: adminHistory.userId,
      daysAgoList: [historyDays - 1, historyDays + 1, historyDays + 5], // uno dentro, dos fuera de la ventana
    });
    const { data: allLogs, error: allLogsErr } = await supabaseAdmin
      .from('habit_logs').select('created_at').eq('habit_id', habitHistory).eq('user_id', adminHistory.userId);
    if (allLogsErr) throw allLogsErr;
    check(allLogs.length, 3, 'Test 6a: los 3 logs existen en la BD sin ningún filtro (confirma que la query real no recorta por fecha)');

    // Réplica exacta del filtro de ProfileScreen.js/HabitStatsScreen.js
    const cutoff = historyDays != null ? new Date(Date.now() - historyDays * 86400000) : null;
    const filtered = allLogs.filter((l) => !cutoff || new Date(l.created_at) >= cutoff);
    check(filtered.length, 1, `Test 6b: el filtro de cliente (historyDays=${historyDays}) deja solo 1 de los 3 logs — el que está dentro de la ventana`);

    // En un plan sin límite de historial (historyDays=null), el mismo filtro no recorta nada.
    const cutoffUnlimited = null;
    const filteredUnlimited = allLogs.filter((l) => !cutoffUnlimited || new Date(l.created_at) >= cutoffUnlimited);
    check(filteredUnlimited.length, 3, 'Test 6c: con historyDays=null (planes plus/empresa), el mismo filtro no recorta ningún log');
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
