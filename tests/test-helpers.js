// Helper compartido para los scripts de test de backend en tests/.
// Se ejecutan directamente con `node tests/xxx.js` (sin Jest, sin framework).
//
// Usa la Service Role Key de Supabase (SUPABASE_SERVICE_ROLE_KEY en .env, en la
// raíz del repo) para saltarse RLS al crear/borrar datos de prueba. Esta clave
// NUNCA debe usarse fuera de tests/ (ni en lib/supabase.js, ni en screens/, ni
// en la web) — ese código sigue usando siempre la anon key.

const path = require('path');
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const SUPABASE_URL = 'https://uvsngemnftpysjvxslhu.supabase.co';
// Misma anon key pública que lib/supabase.js — no es un secreto, es la que usa
// cualquier cliente de la app. Se usa aquí para autenticarse COMO un usuario de
// test concreto y así poder probar el comportamiento real de RLS (el cliente
// con la Service Role Key lo salta por completo y no sirve para esto).
const SUPABASE_ANON_KEY = 'sb_publishable_5szIB7W3P5G6XFFYyFjAfw_TwpKNFnp';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Falta SUPABASE_SERVICE_ROLE_KEY. Debe estar en .env en la raíz del repo (nunca hardcodeada).'
  );
}

// Node 20 no trae WebSocket nativo (sí Node 22+); @supabase/supabase-js lo
// necesita para inicializar su cliente de Realtime aunque no lo usemos aquí.
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});

const TEST_PREFIX = 'zztest-';

function randomPassword() {
  return `Test-${Math.random().toString(36).slice(2)}-Aa1!`;
}

function testEmail() {
  return `${TEST_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}@habitapp-test.local`;
}

// Crea un usuario vía Admin API y lo registra pasando por las RPCs reales de
// alta de la app (las mismas que SignUpScreen.js). Solo soporta role: 'admin'
// (crea una company nueva vía handle_new_user_registration, igual que el modo
// "Crear grupo" del signup) — para un segundo usuario que se une a una company
// ya existente, usa joinAsTestMember(activationCode).
async function createTestUser({ role, companyName }) {
  if (role !== 'admin') {
    throw new Error(
      `createTestUser: role "${role}" no soportado — solo "admin" (crea company nueva). ` +
      'Para unir un miembro a una company existente usa joinAsTestMember(activationCode).'
    );
  }
  if (!companyName || !companyName.startsWith(TEST_PREFIX)) {
    throw new Error(`createTestUser: companyName debe empezar por "${TEST_PREFIX}" (recibido: "${companyName}")`);
  }

  const email = testEmail();
  const password = randomPassword();

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) {
    throw new Error(`createTestUser: fallo creando auth user (${email}): ${authError.message}`);
  }
  const userId = authData.user.id;

  // Mismo RPC que SignUpScreen.onSignUp (modo "Crear grupo").
  const { error: rpcError } = await supabaseAdmin.rpc('handle_new_user_registration', {
    user_id: userId,
    user_email: email,
    user_full_name: `${TEST_PREFIX}Admin`,
    company_name: companyName,
  });
  if (rpcError) {
    throw new Error(`createTestUser: fallo en handle_new_user_registration (${email}): ${rpcError.message}`);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .single();
  if (profileError) {
    throw new Error(`createTestUser: no se pudo leer el profile recién creado (${userId}): ${profileError.message}`);
  }

  return { userId, email, password, companyId: profile.company_id };
}

// Wrapper sobre createTestUser específico para el primer admin de una company nueva.
async function createTestCompanyAndAdmin(companyName) {
  return createTestUser({ role: 'admin', companyName });
}

