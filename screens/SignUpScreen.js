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

export default function SignUpScreen() {
  const navigation = useNavigation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const emailTrimmed = useMemo(() => email.trim(), [email]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);

  const onSignUp = async () => {
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
    if (!password) {
      setError('Por favor, introduce una contraseña.');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const { error: supabaseError } = await supabase.auth.signUp({ email: emailTrimmed, password });
      if (supabaseError) {
        setError(supabaseError.message || 'No se pudo crear la cuenta.');
        return;
      }
      setCreated(true);
    } catch (e) {
      setError('No se pudo crear la cuenta. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.brand}>HabitApp</Text>
        <Text style={styles.subtitle}>Crea tu cuenta</Text>

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

          <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
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
            <TouchableOpacity
              style={styles.toggleBtn}
              onPress={() => setShowPassword((v) => !v)}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.toggleBtnText}>{showPassword ? 'Ocultar' : 'Mostrar'}</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {created ? (
            <Text style={styles.successText}>
              Cuenta creada. Si la configuración requiere confirmación, revisa tu email.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={onSignUp}
            disabled={loading || created}
            activeOpacity={0.9}
          >
            {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.loginBtnText}>Crear cuenta</Text>}
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
  container: { flex: 1, backgroundColor: NAVY },
  content: { flex: 1, paddingHorizontal: 18, paddingTop: 64, alignItems: 'center' },
  brand: { color: WHITE, fontSize: 28, fontWeight: '700', marginBottom: 2 },
  subtitle: { color: WHITE, opacity: 0.85, fontSize: 14, marginBottom: 26 },
  card: { width: '100%', backgroundColor: WHITE, borderRadius: 12, padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
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
  passwordRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  passwordInput: { flex: 1, marginTop: 0 },
  toggleBtn: {
    marginLeft: 10,
    paddingHorizontal: 10,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
  },
  toggleBtnText: { color: NAVY, fontWeight: '700', fontSize: 12 },
  errorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  successText: { marginTop: 12, color: '#0f766e', fontSize: 13, fontWeight: '700' },
  loginBtn: { marginTop: 16, height: 46, borderRadius: 10, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: WHITE, fontWeight: '800' },
  link: { color: NAVY, opacity: 0.9, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});

