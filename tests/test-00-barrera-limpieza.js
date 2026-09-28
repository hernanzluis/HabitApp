// Fase 0: canario de la barrera de seguridad de cleanupTestData().
// Ejecutar con: node tests/test-00-barrera-limpieza.js
//
// cleanupTestData() usa la Service Role Key y borra usuarios de Auth con
// auth.admin.deleteUser. Este test comprueba, con usuarios de Auth reales,
// que nunca borra uno cuyo email en Auth no lleve el prefijo zztest-:
//   A) canario sin profile (la vía de "huérfanos" de cleanupTestData)
//   B) canario CON un profile cuyo profiles.email sí lleva el prefijo
//      (la vía de userIds, que parte de profiles.email — ver tests/README.md,
//      hallazgo de la Fase 0)
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

  try {
    // ---- Test 1: canario sin profile ----
    console.log('Test 1: usuario de Auth sin prefijo y sin profile');
    const a = await createCanary();
    canaries.push(a);
    await cleanupTestData();
    check(await authUserExists(a.id), true, `Test 1: el canario ${a.email} sigue existiendo tras cleanupTestData()`);

    // ---- Test 2: canario con profile de email zztest- ----
    console.log('\nTest 2: usuario de Auth sin prefijo cuyo profile SÍ lleva email zztest-');
    const b = await createCanary();
    canaries.push(b);
    const { error: profErr } = await supabaseAdmin.from('profiles').insert({
      id: b.id,
      email: `${TEST_PREFIX}desincronizado-${Date.now()}@habitapp-test.local`,
      full_name: 'canary',
      role: 'usuario',
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
  } finally {
    console.log('\nLimpieza de los canarios (por id)...');
    for (const id of canaryProfileIds) {
      const { error } = await supabaseAdmin.from('profiles').delete().eq('id', id).eq('full_name', 'canary');
      if (error) console.error(`  no se pudo borrar el profile del canario ${id}: ${error.message}`);
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
