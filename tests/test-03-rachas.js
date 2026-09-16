// Fase 3: rachas y recompensas. Ejecutar con: node tests/test-03-rachas.js
//
// IMPORTANTE — estas son RÉPLICAS deliberadas de funciones que viven en
// pantallas de React Native (HabitDetailScreen.js, HomeScreen.js): no se
// pueden `require()` directamente porque esos ficheros importan react-native/
// expo-image-picker/etc., que no corren en un script de Node plano. Mismo
// patrón ya usado en test-01-alta.js (adminNeedsFamilySetup replica
// HomeScreen.js:184-212). Si esas pantallas cambian su lógica de cálculo,
// hay que actualizar las réplicas de aquí a mano — no hay forma de que esto
// se detecte solo.

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  buildStreak,
  createReward,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}

// ---- Réplicas de HabitDetailScreen.js:27-98 (verificadas línea a línea contra
// el código real antes de escribir este fichero) ----
function toDateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function getMondayKey(date) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return toDateKey(d);
}
// HabitDetailScreen.js:41-77
function calculateStreak(logs, recurrence, weeklyTarget, monthlyTarget) {
  if (!logs.length) return 0;
  if (recurrence === 'weekly_x') {
    const wTarget = weeklyTarget || 1;
    const weekCountMap = {};
    logs.forEach((l) => { const k = getMondayKey(new Date(l.created_at)); weekCountMap[k] = (weekCountMap[k] || 0) + 1; });
    const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
    const dow = cursor.getDay();
    cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1));
    if ((weekCountMap[toDateKey(cursor)] || 0) < wTarget) cursor.setDate(cursor.getDate() - 7);
    let streak = 0;
    while ((weekCountMap[toDateKey(cursor)] || 0) >= wTarget) { streak++; cursor.setDate(cursor.getDate() - 7); }
    return streak;
  }
  if (recurrence === 'monthly_x') {
    const mTarget = monthlyTarget || 1;
    let year = new Date().getFullYear();
    let month = new Date().getMonth();
    const countFor = (y, m) => logs.filter((l) => { const d = new Date(l.created_at); return d >= new Date(y, m, 1) && d < new Date(y, m + 1, 1); }).length;
    if (countFor(year, month) < mTarget) { month--; if (month < 0) { month = 11; year--; } }
    let streak = 0;
    while (countFor(year, month) >= mTarget) { streak++; month--; if (month < 0) { month = 11; year--; } }
    return streak;
  }
  // daily / once
  const logDays = new Set(logs.map((l) => toDateKey(new Date(l.created_at))));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = new Date(today);
  if (!logDays.has(toDateKey(today))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (logDays.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
// HabitDetailScreen.js:82-98
function calculateTotalCompleted(logs, recurrence, weeklyTarget, monthlyTarget) {
  if (!logs.length) return 0;
  if (recurrence === 'weekly_x') {
    const wTarget = weeklyTarget || 1;
    const weekCountMap = {};
    logs.forEach((l) => { const k = getMondayKey(new Date(l.created_at)); weekCountMap[k] = (weekCountMap[k] || 0) + 1; });
    return Object.values(weekCountMap).filter((c) => c >= wTarget).length;
  }
  if (recurrence === 'monthly_x') {
    const mTarget = monthlyTarget || 1;
    const monthCountMap = {};
    logs.forEach((l) => { const d = new Date(l.created_at); const k = `${d.getFullYear()}-${d.getMonth()}`; monthCountMap[k] = (monthCountMap[k] || 0) + 1; });
    return Object.values(monthCountMap).filter((c) => c >= mTarget).length;
  }
  // daily / once
  return new Set(logs.map((l) => toDateKey(new Date(l.created_at)))).size;
}
// HomeScreen.js:393-401 — "recompensa a mostrar" en el chip del hábito
function computeFeaturedReward(rewards, totalHistorical) {
  const list = rewards.map((r) => ({
    ...r,
    timesAchieved: Math.floor(totalHistorical / r.streak_target),
    daysToNext: r.streak_target - (totalHistorical % r.streak_target),
  }));
  return list.length > 0
    ? list.reduce((best, r) => (!best || r.daysToNext < best.daysToNext) ? r : best, null)
    : null;
}

// ---- Helpers de fechas para construir escenarios de semana/mes concretos ----
function daysAgoForMonday(weeksBack) {
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const dow = cursor.getDay();
  cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1)); // lunes de esta semana
  cursor.setDate(cursor.getDate() - weeksBack * 7);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - cursor) / 86400000);
}
function daysAgoForDate(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  return Math.round((today - d) / 86400000);
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

async function fetchLogs(habitId, userId) {
  const { data, error } = await supabaseAdmin
    .from('habit_logs').select('created_at').eq('habit_id', habitId).eq('user_id', userId);
  if (error) throw error;
  return data;
}

async function run() {
  console.log('== Fase 3: rachas y recompensas ==\n');
  console.log(
    'NOTA: el test 5 originalmente previsto ("periodo de gracia en once") se ' +
    'elimina — no existe tal cosa en el código (once se trata idéntico a ' +
    'daily). El periodo de gracia real es de weekly_x/monthly_x y se verifica ' +
    'dentro de los tests 3 y 4. Ver tests/README.md para el detalle completo.\n'
  );

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    const admin = await createTestCompanyAndAdmin(`${TEST_PREFIX}Company-${Date.now()}`);
    const userId = admin.userId;

    // ---- Test 1: racha diaria de 3 días consecutivos ----
    console.log('Test 1: racha diaria, 3 días consecutivos');
    const habitDaily1 = await createTestHabit(admin, { recurrence: 'daily' });
    await buildStreak({ habitId: habitDaily1, userId, daysAgoList: [0, 1, 2] });
    const logsDaily1 = await fetchLogs(habitDaily1, userId);
    check(calculateStreak(logsDaily1, 'daily'), 3, 'Test 1: 3 días consecutivos (hoy, ayer, anteayer) => racha=3');

    // ---- Test 2: racha diaria rota ----
    console.log('\nTest 2: racha diaria con un hueco (día 1 hecho, día 2 saltado, día 3 = hoy)');
    const habitDaily2 = await createTestHabit(admin, { recurrence: 'daily' });
    // día 3 = hoy (daysAgo=0), día 2 = ayer SALTADO, día 1 = anteayer (daysAgo=2)
    await buildStreak({ habitId: habitDaily2, userId, daysAgoList: [0, 2] });
    const logsDaily2 = await fetchLogs(habitDaily2, userId);
    // Traza del algoritmo: logDays={hoy, hoy-2}. cursor=hoy (está en el set) => streak=1,
    // cursor=ayer (hoy-1) => NO está en el set => para. Resultado: 1, no 3 ni 2.
    check(calculateStreak(logsDaily2, 'daily'), 1, 'Test 2: con un hueco de por medio, la racha es 1 (no 3) — el hueco corta la cuenta justo en el día actual');

    // ---- Test 3: racha weekly_x — cumple/rompe/periodo de gracia ----
    console.log('\nTest 3: racha weekly_x (target=3) — cumple, rompe, y periodo de gracia de la semana en curso');
    const habitWeekly = await createTestHabit(admin, { recurrence: 'weekly_x', weekly_target: 3 });
    // Semana actual (en curso, sin terminar): solo 1 log — no cumple el target todavía
    await buildStreak({ habitId: habitWeekly, userId, daysAgoList: [0] });
    // Semana pasada (completa): 3 logs — cumple
    const mon1 = daysAgoForMonday(1);
    await buildStreak({ habitId: habitWeekly, userId, daysAgoList: [mon1, mon1 - 1, mon1 - 2] });
    // Hace 2 semanas (completa): 3 logs — cumple
    const mon2 = daysAgoForMonday(2);
    await buildStreak({ habitId: habitWeekly, userId, daysAgoList: [mon2, mon2 - 1, mon2 - 2] });
    // Hace 3 semanas: solo 1 log — NO cumple, aquí debe cortarse la racha
    const mon3 = daysAgoForMonday(3);
    await buildStreak({ habitId: habitWeekly, userId, daysAgoList: [mon3] });

    const logsWeekly = await fetchLogs(habitWeekly, userId);
    check(
      calculateStreak(logsWeekly, 'weekly_x', 3),
      2,
      'Test 3: semana en curso (grace, se ignora) + 2 semanas completas que cumplen + 1 semana que no cumple => racha=2'
    );

    // ---- Test 4: racha monthly_x — análogo a nivel mes ----
    console.log('\nTest 4: racha monthly_x (target=2) — cumple, rompe, y periodo de gracia del mes en curso');
    const habitMonthly = await createTestHabit(admin, { recurrence: 'monthly_x', monthly_target: 2 });
    const now = new Date();
    const monthDate = (monthsBack, day) => new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
    // Mes actual (en curso): solo 1 log — no cumple todavía
    await buildStreak({ habitId: habitMonthly, userId, daysAgoList: [0] });
    // Mes pasado (completo): 2 logs — cumple
    await buildStreak({
      habitId: habitMonthly, userId,
      daysAgoList: [daysAgoForDate(monthDate(1, 5)), daysAgoForDate(monthDate(1, 6))],
    });
    // Hace 2 meses (completo): 2 logs — cumple
    await buildStreak({
      habitId: habitMonthly, userId,
      daysAgoList: [daysAgoForDate(monthDate(2, 5)), daysAgoForDate(monthDate(2, 6))],
    });
    // Hace 3 meses: solo 1 log — NO cumple, corta la racha
    await buildStreak({ habitId: habitMonthly, userId, daysAgoList: [daysAgoForDate(monthDate(3, 5))] });

    const logsMonthly = await fetchLogs(habitMonthly, userId);
    check(
      calculateStreak(logsMonthly, 'monthly_x', undefined, 2),
      2,
      'Test 4: mes en curso (grace, se ignora) + 2 meses completos que cumplen + 1 mes que no cumple => racha=2'
    );

    // ---- Test 6: la racha sube al completar (INSERT), no al validar ----
    console.log('\nTest 6: la racha se calcula sobre habit_logs, no depende de haber sido validada');
    const habitUnvalidated = await createTestHabit(admin, { recurrence: 'daily' });
    await buildStreak({ habitId: habitUnvalidated, userId, daysAgoList: [0, 1, 2], validated: false });
    const { count: validationsCount, error: validationsErr } = await supabaseAdmin
      .from('habit_validations').select('id', { count: 'exact', head: true })
      .eq('validator_id', userId); // ninguna validación insertada por nadie para este habit
    if (validationsErr) throw validationsErr;
    check(validationsCount, 0, 'Test 6: no existe ninguna fila en habit_validations para estos logs');
    const logsUnvalidated = await fetchLogs(habitUnvalidated, userId);
    check(calculateStreak(logsUnvalidated, 'daily'), 3, 'Test 6: la racha=3 se cuenta igual, sin ninguna validación de por medio');

    // ---- Test 7: recompensa simple ----
    // "Conseguida" es cálculo de cliente puro (Math.floor(total/streak_target)),
    // sin ninguna columna en habit_rewards que lo persista (solo id, habit_id,
    // streak_target, description) — el test replica la fórmula sobre logs
    // reales, no verifica ningún estado guardado en la BD.
    console.log('\nTest 7: recompensa simple — streak_target=3, total=3 => conseguida ×1');
    const habitReward1 = await createTestHabit(admin, { recurrence: 'daily' });
    await buildStreak({ habitId: habitReward1, userId, daysAgoList: [0, 1, 2] });
    const totalReward1 = calculateTotalCompleted(await fetchLogs(habitReward1, userId), 'daily');
    check(Math.floor(totalReward1 / 3), 1, 'Test 7: floor(total/streak_target) = 1 (conseguida una vez)');

    // ---- Test 8: recursividad ----
    console.log('\nTest 8: recursividad — total=6, streak_target=3 => conseguida ×2');
    const habitReward2 = await createTestHabit(admin, { recurrence: 'daily' });
    await buildStreak({ habitId: habitReward2, userId, daysAgoList: [0, 1, 2, 3, 4, 5] });
    const totalReward2 = calculateTotalCompleted(await fetchLogs(habitReward2, userId), 'daily');
    check(totalReward2, 6, 'Test 8: total histórico = 6 días únicos');
    check(Math.floor(totalReward2 / 3), 2, 'Test 8: floor(6/3) = 2 (conseguida dos veces)');

    // ---- Test 9: histórico acumulado, no se resetea al romper la racha ----
    console.log('\nTest 9: el histórico de "veces conseguida" no se resetea al romper la racha (actual)');
    const habitReward3 = await createTestHabit(admin, { recurrence: 'daily' });
    // Primer bloque de 3 días, lejos de hoy (racha actual ya rota respecto a estos días)
    await buildStreak({ habitId: habitReward3, userId, daysAgoList: [10, 9, 8] });
    const totalAfterFirstBlock = calculateTotalCompleted(await fetchLogs(habitReward3, userId), 'daily');
    check(Math.floor(totalAfterFirstBlock / 3), 1, 'Test 9a: tras el primer bloque de 3 días, conseguida ×1');
    // Segundo bloque de 3 días, cerca de hoy — hay un hueco de varios días entre
    // ambos bloques (la racha ACTUAL de calculateStreak sería solo 3, no 6),
    // pero calculateTotalCompleted no distingue rachas: solo cuenta días únicos.
    await buildStreak({ habitId: habitReward3, userId, daysAgoList: [2, 1, 0] });
    const logsReward3 = await fetchLogs(habitReward3, userId);
    const totalAfterSecondBlock = calculateTotalCompleted(logsReward3, 'daily');
    check(totalAfterSecondBlock, 6, 'Test 9b: el total histórico suma 6 (3+3), pese al hueco entre bloques');
    check(Math.floor(totalAfterSecondBlock / 3), 2, 'Test 9c: conseguida ×2 — el histórico no se reseteó al "romperse" la racha actual');
    check(calculateStreak(logsReward3, 'daily'), 3, 'Test 9d: la racha ACTUAL (calculateStreak) sí es solo 3 — confirma que streak y total-histórico son cosas distintas');

    // ---- Test 10: varias recompensas en el mismo hábito ----
    console.log('\nTest 10: varias recompensas (target 3 y 7) con total=5 — solo la de target=3 está conseguida');
    const habitReward4 = await createTestHabit(admin, { recurrence: 'daily' });
    await buildStreak({ habitId: habitReward4, userId, daysAgoList: [0, 1, 2, 3, 4] });
    await createReward({ habitId: habitReward4, streakTarget: 3, description: `${TEST_PREFIX}Reward3` });
    await createReward({ habitId: habitReward4, streakTarget: 7, description: `${TEST_PREFIX}Reward7` });
    const totalReward4 = calculateTotalCompleted(await fetchLogs(habitReward4, userId), 'daily');
    check(totalReward4, 5, 'Test 10: total histórico = 5');
    check(Math.floor(totalReward4 / 3) > 0, true, 'Test 10: la recompensa target=3 SÍ está conseguida (floor(5/3)=1)');
    check(Math.floor(totalReward4 / 7) > 0, false, 'Test 10: la recompensa target=7 NO está conseguida (floor(5/7)=0)');

    // ---- Test 11: featuredReward (HomeScreen.js:398-401) — caso contraintuitivo ----
    // Criterio real: menor daysToNext entre TODAS las recompensas (conseguidas
    // o no), NO menor streak_target entre las no conseguidas. Con total=2:
    // target=2 -> ya conseguida (timesAchieved=1) pero daysToNext=2-(2%2)=2
    // target=3 -> aún no conseguida (timesAchieved=0) pero daysToNext=3-(2%3)=1
    // Gana target=3 (menor daysToNext), pese a ser el target MAYOR y estar SIN
    // conseguir — el target menor, ya conseguido, pierde. Nada de esto es obvio
    // leyendo solo la intención ("mostrar la próxima recompensa").
    console.log('\nTest 11: featuredReward — el de streak_target MAYOR puede ganar (caso contraintuitivo real)');
    const rewardsTest11 = [
      { streak_target: 2, description: `${TEST_PREFIX}RewardA` },
      { streak_target: 3, description: `${TEST_PREFIX}RewardB` },
    ];
    const featured = computeFeaturedReward(rewardsTest11, 2);
    check(featured.streak_target, 3, 'Test 11: con total=2, gana el reward de target=3 (daysToNext=1) sobre el de target=2, ya conseguido (daysToNext=2)');
    check(featured.timesAchieved, 0, 'Test 11: la recompensa destacada es una que AÚN NO se ha conseguido en este caso');
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
