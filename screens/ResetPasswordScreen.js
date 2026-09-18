import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { exitRecoveryMode } from '../lib/authFlags';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const INPUT_BG = '#ffffff';

export default function ResetPasswordScreen() {
  const { t } = useTranslation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const next = {};
    if (!password) next.password = t('errors.password_required');
    else if (password.length < 8) next.password = t('errors.password_min', { count: 8 });
    if (!confirmPassword) next.confirmPassword = t('errors.confirm_password_required');
    else if (confirmPassword !== password) next.confirmPassword = t('errors.password_mismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (loading) return;
    if (!validate()) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        Alert.alert(t('common.error'), t('reset.error_update'));
        return;
      }
      // Éxito: no navegamos manualmente. El evento USER_UPDATED que dispara
      // updateUser() ya no está bloqueado por authFlags.skipNextRedirect
      // (se consumió en el setSession() inicial del deep link), así que
      // RootNavigator recibe la sesión real de forma natural y, como prioriza
      // `session` sobre `inRecovery`, pasa solo a AppStack sin parpadeo.
    } catch {
      Alert.alert(t('common.error'), t('reset.error_update'));
    } finally {
      setLoading(false);
    }
  };

  const onCancel = () => {
    Alert.alert(
      t('reset.cancel_confirm_title'),
      t('reset.cancel_confirm_message'),
      [
        { text: t('reset.cancel_confirm_no'), style: 'cancel' },
        {
          text: t('reset.cancel_confirm_yes'),
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            exitRecoveryMode();
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.brand}>{t('common.app_name')}</Text>
        <Text style={styles.subtitle}>{t('reset.subtitle')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('common.password')}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={[styles.input, styles.passwordInput]}
              placeholder="••••••••"
              placeholderTextColor={GRAY}
              secureTextEntry={!showPassword}
              editable={!loading}
            />
            <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowPassword((v) => !v)} disabled={loading} activeOpacity={0.8}>
              <Text style={styles.toggleBtnText}>{showPassword ? t('common.hide') : t('common.show')}</Text>
            </TouchableOpacity>
          </View>
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

          <Text style={[styles.label, styles.mt]}>{t('signup.confirm_password')}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              style={[styles.input, styles.passwordInput]}
              placeholder="••••••••"
              placeholderTextColor={GRAY}
              secureTextEntry={!showConfirmPassword}
              editable={!loading}
            />
            <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowConfirmPassword((v) => !v)} disabled={loading} activeOpacity={0.8}>
              <Text style={styles.toggleBtnText}>{showConfirmPassword ? t('common.hide') : t('common.show')}</Text>
            </TouchableOpacity>
          </View>
          {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={onSubmit}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.submitBtnText}>{t('reset.submit')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onCancel} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.link}>{t('reset.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 64, alignItems: 'center' },
  brand: { color: TEXT, fontSize: 28, fontWeight: '700', marginBottom: 2 },
  subtitle: { color: GRAY, fontSize: 14, marginBottom: 26, textAlign: 'center' },
  card: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 8,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '600', color: TEXT },
  mt: { marginTop: 14 },
  input: {
    marginTop: 6,
    height: 44,
    borderRadius: 4,
    paddingHorizontal: 12,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    color: TEXT,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 60 },
  toggleBtn: { position: 'absolute', right: 10, paddingVertical: 6, paddingHorizontal: 4 },
  toggleBtnText: { color: BLUE, fontSize: 12, fontWeight: '700' },
  errorText: { marginTop: 6, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  submitBtn: {
    marginTop: 20,
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'center',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '600' },
  link: { color: BLUE, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
