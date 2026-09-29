// Fase 9: aislamiento de la API pública tras el cierre de seguridad del
// 2026-09-28 (sql/2026-09-28c..h, docs/security-inventory-2026-09-28.md).
// Ejecutar con: node tests/test-09-aislamiento.js
//
// Convierte en tests la verificación manual que se hizo ese día con dos
// empresas zztest-: anon no lee ni ejecuta nada (salvo check_activation_code y
// keepalive),
// una empresa no ve nada de otra (tablas, funciones, listado de Storage), y
// las RPCs de gestión de miembros validan lo que reciben. Cada bloqueo lleva
// su control positivo: un 0 filas solo demuestra algo si el dueño sí las ve.
//
// Incluye además, marcado [CONOCIDO], un comportamiento que NO es un fallo
// sino el límite aceptado de la opción 1 de Storage (buckets públicos): quien
// conozca la ruta de un fichero lo descarga sin sesión o desde otra empresa.
// Si algún día se aplica la opción 2 (buckets privados + URLs firmadas), esos
// tests fallarán y habrá que invertirlos — es su propósito.

const {
  SUPABASE_URL,
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  getClientForUser,
  getAnonClient,
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

// Todas las tablas de public tras el 2026-09-28 (invitations ya no existe).
const PUBLIC_TABLES = [
  'activation_attempts', 'activation_codes', 'categories', 'companies', 'habit_assignments',
  'habit_logs', 'habit_rewards', 'habit_validations', 'habit_validators', 'habits',
  'plan_limits', 'profiles', 'team_members', 'teams',
];

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
  return joinAsTestMember(code);
}

