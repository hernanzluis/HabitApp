import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const INPUT_BG = '#ffffff';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const emailTrimmed = useMemo(() => email.trim(), [email]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const onSend = async () => {
    if (loading) return;
    setError('');

    if (!emailTrimmed) { setError(t('errors.email_required')); return; }
    if (!isValidEmail(emailTrimmed)) { setError(t('errors.email_invalid')); return; }

    setLoading(true);
    try {
      const { error: supabaseError } = await supabase.auth.resetPasswordForEmail(emailTrimmed);
      if (supabaseError) { setError(supabaseError.message || t('forgot.error_send')); return; }
      setSent(true);
    } catch {
      setError(t('forgot.error_network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.brand}>{t('common.app_name')}</Text>
        <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('common.email')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="tu@email.com"
            placeholderTextColor={GRAY}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {sent ? <Text style={styles.successText}>{t('forgot.success')}</Text> : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={onSend}
            disabled={loading || sent}
            activeOpacity={0.9}
          >
            {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.loginBtnText}>{t('forgot.submit')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.link}>{t('forgot.back_to_login')}</Text>
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
  subtitle: { color: GRAY, fontSize: 14, marginBottom: 26 },
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
  errorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  successText: { marginTop: 12, color: '#0f766e', fontSize: 13, fontWeight: '700' },
  loginBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'center',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: WHITE, fontWeight: '600' },
  link: { color: BLUE, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
