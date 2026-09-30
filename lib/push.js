// Notificaciones push (etapa 2 de docs/push-notifications-plan.md):
// permiso, registro/baja del token en Supabase y comportamiento en primer
// plano. El envío lo hacen Edge Functions (etapas 3-6); aquí solo se recibe.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';
import i18n from './i18n';

const TOKEN_KEY = 'push_token';
// Dentro de Expo Go el token sería de la app Expo Go, no de HabitTeam: no se
// registra (el push real solo se prueba en un build: TestFlight).
const IN_EXPO_GO = Constants.executionEnvironment === 'storeClient';
const PUSH_AVAILABLE = Device.isDevice && !IN_EXPO_GO;
const PRIMER_KEY = 'push_primer_shown';

// Con la app en primer plano: banner y en la lista, sin sonido ni contador
// en el icono (se quedaría desfasado).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getPushPermission() {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return { status, canAskAgain };
}

// Registra (o refresca) el token del dispositivo, solo si el permiso ya está
// concedido. Se llama en cada arranque con sesión y al cambiar de idioma: el
// token puede cambiar tras reinstalar, y el idioma decide el de los avisos.
export async function registerPushTokenIfGranted() {
  if (!PUSH_AVAILABLE) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) throw new Error('push: falta el projectId de EAS');
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  const locale = i18n.language === 'en' ? 'en' : 'es';
  const timeZone = Localization.getCalendars()[0]?.timeZone ?? 'Europe/Madrid';
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'android' ? 'android' : 'ios',
    p_locale: locale,
    p_time_zone: timeZone,
  });
  if (error) throw error;
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return token;
}

// Pide el permiso del sistema y, si se concede, registra el token.
export async function requestPushPermission() {
  if (!PUSH_AVAILABLE) return 'unavailable';
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  if (status === 'granted') await registerPushTokenIfGranted();
  return status;
}

// iOS solo muestra su diálogo una vez: antes se explica para qué sirve (la
// pantalla previa la muestra el llamador) y solo se pregunta una vez de forma
// automática. Devuelve true si toca enseñar la explicación.
export async function shouldShowPushPrimer() {
  if (!PUSH_AVAILABLE) return false;
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== 'undetermined' || !canAskAgain) return false;
  return (await AsyncStorage.getItem(PRIMER_KEY)) === null;
}

export async function markPushPrimerShown() {
  await AsyncStorage.setItem(PRIMER_KEY, '1');
}

// Al cerrar sesión, ANTES de signOut() (después ya no hay sesión para la RPC).
// Best-effort: nunca impide cerrar sesión.
export async function unregisterPushToken() {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // sin conexión, etc.: el token se reasigna o desactiva más adelante
  } finally {
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }
}

export function openSystemNotificationSettings() {
  return Linking.openSettings();
}
