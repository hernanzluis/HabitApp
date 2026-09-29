// Fase 0: canario de la barrera de seguridad de cleanupTestData().
// Ejecutar con: node tests/test-00-barrera-limpieza.js
//
// cleanupTestData() usa la Service Role Key y borra usuarios de Auth con
// auth.admin.deleteUser. Este test comprueba, con usuarios de Auth reales,
// que nunca borra uno cuyo email en Auth no lleve el prefijo zztest-:
//   A) canario sin profile (la vía de "huérfanos" de cleanupTestData)
//   B) canario CON profile, miembro de una company zztest- (la vía de userIds
//      que parte de "miembros de una company de test", sea cual sea su email)
// Hasta el 2026-09-28 el caso B era un profile con email zztest- sobre un
// usuario de Auth canary- (desfase profiles.email ≠ auth.users.email, ver
// tests/README.md, hallazgo de la Fase 0). Desde ese día el trigger
// profiles_email_from_auth hace imposible ese desfase (lo confirma el test
// 3), así que el caso B vigila la otra vía por la que un usuario real podría
// acabar en userIds.
// Los canarios usan el prefijo canary-, nunca zztest-, y un dominio no real.
// Cada uno se borra explícitamente por su id en un finally.
//
// Nota: cleanupTestData() también vacía activation_attempts entera y borra
// todo lo que lleve zztest- (ver punto 5 de tests/README.md). Este test no
// crea ni toca nada más aparte de sus canarios.

const {
  TEST_PREFIX,
  supabaseAdmin,
  randomPassword,
  cleanupTestData,
  assertEqual,
} = require('./test-helpers');

const results = [];
function check(actual, expected, message) {
  const pass = assertEqual(actual, expected, message);
  results.push({ pass, message });
}

function canaryEmail() {
  return `canary-${Date.now()}-${Math.floor(Math.random() * 1e6)}@habitapp-test.local`;
}

async function createCanary() {
  const email = canaryEmail();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: randomPassword(), email_confirm: true });
  if (error) throw new Error(`no se pudo crear el canario ${email}: ${error.message}`);
  return { id: data.user.id, email };
}

async function authUserExists(id) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  if (error && !/not.*found/i.test(error.message)) throw error;
  return !!data?.user;
}

async function run() {
  console.log('== Fase 0: canario de la barrera de cleanupTestData ==\n');
  const canaries = [];
  const canaryProfileIds = [];
  let canaryCompanyId = null;

  try {
    // ---- Test 1: canario sin profile ----
    console.log('Test 1: usuario de Auth sin prefijo y sin profile');
    const a = await createCanary();
    canaries.push(a);
    await cleanupTestData();
    check(await authUserExists(a.id), true, `Test 1: el canario ${a.email} sigue existiendo tras cleanupTestData()`);

    // ---- Test 2: canario miembro de una company zztest- ----
    console.log('\nTest 2: usuario de Auth sin prefijo, con profile en una company zztest-');
    const b = await createCanary();
    canaries.push(b);
    const { data: company, error: compErr } = await supabaseAdmin.from('companies')
      .insert({ name: `${TEST_PREFIX}CanaryCompany-${Date.now()}` }).select('id').single();
    if (compErr) throw new Error(`no se pudo crear la company del canario: ${compErr.message}`);
    canaryCompanyId = company.id;
    const { error: profErr } = await supabaseAdmin.from('profiles').insert({
      id: b.id, email: b.email, full_name: 'canary', role: 'usuario', company_id: company.id,
    });
    if (profErr) throw new Error(`no se pudo crear el profile del canario: ${profErr.message}`);
    canaryProfileIds.push(b.id);

    let cleanupError = null;
    try {
      await cleanupTestData();
    } catch (e) {
      cleanupError = e;
    }
    check(!!cleanupError && /ABORTADO/.test(cleanupError.message), true,
      `Test 2a: cleanupTestData() aborta en vez de borrar (${cleanupError ? cleanupError.message : 'no abortó'})`);
    check(await authUserExists(b.id), true, `Test 2b: el canario ${b.email} sigue existiendo en Auth`);
    const { data: bProfile } = await supabaseAdmin.from('profiles').select('id').eq('id', b.id).maybeSingle();
    check(!!bProfile, true, 'Test 2c: su profile tampoco se ha borrado (aborta ANTES de borrar nada)');
    const { data: bCompany } = await supabaseAdmin.from('companies').select('id').eq('id', company.id).maybeSingle();
    check(!!bCompany, true, 'Test 2d: ni la company zztest- de la que es miembro');

    // ---- Test 3: el desfase profiles.email ≠ auth.users.email ya no se puede crear ----
    console.log('\nTest 3: el antiguo escenario del canario (profile con email zztest- sobre un usuario canary-) ya no se puede crear');
    const { error: updErr } = await supabaseAdmin.from('profiles')
      .update({ email: `${TEST_PREFIX}desincronizado-${Date.now()}@habitapp-test.local` }).eq('id', b.id);
    if (updErr) throw new Error(`UPDATE de email del canario: ${updErr.message}`);
    const { data: bAfter } = await supabaseAdmin.from('profiles').select('email').eq('id', b.id).single();
    check(bAfter.email, b.email, 'Test 3: incluso con la Service Role Key, profiles.email vuelve al email de Auth (trigger profiles_email_from_auth)');
  } finally {
    console.log('\nLimpieza de los canarios (por id)...');
    for (const id of canaryProfileIds) {
      const { error } = await supabaseAdmin.from('profiles').delete().eq('id', id).eq('full_name', 'canary');
      if (error) console.error(`  no se pudo borrar el profile del canario ${id}: ${error.message}`);
    }
    if (canaryCompanyId) {
      const { error } = await supabaseAdmin.from('companies').delete().eq('id', canaryCompanyId).like('name', `${TEST_PREFIX}CanaryCompany-%`);
      if (error) console.error(`  no se pudo borrar la company del canario: ${error.message}`);
    }
    for (const c of canaries) {
      if (!c.email.startsWith('canary-')) throw new Error(`se iba a borrar ${c.email}, que no es un canario`);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(c.id);
      if (error && !/not.*found/i.test(error.message)) console.error(`  no se pudo borrar el canario ${c.email}: ${error.message}`);
    }
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
