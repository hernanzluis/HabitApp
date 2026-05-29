import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';
const GRAY = '#94a3b8';
const INPUT_BG = '#ffffff';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAuthErrorToUserError(message) {
  if (!message) return 'No se pudo completar el registro. Intenta de nuevo.';

  const msg = String(message);
  if (/already registered|user.*exists|duplicate/i.test(msg)) return 'Este email ya está registrado.';
  if (/invalid email/i.test(msg)) return 'El email no es válido.';
  if (/password/i.test(msg)) return 'Revisa la contraseña e inténtalo de nuevo.';
  return msg;
}

export default function SignUpScreen() {
  const navigation = useNavigation();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [companyName, setCompanyName] = useState('');

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const fullNameTrimmed = useMemo(() => fullName.trim(), [fullName]);
  const emailTrimmed = useMemo(() => email.trim(), [email]);
  const companyNameTrimmed = useMemo(() => companyName.trim(), [companyName]);

  const [errors, setErrors] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
  });

  const validate = () => {
    const nextErrors = {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      companyName: '',
    };

    if (!fullNameTrimmed) nextErrors.fullName = 'Por favor, introduce tu nombre completo.';
    if (!emailTrimmed) nextErrors.email = 'Por favor, introduce tu email.';
    else if (!isValidEmail(emailTrimmed)) nextErrors.email = 'Por favor, introduce un email válido.';

    if (!password) nextErrors.password = 'Por favor, introduce una contraseña.';
    else if (password.length < 8) nextErrors.password = 'La contraseña debe tener al menos 8 caracteres.';

    if (!confirmPassword) nextErrors.confirmPassword = 'Por favor, confirma tu contraseña.';
    else if (confirmPassword !== password) nextErrors.confirmPassword = 'Las contraseñas no coinciden.';

    if (!companyNameTrimmed) nextErrors.companyName = 'Por favor, introduce el nombre de tu empresa.';

    setErrors(nextErrors);
    return Object.values(nextErrors).every((v) => !v);
  };

  const onSignUp = async () => {
    if (loading) return;
    setFormError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: emailTrimmed,
        password,
      });

      if (signUpError) {
        const userError = normalizeAuthErrorToUserError(signUpError.message);
        if (/email/i.test(String(signUpError.message)) || /registered|duplicate/i.test(userError)) {
          setErrors((prev) => ({ ...prev, email: userError }));
          return;
        }
        setFormError(userError);
        return;
      }

      const user = authData?.user;
      if (!user?.id) {
        setFormError(
          'No se pudo obtener el usuario tras el registro. Si debes confirmar el email, hazlo e inicia sesión.'
        );
        return;
      }

      const { error: rpcError } = await supabase.rpc('handle_new_user_registration', {
        user_id: user.id,
        user_email: emailTrimmed,
        user_full_name: fullNameTrimmed,
        company_name: companyNameTrimmed,
      });

      if (rpcError) {
        setFormError(rpcError.message || 'No se pudo completar el registro de empresa y perfil.');
        return;
      }

    } catch {
      setFormError('No se pudo completar el registro. Revisa tu conexión e inténtalo de nuevo.');
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
          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={styles.input}
            placeholder="Juan Pérez"
            placeholderTextColor={GRAY}
            autoCapitalize="words"
            keyboardType="default"
            editable={!loading}
          />
          {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}

          <Text style={[styles.label, { marginTop: 14 }]}>Email</Text>
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
          {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

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
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

          <Text style={[styles.label, { marginTop: 14 }]}>Confirmar contraseña</Text>
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
            <TouchableOpacity
              style={styles.toggleBtn}
              onPress={() => setShowConfirmPassword((v) => !v)}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.toggleBtnText}>{showConfirmPassword ? 'Ocultar' : 'Mostrar'}</Text>
            </TouchableOpacity>
          </View>
          {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}

          <Text style={[styles.label, { marginTop: 14 }]}>Nombre de la empresa</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            style={styles.input}
            placeholder="Habit Corp."
            placeholderTextColor={GRAY}
            autoCapitalize="words"
            keyboardType="default"
            editable={!loading}
          />
          {errors.companyName ? <Text style={styles.errorText}>{errors.companyName}</Text> : null}

          {formError ? <Text style={styles.formErrorText}>{formError}</Text> : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={onSignUp}
            disabled={loading}
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
  errorText: { marginTop: 6, color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  formErrorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '700' },
  loginBtn: { marginTop: 16, height: 46, borderRadius: 10, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: WHITE, fontWeight: '800' },
  link: { color: NAVY, opacity: 0.9, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});

