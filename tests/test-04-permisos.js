// Fase 4: permisos y RLS — profiles y aislamiento entre empresas.
// Ejecutar con: node tests/test-04-permisos.js
//
// No repite los tests de habits/habit_assignments/habit_validators ya
// cubiertos en la Fase 2 — esta fase es específicamente sobre profiles
// y aislamiento cross-company.

const {
  SUPABASE_URL,
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
  console.log('== Fase 4: permisos y RLS (profiles, aislamiento entre empresas) ==\n');

  console.log('Limpieza previa (restos de un run anterior fallido)...');
  await cleanupTestData();
  console.log('OK\n');

  try {
    // ---- Setup: dos empresas (para aislamiento cross-tenant) ----
    console.log('Setup: creando adminA + memberA (Company A) y adminB (Company B)');
    const adminA = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyA-${Date.now()}`);
    const adminB = await createTestCompanyAndAdmin(`${TEST_PREFIX}CompanyB-${Date.now()}`);

    const memberAEmail = `${TEST_PREFIX}${Date.now()}-memberA@habitapp-test.local`;
    const codeA = Math.floor(100000 + Math.random() * 900000).toString();
    const { error: codeErr } = await supabaseAdmin.from('activation_codes').insert({
      code: codeA, full_name: `${TEST_PREFIX}MemberA`, email: memberAEmail, company_id: adminA.companyId,
    });
    if (codeErr) throw codeErr;
    const memberA = await joinAsTestMember(codeA);

    const clientAdminA = await getClientForUser(adminA.email, adminA.password);
    const clientMemberA = await getClientForUser(memberA.email, memberA.password);
    const clientAdminB = await getClientForUser(adminB.email, adminB.password);
    console.log('Setup OK\n');

    // ============================================================
    // Test 0 — GUARDA DE REGRESIÓN de la vulnerabilidad crítica
    // (escalada de privilegios, fix aplicado el 2026-09-17, ver la
    // sección destacada en este mismo README). Si alguien vuelve a tocar
    // la policy "users can update own profile" o el trigger
    // prevent_self_role_company_escalation en el futuro sin darse cuenta
    // de por qué existen, este test debe fallar y avisar.
    // ============================================================
    console.log('Test 0 [GUARDA DE REGRESIÓN]: un usuario normal NO puede auto-ascenderse ni cambiarse de empresa');
    const { error: err0a } = await clientMemberA.from('profiles').update({ role: 'admin' }).eq('id', memberA.userId);
    checkRejected(err0a, 'Test 0a: UPDATE de role="admin" sobre uno mismo sigue bloqueado por el trigger');

    const { error: err0b } = await clientMemberA.from('profiles').update({ company_id: adminB.companyId }).eq('id', memberA.userId);
    checkRejected(err0b, 'Test 0b: UPDATE de company_id sobre uno mismo (saltar a otra empresa) sigue bloqueado por el trigger');

    const { data: memberAUnchanged, error: memberAUnchangedErr } = await supabaseAdmin
      .from('profiles').select('role, company_id').eq('id', memberA.userId).single();
    if (memberAUnchangedErr) throw memberAUnchangedErr;
    check(memberAUnchanged.role, 'usuario', 'Test 0c: confirmado en BD — el role de memberA no cambió');
    check(memberAUnchanged.company_id, adminA.companyId, 'Test 0d: confirmado en BD — el company_id de memberA no cambió');

    // ---- Test 1: un usuario normal no puede auto-ascenderse (matriz de permisos de profiles) ----
    console.log('\nTest 1: un usuario normal no puede cambiar su propio role (parte de la matriz de permisos de profiles)');
    const { error: err1 } = await clientMemberA.from('profiles').update({ role: 'admin' }).eq('id', memberA.userId);
    checkRejected(err1, 'Test 1: UPDATE de profiles.role por el propio usuario es rechazado');

    // ---- Test 2: un usuario normal no puede editar el perfil de OTRO ----
    // OJO: un UPDATE bloqueado por RLS vía la cláusula USING (no WITH CHECK)
    // NO lanza ningún error — Postgres/PostgREST simplemente no encuentra
    // ninguna fila que la policy deje ver como destino, así que el UPDATE
    // "tiene éxito" afectando a 0 filas (data: [], error: null, status 200).
    // Es distinto de un INSERT rechazado (ese sí lanza error explícito por
    // WITH CHECK). Hay que comprobar el nº de filas afectadas / que el dato
    // no cambió, no el campo `error` — verificado explícitamente antes de
    // escribir este test, no asumido.
    console.log('\nTest 2: un usuario normal no puede editar el perfil de otro miembro de su misma empresa');
    const { data: data2 } = await clientMemberA
      .from('profiles').update({ full_name: `${TEST_PREFIX}Hacked` }).eq('id', adminA.userId).select();
    check(data2.length, 0, 'Test 2: el UPDATE no afecta a ninguna fila (RLS lo filtra vía USING, sin lanzar error)');
    const { data: adminAAfter2 } = await supabaseAdmin.from('profiles').select('full_name').eq('id', adminA.userId).single();
    check(adminAAfter2.full_name.startsWith(TEST_PREFIX + 'Hacked'), false, 'Test 2: confirmado en BD — el full_name del admin no cambió');

    // ---- Test 3: el admin SÍ puede editar el avatar de otro miembro de su empresa ----
    // Este era un bug real ya corregido en la auditoría de RLS de esta sesión
    // (antes la policy de UPDATE no comprobaba company_id, y en otro punto no
    // existía ninguna excepción de admin en absoluto). La referencia no está
    // en un comentario de código — está documentada en docs/database.md.
    // Desde el 2026-09-28 el CHECK profiles_avatar_url_check solo admite URLs
    // del bucket avatars en la carpeta del propio miembro: se usa la misma
    // forma de URL que genera AdminScreen (getPublicUrl de <id>/avatar.jpg).
    // Que una URL ajena se rechace lo cubre la Fase 9.
    console.log('\nTest 3: el admin SÍ puede editar el avatar_url de otro miembro de su empresa (bug ya corregido, confirmar que sigue así)');
    const memberAvatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${memberA.userId}/avatar.jpg`;
    const { data: data3, error: err3 } = await clientAdminA
      .from('profiles').update({ avatar_url: memberAvatarUrl }).eq('id', memberA.userId).select('id');
    if (err3) {
      results.push({ pass: false, message: `Test 3: FALLO — el admin no pudo editar el avatar de su miembro: ${err3.message}` });
    } else {
      check(data3.length, 1, 'Test 3: el UPDATE del admin afecta a la fila de su miembro (no la filtra RLS)');
      const { data: memberAvatar, error: e } = await supabaseAdmin.from('profiles').select('avatar_url').eq('id', memberA.userId).single();
      if (e) throw e;
      check(memberAvatar.avatar_url, memberAvatarUrl, 'Test 3: confirmado en BD — el admin actualizó el avatar_url de su miembro');
    }

    // ---- Test 4: aislamiento cross-empresa en profiles ----
    // Mismo matiz que el test 2: RLS lo bloquea vía USING, sin error explícito.
    console.log('\nTest 4: un admin de OTRA empresa no puede editar un perfil ajeno');
    const { data: data4 } = await clientAdminB
      .from('profiles').update({ full_name: `${TEST_PREFIX}Hijacked` }).eq('id', memberA.userId).select();
    check(data4.length, 0, 'Test 4: el UPDATE no afecta a ninguna fila (aislamiento multi-tenant vía USING, sin lanzar error)');
    const { data: memberAAfter4 } = await supabaseAdmin.from('profiles').select('full_name').eq('id', memberA.userId).single();
    check(memberAAfter4.full_name.startsWith(TEST_PREFIX + 'Hijacked'), false, 'Test 4: confirmado en BD — el full_name de memberA no cambió');

    // ---- Test 5: SELECT de habits de otra empresa — BLOQUEADO desde 2026-09-28 ----
    // INVERTIDO el 2026-09-28. Hasta entonces la policy SELECT de habits era
    // qual=true (lectura abierta, incluso sin sesión) y este test confirmaba
    // ese diseño aceptado. Con registro abierto a desconocidos se cerró:
    // sql/2026-09-28e_lecturas_por_empresa.sql (company_id = my_company_id()).
    // Ahora confirma el aislamiento. Un SELECT filtrado por RLS no da error,
    // devuelve 0 filas; por eso se comprueba también que B sí lee su propio
    // hábito (si no, 0 filas no demostraría nada).
    console.log('\nTest 5: un admin de OTRA empresa NO puede leer los habits de una empresa ajena (aislamiento, desde 2026-09-28)');
    const habitB = `${TEST_PREFIX}HabitB-${Date.now()}`;
    const { error: habitBErr } = await supabaseAdmin.from('habits').insert({
      title: habitB, company_id: adminB.companyId, created_by: adminB.userId, is_active: true,
    });
    if (habitBErr) throw habitBErr;
    const { data: crossRead, error: crossReadErr } = await clientAdminA
      .from('habits').select('title').eq('company_id', adminB.companyId);
    if (crossReadErr) throw crossReadErr;
    check(crossRead.length, 0, 'Test 5a: el admin de la empresa A NO recibe ningún hábito de la empresa B');
    const { data: ownRead, error: ownReadErr } = await clientAdminB
      .from('habits').select('title').eq('company_id', adminB.companyId);
    if (ownReadErr) throw ownReadErr;
    check(ownRead.some((h) => h.title === habitB), true, 'Test 5b: control — el admin de B sí lee su propio hábito');

    // ---- Test 6: autoeliminación de cuenta (delete_own_account, sin cascada completa — eso es Fase 6) ----
    // No es auth.admin.deleteUser: esa API solo es alcanzable con la Service
    // Role Key, nunca desde un cliente autenticado como el propio usuario.
    // ProfileScreen.js llama a la RPC delete_own_account() autenticado como
    // el propio usuario — es lo que se testea aquí.
    console.log('\nTest 6: un usuario normal se autoelimina vía delete_own_account() (sin verificar cascada completa, eso es Fase 6)');
    const memberBEmail = `${TEST_PREFIX}${Date.now()}-memberB@habitapp-test.local`;
    const codeB = Math.floor(100000 + Math.random() * 900000).toString();
    const { error: codeBErr } = await supabaseAdmin.from('activation_codes').insert({
      code: codeB, full_name: `${TEST_PREFIX}MemberB`, email: memberBEmail, company_id: adminA.companyId,
    });
    if (codeBErr) throw codeBErr;
    const memberToDelete = await joinAsTestMember(codeB);
    const clientMemberToDelete = await getClientForUser(memberToDelete.email, memberToDelete.password);

    const { error: deleteErr } = await clientMemberToDelete.rpc('delete_own_account');
    if (deleteErr) throw deleteErr;

    const { data: profileAfterDelete, error: profileAfterDeleteErr } = await supabaseAdmin
      .from('profiles').select('id').eq('id', memberToDelete.userId).maybeSingle();
    if (profileAfterDeleteErr) throw profileAfterDeleteErr;
    check(profileAfterDelete, null, 'Test 6: tras delete_own_account(), el profile del propio usuario ha desaparecido');
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
