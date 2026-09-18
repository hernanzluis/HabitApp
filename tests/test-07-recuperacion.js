// Fase 7: recuperación de contraseña (ForgotPasswordScreen + ResetPasswordScreen).
// Cubre la parte de backend verificable sin correo real: generar un enlace de
// recovery real vía la Admin API, canjear su token exactamente como lo haría
// el enlace del correo, cambiar la contraseña, y confirmar que el login real
// funciona con la nueva y falla con la antigua. También verifica en crudo el
// parser (`getQueryParams` de expo-auth-session) que usa RootNavigator.js para
// leer el deep link — es una librería externa, no una réplica local, así que
// esto prueba el comportamiento real, no una suposición sobre cómo funciona.
// Ejecutar con: node tests/test-07-recuperacion.js

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { getQueryParams } = require('expo-auth-session/build/QueryParams');

const {
  TEST_PREFIX,
  supabaseAdmin,
  createTestCompanyAndAdmin,
  cleanupTestData,
  assertEqual,
  assertRejected,
} = require('./test-helpers');

const SUPABASE_URL = 'https://uvsngemnftpysjvxslhu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5szIB7W3P5G6XFFYyFjAfw_TwpKNFnp';

function getAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  });
}

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
  console.log('== Fase 7: tests de recuperación de contraseña ==\n');

  try {
    console.log('Setup: creando admin de prueba...');
    const admin = await createTestCompanyAndAdmin(`${TEST_PREFIX}Company-Recovery`);
    const oldPassword = admin.password;
    const newPassword = `${admin.password}-Nueva1`;

    // ---- Test 0: la URL de redirect está registrada en Supabase ----
    // Si "habitapp://reset-password" NO está en Authentication > URL
    // Configuration > Redirect URLs del dashboard, Supabase ignora el
    // redirectTo pedido y usa el Site URL por defecto en su lugar (sin
    // avisar con un error) — así que el único enlace real que le llegaría al
    // usuario apuntaría a una URL que la app nunca abre. Esto es
    // configuración del dashboard, no algo que este script pueda arreglar.
    console.log('\nTest 0: "habitapp://reset-password" está registrada como Redirect URL en Supabase');
    const { data: registrationCheck, error: registrationCheckError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: admin.email,
      options: { redirectTo: 'habitapp://reset-password' },
    });
    if (registrationCheckError) throw new Error(`generateLink (test 0) falló: ${registrationCheckError.message}`);
    check(
      registrationCheck.properties.redirect_to,
      'habitapp://reset-password',
      'Test 0: Supabase respeta el redirectTo "habitapp://reset-password" (si falla, hay que añadirlo en el dashboard, ver tests/README.md)'
    );

    // ---- Test 1: parser real del deep link (expo-auth-session, no una réplica) ----
    console.log('\nTest 1: getQueryParams() parsea el formato real de enlace de recovery');
    const recoveryUrl = 'habitapp://reset-password#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer&type=recovery';
    const parsedOk = getQueryParams(recoveryUrl);
    check(parsedOk.errorCode, null, 'Test 1a: un enlace de recovery válido no reporta errorCode');
    check(parsedOk.params.access_token, 'abc123', 'Test 1b: extrae access_token del fragmento');
    check(parsedOk.params.type, 'recovery', 'Test 1c: extrae type=recovery del fragmento');

    const errorUrl = 'habitapp://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    const parsedError = getQueryParams(errorUrl);
    check(parsedError.params.error, 'access_denied', 'Test 1d: un enlace caducado/inválido se detecta vía params.error');
    check(!!parsedError.params.access_token, false, 'Test 1e: un enlace de error no trae access_token');

    // ---- Test 2: generar un enlace de recovery REAL y canjear el token ----
    console.log('\nTest 2: generateLink(recovery) + verifyOtp(token_hash) con un cliente anónimo real');
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: admin.email,
    });
    if (linkError) throw new Error(`generateLink falló: ${linkError.message}`);
    const hashedToken = linkData.properties.hashed_token;
    check(typeof hashedToken, 'string', 'Test 2a: generateLink devuelve un hashed_token real');

    const recoveryClient = getAnonClient();
    const { data: verifyData, error: verifyError } = await recoveryClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'recovery',
    });
    check(verifyError, null, 'Test 2b: verifyOtp con el token real no da error');
    check(!!verifyData?.session?.access_token, true, 'Test 2c: verifyOtp devuelve una sesión con access_token utilizable');

    // ---- Test 3: updateUser({password}) autenticado con la sesión de recovery ----
    console.log('\nTest 3: updateUser({ password }) cambia la contraseña con la sesión de recovery');
    const { error: updateError } = await recoveryClient.auth.updateUser({ password: newPassword });
    check(updateError, null, 'Test 3: updateUser no da error usando la sesión de recovery');

    // ---- Test 4: login real con la nueva contraseña ----
    console.log('\nTest 4: login real con la contraseña nueva');
    const loginClient = getAnonClient();
    const { data: loginData, error: loginError } = await loginClient.auth.signInWithPassword({
      email: admin.email,
      password: newPassword,
    });
    check(loginError, null, 'Test 4a: signInWithPassword con la contraseña nueva no da error');
    check(!!loginData?.session?.access_token, true, 'Test 4b: el login con la contraseña nueva devuelve una sesión válida');

    // ---- Test 5: la contraseña antigua deja de servir ----
    console.log('\nTest 5: la contraseña antigua ya NO permite login');
    const oldLoginClient = getAnonClient();
    const { error: oldLoginError } = await oldLoginClient.auth.signInWithPassword({
      email: admin.email,
      password: oldPassword,
    });
    checkRejected(oldLoginError, 'Test 5: signInWithPassword con la contraseña antigua es rechazado');

    // ---- Test 6: el token de recovery es de un solo uso ----
    console.log('\nTest 6: el mismo hashed_token no se puede canjear dos veces');
    const replayClient = getAnonClient();
    const { error: replayError } = await replayClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'recovery',
    });
    check(!!replayError, true, 'Test 6: reutilizar el mismo hashed_token de recovery es rechazado');
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
