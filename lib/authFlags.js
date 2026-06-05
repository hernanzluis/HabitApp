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
 */

export const authFlags = { skipNextRedirect: false };

let _setSession = null;

/** RootNavigator lo llama una vez al montar para registrar su setter de sesión. */
export function registerSetSession(fn) {
  _setSession = fn;
}

/** SignUpScreen lo llama cuando el registro completo ha terminado. */
export function activateSession(session) {
  if (_setSession) _setSession(session);
}