// Simula el flujo de activación con código (paso 1 + paso 2 de SignUpScreen,
// modo "activate"): check_activation_code -> auth user con ESE email exacto
// (el que el admin puso al generar el código) -> handle_activation_registration.
async function joinAsTestMember(activationCode) {
  const { data: checkData, error: checkError } = await supabaseAdmin.rpc('check_activation_code', {
    p_code: activationCode,
  });
  if (checkError) {
    throw new Error(`joinAsTestMember: check_activation_code falló para "${activationCode}": ${checkError.message}`);
  }
  const record = checkData?.[0];
  if (!record) {
    throw new Error(
      `joinAsTestMember: check_activation_code no devolvió ninguna fila para "${activationCode}" ` +
      '(código inválido, ya usado, expirado o bloqueado)'
    );
  }

  const password = randomPassword();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: record.email,
    password,
    email_confirm: true,
  });
  if (authError) {
    throw new Error(`joinAsTestMember: fallo creando auth user (${record.email}): ${authError.message}`);
  }
  const userId = authData.user.id;

  const { error: rpcError } = await supabaseAdmin.rpc('handle_activation_registration', {
    user_id: userId,
    user_email: record.email,
    user_full_name: record.full_name,
    activation_code: activationCode,
  });
  if (rpcError) {
    throw new Error(`joinAsTestMember: fallo en handle_activation_registration (${record.email}): ${rpcError.message}`);
  }

  return { userId, email: record.email, password, companyId: record.company_id };
}

// Inserta un habit_logs con created_at en el pasado (hoy - daysAgo días),
// simulando que el hábito se completó ese día. status: 'validated' o 'pending'
// según el flag `validated` (columna real de habit_logs; no crea votos en
// habit_validations, que es otro mecanismo — ver database.md).
async function advanceHabitLog({ habitId, userId, daysAgo, validated = false }) {
  if (!habitId || !userId || daysAgo == null) {
    throw new Error('advanceHabitLog: habitId, userId y daysAgo son obligatorios');
  }
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('habit_logs')
    .insert({
      habit_id: habitId,
      user_id: userId,
      created_at: createdAt,
      status: validated ? 'validated' : 'pending',
    })
    .select('id')
    .single();
  if (error) {
    throw new Error(
      `advanceHabitLog: fallo insertando habit_log (habit ${habitId}, user ${userId}, hace ${daysAgo} días): ${error.message}`
    );
  }
  return data.id;
}

// Varios advanceHabitLog() en una sola llamada, uno por cada valor de
// daysAgoList. Se pasa una lista explícita (no un simple "N días") para poder
// expresar tanto rachas consecutivas ([0,1,2]) como con huecos ([0,2], salta
// el día 1) con la misma función — el criterio de qué cuenta como "racha" o
// "hueco" lo decide calculateStreak (en HabitDetailScreen.js), no esta función.
async function buildStreak({ habitId, userId, daysAgoList, validated = false }) {
  const ids = [];
  for (const daysAgo of daysAgoList) {
    ids.push(await advanceHabitLog({ habitId, userId, daysAgo, validated }));
  }
  return ids;
}

// INSERT en habit_rewards.
async function createReward({ habitId, streakTarget, description }) {
  const { data, error } = await supabaseAdmin
    .from('habit_rewards')
    .insert({ habit_id: habitId, streak_target: streakTarget, description })
    .select('id')
    .single();
  if (error) {
    throw new Error(
      `createReward: fallo insertando habit_reward (habit ${habitId}, target ${streakTarget}): ${error.message}`
    );
  }
  return data.id;
}

