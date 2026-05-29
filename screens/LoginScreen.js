import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const INPUT_BG = '#ffffff';

function normalizeSupabaseError(message) {
  if (!message) return 'Ocurrió un error. Intenta de nuevo.';

  const msg = String(message);
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/invalid email/i.test(msg)) return 'El email no es válido.';
  if (/password/i.test(msg) && /required|empty/i.test(msg)) return 'La contraseña es requerida.';

  return msg;
}

function isValidEmail(email) {
  // Regla simple para validación en UI (Supabase siempre valida en backend).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginScreen() {
  const navigation = useNavigation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const emailTrimmed = useMemo(() => email.trim(), [email]);

  const validate = () => {
    if (!emailTrimmed) return 'Por favor, introduce tu email.';
    if (!isValidEmail(emailTrimmed)) return 'Por favor, introduce un email válido.';
    if (!password) return 'Por favor, introduce tu contraseña.';
    if (password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
    return '';
  };

  const onLogin = async () => {
    if (loading) return;

    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });

      if (error) {
        setFormError(normalizeSupabaseError(error.message));
        return;
      }

    } catch (e) {
      setFormError('No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        {/* Logo o nombre de la app */}
        <Text style={styles.brand}>HabitApp</Text>
        <Text style={styles.subtitle}>Accede a tu cuenta</Text>

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

          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={onLogin}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.loginBtnText}>Login</Text>}
          </TouchableOpacity>
        </View>

        {/* Links */}
        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} disabled={loading} activeOpacity={0.8}>
          <Text style={styles.link}>¿Olvidaste tu contraseña?</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} disabled={loading} activeOpacity={0.8}>
          <Text style={styles.link}>Crear cuenta</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 64, alignItems: 'center' },
  brand: { color: TEXT, fontSize: 28, fontWeight: '800', marginBottom: 2 },
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
  passwordRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  passwordInput: { flex: 1, marginTop: 0 },
  toggleBtn: {
    marginLeft: 10,
    paddingHorizontal: 10,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
    justifyContent: 'center',
  },
  toggleBtnText: { color: TEXT, fontWeight: '700', fontSize: 12 },
  errorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
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
  link: { color: BLUE, marginTop: 18, fontSize: 14, fontWeight: '600' },
});

