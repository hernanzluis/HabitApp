import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from '../locales/en.json';
import es from '../locales/es.json';

export const LANG_STORAGE_KEY = 'user_language';

const languageCode = Localization.getLocales()[0]?.languageCode ?? 'en';
const deviceLng = languageCode.startsWith('es') ? 'es' : 'en';

i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v4',
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: deviceLng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

export async function applyStoredLanguage() {
  try {
    const stored = await AsyncStorage.getItem(LANG_STORAGE_KEY);
    if (stored && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // non-critical
  }
}

export default i18n;