// Borra en cascada TODO lo que tenga email o company.name con el prefijo de
// test. Rechaza (lanza) si algo que va a usar como origen del borrado NO
// tiene el prefijo — es la única red de seguridad contra borrar datos reales,
// dado que esta clave salta RLS. No relajar nunca esta comprobación.
// activation_attempts es independiente de los datos de test "normales": no
// tiene email/company (solo ip_address + attempted_at), así que no puede
// marcarse con TEST_PREFIX ni entra en la barrera de seguridad de
// cleanupTestData(). Se borra entera, siempre, incondicionalmente — existe
// solo para el rate limiting de check_activation_code, no contiene ningún
// dato de usuario real, y se autoexpira igualmente en 1h. Expuesta aparte
// (no solo dentro de cleanupTestData) porque una sola fase puede necesitar
// resetear el contador VARIAS veces durante su propia ejecución si hace
// muchas llamadas a check_activation_code seguidas (ver Fase 5) — llamar a
// cleanupTestData() completo a media prueba borraría también las companies/
// profiles que esa prueba todavía necesita. Ver tests/README.md.
async function resetActivationRateLimit() {
  const { error } = await supabaseAdmin.from('activation_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`resetActivationRateLimit: fallo borrando activation_attempts: ${error.message}`);
}

async function cleanupTestData() {
  await resetActivationRateLimit();

  const { data: testCompanies, error: companiesErr } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .like('name', `${TEST_PREFIX}%`);
  if (companiesErr) throw new Error(`cleanupTestData: no se pudo leer companies: ${companiesErr.message}`);

  const { data: testProfiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, company_id')
    .like('email', `${TEST_PREFIX}%`);
  if (profilesErr) throw new Error(`cleanupTestData: no se pudo leer profiles: ${profilesErr.message}`);

  // Barrera de seguridad: cualquier fila usada como origen de un borrado DEBE
  // llevar el prefijo de test. Si algo se cuela sin él (filtro roto, bug),
  // abortamos ANTES de borrar nada.
  for (const c of testCompanies ?? []) {
    if (!c.name || !c.name.startsWith(TEST_PREFIX)) {
      throw new Error(
        `cleanupTestData: ABORTADO sin borrar nada — company ${c.id} ("${c.name}") no tiene el prefijo "${TEST_PREFIX}"`
      );
    }
  }
  for (const p of testProfiles ?? []) {
    if (!p.email || !p.email.startsWith(TEST_PREFIX)) {
      throw new Error(
        `cleanupTestData: ABORTADO sin borrar nada — profile ${p.id} ("${p.email}") no tiene el prefijo "${TEST_PREFIX}"`
      );
    }
  }

  const companyIds = (testCompanies ?? []).map((c) => c.id);

  // Cualquier miembro de una company de test cuenta como test aunque (no
  // debería pasar nunca) su email no llevara el prefijo por algún motivo.
  const { data: membersOfTestCompanies, error: membersErr } = companyIds.length
    ? await supabaseAdmin.from('profiles').select('id, email, company_id').in('company_id', companyIds)
    : { data: [], error: null };
  if (membersErr) throw new Error(`cleanupTestData: no se pudo leer miembros de companies de test: ${membersErr.message}`);

  for (const m of membersOfTestCompanies ?? []) {
    if (!m.email || !m.email.startsWith(TEST_PREFIX)) {
      throw new Error(
        `cleanupTestData: ABORTADO sin borrar nada — profile ${m.id} ("${m.email}") pertenece a una company de test ` +
        `pero su email no tiene el prefijo "${TEST_PREFIX}"`
      );
    }
  }

  const userIds = [...new Set([
    ...(testProfiles ?? []).map((p) => p.id),
    ...(membersOfTestCompanies ?? []).map((p) => p.id),
  ])];

  if (userIds.length === 0 && companyIds.length === 0) {
    return { deleted: false, reason: 'no había datos de test que limpiar' };
  }

  // Orden de borrado en cascada (el mismo ya usado manualmente en Supabase):
  // habit_logs -> habit_assignments -> habit_validators -> habit_validations
  // -> activation_codes -> invitations -> habits -> categories -> profiles
  // -> companies -> auth.users
  // (habit_rewards no tiene columna de usuario/company propia: se limpia solo
  // por CASCADE al borrar habits en el paso 7)

  if (userIds.length) {
    const { error } = await supabaseAdmin.from('habit_logs').delete().in('user_id', userIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando habit_logs: ${error.message}`);
  }
  if (userIds.length) {
    const { error } = await supabaseAdmin.from('habit_assignments').delete().in('user_id', userIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando habit_assignments: ${error.message}`);
  }
  if (userIds.length) {
    const { error } = await supabaseAdmin.from('habit_validators').delete().in('user_id', userIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando habit_validators: ${error.message}`);
  }
  if (userIds.length) {
    const { error } = await supabaseAdmin.from('habit_validations').delete().in('validator_id', userIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando habit_validations: ${error.message}`);
  }
  if (companyIds.length) {
    const { error } = await supabaseAdmin.from('activation_codes').delete().in('company_id', companyIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando activation_codes: ${error.message}`);
  }
  if (companyIds.length) {
    const { error } = await supabaseAdmin.from('invitations').delete().in('company_id', companyIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando invitations: ${error.message}`);
  }
  if (companyIds.length) {
    const { error } = await supabaseAdmin.from('habits').delete().in('company_id', companyIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando habits: ${error.message}`);
  }
  if (companyIds.length) {
    const { error } = await supabaseAdmin.from('categories').delete().in('company_id', companyIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando categories: ${error.message}`);
  }
  if (userIds.length) {
    const { error } = await supabaseAdmin.from('profiles').delete().in('id', userIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando profiles: ${error.message}`);
  }
  if (companyIds.length) {
    const { error } = await supabaseAdmin.from('companies').delete().in('id', companyIds);
    if (error) throw new Error(`cleanupTestData: fallo borrando companies: ${error.message}`);
  }
  // Usuarios huérfanos: si alguna vez una RPC de alta crea el auth.user y
  // LUEGO falla antes de insertar su profiles (por ejemplo, handle_activation_
  // registration lanzando 'limit_members_reached' tras el auth.signUp — el
  // escenario que fuerza a propósito el test 4 de la Fase 5), ese auth.user
  // no tiene ninguna fila en profiles y por tanto no aparecería en userIds.
  // Se buscan aparte, directamente en auth.users, por email con el prefijo.
  const { data: authUsersPage, error: authUsersErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authUsersErr) throw new Error(`cleanupTestData: no se pudo listar auth.users: ${authUsersErr.message}`);
  const orphanedTestUserIds = (authUsersPage?.users ?? [])
    .filter((u) => u.email && u.email.startsWith(TEST_PREFIX) && !userIds.includes(u.id))
    .map((u) => u.id);

  const allUserIdsToDelete = [...userIds, ...orphanedTestUserIds];
  for (const id of allUserIdsToDelete) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) {
      throw new Error(`cleanupTestData: fallo borrando auth.user ${id}: ${error.message}`);
    }
  }

  return {
    deleted: true,
    companiesDeleted: companyIds.length,
    usersDeleted: userIds.length,
    orphanedAuthUsersDeleted: orphanedTestUserIds.length,
  };
}

// Crea un cliente autenticado COMO un usuario de test concreto (email/password
// devueltos por createTestUser/joinAsTestMember), usando la anon key real —
// para probar el comportamiento REAL de RLS desde el punto de vista de ese
// usuario. El cliente con la Service Role Key nunca sirve para esto: la salta
// por completo, así que "funciona" con él no dice nada sobre lo que puede
// hacer un usuario real de la app.
async function getClientForUser(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`getClientForUser: no se pudo autenticar como ${email}: ${error.message}`);
  }
  return client;
}

function assertEqual(actual, expected, message) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`      esperado: ${JSON.stringify(expected)}`);
    console.error(`      obtenido: ${JSON.stringify(actual)}`);
  }
  return pass;
}

// Para los casos "esto debería fallar por RLS" — pásale el `error` que
// devuelve la llamada de supabase-js. pass = hubo error (RLS rechazó).
function assertRejected(error, message) {
  const pass = !!error;
  if (pass) {
    console.log(`  ✓ ${message} (rechazado correctamente: ${error.message})`);
  } else {
    console.error(`  ✗ ${message}`);
    console.error('      esperado: la operación debía ser rechazada (RLS)');
    console.error('      obtenido: no hubo error — la operación tuvo éxito');
  }
  return pass;
}

module.exports = {
  TEST_PREFIX,
  supabaseAdmin,
  createTestUser,
  createTestCompanyAndAdmin,
  joinAsTestMember,
  advanceHabitLog,
  buildStreak,
  createReward,
  getClientForUser,
  resetActivationRateLimit,
  cleanupTestData,
  assertEqual,
  assertRejected,
};
