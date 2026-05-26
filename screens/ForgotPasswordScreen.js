import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';
const GRAY = '#94a3b8';
const INPUT_BG = '#ffffff';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordScreen() {
  const navigation = useNavigation();

  const [email, setEmail] = useState('');
  const emailTrimmed = useMemo(() => email.trim(), [email]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [sent, setSent] = useState(false);

  const onSend = async () => {
    if (loading) return;
    setError('');

    if (!emailTrimmed) {
      setError('Por favor, introduce tu email.');
      return;
    }

    if (!isValidEmail(emailTrimmed)) {
      setError('Por favor, introduce un email válido.');
      return;
    }

    setLoading(true);

    try {
      const { error: supabaseError } = await supabase.auth.resetPasswordForEmail(emailTrimmed);
      if (supabaseError) {
        setError(supabaseError.message || 'No se pudo enviar el correo. Intenta de nuevo.');
        return;
      }
      setSent(true);
    } catch (e) {
      setError('No se pudo enviar el correo. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.brand}>HabitApp</Text>
        <Text style={styles.subtitle}>Recupera tu acceso</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
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

          {sent ? (
            <Text style={styles.successText}>
              Revisa tu correo para continuar el proceso de recuperación.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={onSend}
            disabled={loading || sent}
            activeOpacity={0.9}
          >
            {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.loginBtnText}>Enviar</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.link}>Volver a login</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 64,
    alignItems: 'center',
  },
  brand: {
    color: WHITE,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 2,
  },
  subtitle: {
    color: WHITE,
    opacity: 0.85,
    fontSize: 14,
    marginBottom: 26,
  },
  card: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  input: {
    marginTop: 6,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: '#dbeafe',
    color: '#0f172a',
  },
  errorText: {
    marginTop: 12,
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  successText: {
    marginTop: 12,
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '700',
  },
  loginBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtnDisabled: {
    opacity: 0.7,
  },
  loginBtnText: {
    color: WHITE,
    fontWeight: '800',
  },
  link: {
    color: NAVY,
    opacity: 0.9,
    marginTop: 18,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