async function run() {
  console.log('== Fase 9: aislamiento de la API pública ==\n');
  console.log('Limpieza previa...');
  await cleanupTestData();
  console.log('OK\n');

  const uploaded = { 'habit-photos': [], avatars: [] };
  let teamId = null;

  try {
    // ---------- Setup: empresa A (admin + miembro) y empresa B (admin + miembro) ----------
    const adminA = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyA-${Date.now()}`);
    const memberA = await addMember(adminA, 'MemberA');
    const adminB = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyB-${Date.now()}`);
    const memberB = await addMember(adminB, 'MemberB');
    const cAdminA = await getClientForUser(adminA.email, adminA.password);
    const cMemberA = await getClientForUser(memberA.email, memberA.password);
    const cMemberB = await getClientForUser(memberB.email, memberB.password);
    const anon = getAnonClient();

    const habit = await must(supabaseAdmin.from('habits').insert({
      title: `${TEST_PREFIX}HabitA`, company_id: adminA.companyId, created_by: adminA.userId, is_active: true, recurrence: 'daily',
    }).select('id').single());
    await must(supabaseAdmin.from('habit_assignments').insert({ habit_id: habit.id, user_id: memberA.userId }));
    await must(supabaseAdmin.from('habit_validators').insert({ habit_id: habit.id, user_id: adminA.userId }));
    await must(supabaseAdmin.from('habit_rewards').insert({ habit_id: habit.id, streak_target: 3, description: `${TEST_PREFIX}RewardA` }));
    await must(supabaseAdmin.from('categories').insert({ name: `${TEST_PREFIX}CatA`, company_id: adminA.companyId, icon: 'ellipsis-horizontal', color: '#9E9E9E' }));
    const team = await must(supabaseAdmin.from('teams').insert({ name: `${TEST_PREFIX}TeamA`, company_id: adminA.companyId, created_by: adminA.userId }).select('id').single());
    teamId = team.id;
    await must(supabaseAdmin.from('team_members').insert({ team_id: team.id, user_id: memberA.userId }));

    // Foto y avatar de memberA subidos por él mismo (camino de HabitDetailScreen / ProfileScreen).
    const img = Buffer.from('zztest-fase9');
    const photoPath = `${memberA.userId}/${habit.id}/${Date.now()}.jpg`;
    await must(cMemberA.storage.from('habit-photos').upload(photoPath, img, { contentType: 'image/jpeg' }));
    uploaded['habit-photos'].push(photoPath);
    const avatarPath = `${memberA.userId}/avatar.jpg`;
    await must(cMemberA.storage.from('avatars').upload(avatarPath, img, { contentType: 'image/jpeg', upsert: true }));
    uploaded.avatars.push(avatarPath);
    const photoUrl = cMemberA.storage.from('habit-photos').getPublicUrl(photoPath).data.publicUrl;
    const log = await must(cMemberA.from('habit_logs').insert({ habit_id: habit.id, user_id: memberA.userId, photo_url: photoUrl, status: 'pending' }).select('id').single());
    await must(cAdminA.from('habit_validations').insert({ habit_log_id: log.id, validator_id: adminA.userId, status: 'validated' }));

    // ============================================================
    // Test 1 — anon no lee ninguna tabla de public
    // ============================================================
    console.log('Test 1: sin sesión (solo anon key) no se lee ninguna tabla');
    for (const table of PUBLIC_TABLES) {
      const { error } = await anon.from(table).select('*').limit(1);
      checkError(error, /permission denied/, `Test 1: anon no lee ${table}`);
    }

    // ============================================================
    // Test 2 — anon no ejecuta ninguna función salvo check_activation_code
    // y keepalive (ping del workflow .github/workflows/supabase-keepalive.yml,
    // añadida el 2026-09-29: sql/2026-09-29_keepalive.sql)
    // ============================================================
    console.log('\nTest 2: sin sesión solo se ejecutan check_activation_code y keepalive');
    const anonCalls = [
      ['check_habit_limit', { p_company_id: adminA.companyId }],
      ['check_member_limit', { p_company_id: adminA.companyId }],
      ['get_company_plan_info', { p_company_id: adminA.companyId }],
      ['delete_expired_habit', { p_habit_id: habit.id }],
      ['delete_member', { member_id: memberA.userId }],
      ['delete_own_account', {}],
      ['update_member_avatar', { member_id: memberA.userId, new_avatar_url: null }],
      ['update_member_profile', { member_id: memberA.userId, new_full_name: 'x', new_email: 'x', new_role: 'usuario' }],
      ['handle_new_user_registration', { user_id: memberA.userId, user_email: 'x', user_full_name: 'x', company_name: 'x' }],
      ['handle_activation_registration', { user_id: memberA.userId, user_email: 'x', user_full_name: 'x', activation_code: 'x' }],
      ['is_admin', {}],
      ['my_company_id', {}],
      ['is_my_company_habit', { p_habit_id: habit.id }],
      ['is_my_company_log', { p_log_id: log.id }],
    ];
    for (const [fn, args] of anonCalls) {
      const { error } = await anon.rpc(fn, args);
      checkError(error, /permission denied/, `Test 2: anon no ejecuta ${fn}`);
    }
    await resetActivationRateLimit();
    const { error: chkErr } = await anon.rpc('check_activation_code', { p_code: 'zz0000' });
    check(chkErr, null, 'Test 2: control — anon SÍ ejecuta check_activation_code (paso 1 del alta con código)');
    const { data: ping, error: pingErr } = await anon.rpc('keepalive');
    check([ping, pingErr], [1, null], 'Test 2: control — anon SÍ ejecuta keepalive() y devuelve 1 (ping anti-pausa de Supabase)');

    // ============================================================
    // Test 3 — un miembro de B no lee nada de A (y los de A sí)
    // ============================================================
    console.log('\nTest 3: un usuario de la empresa B no lee filas de la empresa A');
    const crossReads = [
      ['habits', 'company_id', adminA.companyId],
      ['habit_logs', 'habit_id', habit.id],
      ['habit_assignments', 'habit_id', habit.id],
      ['habit_validators', 'habit_id', habit.id],
      ['habit_rewards', 'habit_id', habit.id],
      ['habit_validations', 'habit_log_id', log.id],
      ['categories', 'company_id', adminA.companyId],
      ['profiles', 'company_id', adminA.companyId],
      ['companies', 'id', adminA.companyId],
      ['activation_codes', 'company_id', adminA.companyId],
      ['team_members', 'team_id', team.id],
    ];
    for (const [table, col, value] of crossReads) {
      const { data, error } = await cMemberB.from(table).select('*').eq(col, value);
      if (error) throw new Error(`${table} como miembro de B: ${error.message}`);
      check(data.length, 0, `Test 3: el miembro de B no lee ${table} de A`);
    }
    for (const [table, col, value] of crossReads.filter(([t]) => !['activation_codes', 'team_members'].includes(t))) {
      const { data, error } = await cMemberA.from(table).select('*').eq(col, value);
      if (error) throw new Error(`${table} como miembro de A: ${error.message}`);
      check(data.length > 0, true, `Test 3: control — el miembro de A sí lee ${table} de su empresa`);
    }
    const { data: codesA } = await cAdminA.from('activation_codes').select('id').eq('company_id', adminA.companyId);
    check(codesA.length > 0, true, 'Test 3: control — el admin de A sí lee sus activation_codes');
    const { data: catsSystem } = await cMemberB.from('categories').select('id').is('company_id', null);
    check(catsSystem.length > 0, true, 'Test 3: control — las categorías predefinidas siguen legibles para B');

    // ============================================================
    // Test 4 — funciones de plan: solo sobre la empresa propia
    // ============================================================
    console.log('\nTest 4: check_habit_limit / check_member_limit / get_company_plan_info solo sobre la empresa propia');
    for (const fn of ['check_habit_limit', 'check_member_limit']) {
      const { error } = await cMemberB.rpc(fn, { p_company_id: adminA.companyId });
      checkError(error, /forbidden/, `Test 4: el miembro de B no consulta ${fn} de A`);
    }
    const { data: planCross, error: planCrossErr } = await cMemberB.rpc('get_company_plan_info', { p_company_id: adminA.companyId });
    if (planCrossErr) throw planCrossErr;
    check(planCross.length, 0, 'Test 4: get_company_plan_info de A devuelve vacío para el miembro de B');
    const { data: planOwn } = await cMemberA.rpc('get_company_plan_info', { p_company_id: adminA.companyId });
    check(planOwn.length, 1, 'Test 4: control — el miembro de A sí obtiene el plan de su empresa');

    // ============================================================
    // Test 5 — Storage: B no lista los ficheros de A (A sí)
    // ============================================================
    console.log('\nTest 5: Storage — un usuario de B no lista los ficheros de A por la API');
    const { data: rootB } = await cMemberB.storage.from('habit-photos').list();
    check((rootB ?? []).some((x) => x.name === memberA.userId), false, 'Test 5: en la raíz de habit-photos, B no ve la carpeta del miembro de A');
    const { data: folderB } = await cMemberB.storage.from('habit-photos').list(`${memberA.userId}/${habit.id}`);
    check((folderB ?? []).length, 0, 'Test 5: B no lista las fotos del miembro de A');
    const { data: avatarB } = await cMemberB.storage.from('avatars').list(memberA.userId);
    check((avatarB ?? []).length, 0, 'Test 5: B no lista el avatar del miembro de A');
    const { data: folderA } = await cAdminA.storage.from('habit-photos').list(`${memberA.userId}/${habit.id}`);
    check((folderA ?? []).length, 1, 'Test 5: control — el admin de A sí lista las fotos de su miembro');
    const { data: avatarA } = await cAdminA.storage.from('avatars').list(memberA.userId);
    check((avatarA ?? []).length, 1, 'Test 5: control — el admin de A sí lista el avatar de su miembro');

    // ============================================================
    // Test 6 — [CONOCIDO] descarga por ruta conocida (opción 1 de Storage)
    // No es un fallo: es el límite aceptado de mantener los buckets públicos.
    // Invertir estos dos checks si se aplica la opción 2.
    // ============================================================
    console.log('\nTest 6 [CONOCIDO]: con buckets públicos, quien conoce la ruta descarga el fichero');
    const dl = await cMemberB.storage.from('habit-photos').download(photoPath);
    check(!dl.error, true, '[CONOCIDO] Test 6a: B descarga la foto de A con la ruta conocida (download() de un bucket público no aplica RLS) — pendiente de la opción 2');
    const pub = await fetch(photoUrl);
    check(pub.status, 200, '[CONOCIDO] Test 6b: la URL pública de la foto se abre sin sesión — pendiente de la opción 2');

    // ============================================================
    // Test 7 — delete_member no permite a un admin borrarse a sí mismo
    // ============================================================
    console.log('\nTest 7: delete_member rechaza el auto-borrado del admin');
    const { error: selfDelErr } = await cAdminA.rpc('delete_member', { member_id: adminA.userId });
    checkError(selfDelErr, /use_delete_own_account/, 'Test 7a: delete_member sobre uno mismo se rechaza');
    const { data: stillAdmin } = await supabaseAdmin.from('profiles').select('role').eq('id', adminA.userId).maybeSingle();
    check(stillAdmin?.role, 'admin', 'Test 7b: confirmado en BD — el admin sigue existiendo');

    // ============================================================
    // Test 8 — update_member_profile valida el rol
    // ============================================================
    console.log('\nTest 8: update_member_profile rechaza roles no válidos');
    const { error: badRoleErr } = await cAdminA.rpc('update_member_profile', {
      member_id: memberA.userId, new_full_name: `${TEST_PREFIX}MemberA`, new_email: 'ignorado', new_role: 'superadmin',
    });
    checkError(badRoleErr, /invalid_role/, 'Test 8a: new_role="superadmin" se rechaza');
    const { data: roleAfter } = await supabaseAdmin.from('profiles').select('role').eq('id', memberA.userId).single();
    check(roleAfter.role, 'usuario', 'Test 8b: confirmado en BD — el rol del miembro no cambió');
    const { error: badDirectRole } = await cAdminA.from('profiles').update({ role: 'superadmin' }).eq('id', memberA.userId);
    checkError(badDirectRole, /profiles_role_check/, 'Test 8c: el UPDATE directo del rol tampoco acepta valores no válidos (CHECK)');

    // ============================================================
    // Test 9 — update_member_avatar (y el CHECK) rechazan URLs ajenas
    // ============================================================
    console.log('\nTest 9: update_member_avatar solo acepta URLs del bucket avatars del propio miembro');
    const ownAvatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${memberA.userId}/avatar.jpg`;
    const foreignFolderUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${adminA.userId}/avatar.jpg`;
    const { error: extErr } = await cAdminA.rpc('update_member_avatar', { member_id: memberA.userId, new_avatar_url: 'https://example.com/x.jpg' });
    checkError(extErr, /invalid_avatar_url/, 'Test 9a: una URL de otro dominio se rechaza');
    const { error: otherFolderErr } = await cAdminA.rpc('update_member_avatar', { member_id: memberA.userId, new_avatar_url: foreignFolderUrl });
    checkError(otherFolderErr, /invalid_avatar_url/, 'Test 9b: una URL del bucket pero de la carpeta de otro usuario se rechaza');
    const { error: okAvatarErr } = await cAdminA.rpc('update_member_avatar', { member_id: memberA.userId, new_avatar_url: ownAvatarUrl });
    check(okAvatarErr, null, 'Test 9c: control — la URL de avatars/<miembro>/ se acepta');
    const { error: directErr } = await cMemberA.from('profiles').update({ avatar_url: 'https://example.com/x.jpg' }).eq('id', memberA.userId);
    checkError(directErr, /profiles_avatar_url_check/, 'Test 9d: el propio usuario tampoco puede guardarse una URL ajena con un UPDATE directo (CHECK)');
  } finally {
    console.log('\nLimpieza final...');
    for (const [bucket, paths] of Object.entries(uploaded)) {
      if (paths.length) {
        const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
        if (error) console.error(`  no se pudo borrar ${bucket}: ${error.message}`);
      }
    }
    if (teamId) await supabaseAdmin.from('teams').delete().eq('id', teamId);
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
