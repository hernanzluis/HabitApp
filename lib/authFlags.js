/**
 * Singleton para coordinar el flujo de activación de cuenta
 * y evitar la race condition entre onAuthStateChange y
 * handle_invited_user_registration.
 *
 * Uso:
 *   - RootNavigator llama a registerSetSession(setSession) al montar.
 *   - SignUpScreen pone skipNextRedirect = true antes de signUp.
 *   - Si todo va bien, SignUpScreen llama a activateSession(session)
 *     para navegar al AppStack manualmente.
 *   - En cualquier error, SignUpScreen resetea skipNextRedirect = false.
 *
 * El mismo flag lo reutiliza el flujo de recuperación de contraseña
 * (deep link → RootNavigator) para evitar que el setSession() con los
 * tokens de recovery dispare una navegación automática al AppStack antes
 * de que el usuario haya elegido su nueva contraseña en ResetPasswordScreen.
 *   - RootNavigator llama a registerRecoveryControls(setInRecovery) al montar.
 *   - Al detectar un enlace de recovery, RootNavigator pone
 *     skipNextRedirect = true, llama a setSession() y luego a
 *     enterRecoveryMode() para mostrar ResetPasswordScreen.
 *   - ResetPasswordScreen llama a exitRecoveryMode() solo si el usuario
 *     cancela (signOut manual); tras un updateUser() con éxito no hace
 *     falta: el evento USER_UPDATED ya no está bloqueado por el flag (se
 *     consumió en el setSession anterior) y la sesión real llega sola,
 *     que es justo la condición que RootNavigator prioriza sobre
 *     inRecovery al decidir qué stack mostrar.
 */

export const authFlags = { skipNextRedirect: false };

let _setSession = null;
let _setInRecovery = null;

/** RootNavigator lo llama una vez al montar para registrar su setter de sesión. */
export function registerSetSession(fn) {
  _setSession = fn;
}

/** SignUpScreen lo llama cuando el registro completo ha terminado. */
export function activateSession(session) {
  if (_setSession) _setSession(session);
}

/** RootNavigator lo llama una vez al montar para registrar su setter de modo recovery. */
export function registerRecoveryControls(fn) {
  _setInRecovery = fn;
}

export function enterRecoveryMode() {
  if (_setInRecovery) _setInRecovery(true);
}

export function exitRecoveryMode() {
  if (_setInRecovery) _setInRecovery(false);
}
