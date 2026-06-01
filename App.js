import './lib/i18n';
import { applyStoredLanguage } from './lib/i18n';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './navigation/RootNavigator';

export default function App() {
  useEffect(() => {
    applyStoredLanguage();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
    </>
  );
}
