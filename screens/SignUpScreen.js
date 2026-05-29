import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

function normalizeAuthError(message) {
  if (!message) return 'No se pudo completar el registro. Intenta de nuevo.';
  const msg = String(message);
  if (/already registered|user.*exists|duplicate/i.test(msg)) return 'Este email ya está registrado.';
  if (/invalid email/i.test(msg)) return 'El email no es válido.';
  if (/password/i.test(msg)) return 'Revisa la contraseña e inténtalo de nuevo.';
  return msg;
}

const EMPTY_ERRORS = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  companyName: '',
  inviteCode: '',
};

export default function SignUpScreen() {
  const navigation = useNavigation();

  const [mode, setMode] = useState('create');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const fullNameTrimmed = useMemo(() => fullName.trim(), [fullName]);
  const emailTrimmed = useMemo(() => email.trim(), [email]);
  const companyNameTrimmed = useMemo(() => companyName.trim(), [companyName]);
  const inviteCodeTrimmed = useMemo(() => inviteCode.trim(), [inviteCode]);

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setFormError('');
    setErrors(EMPTY_ERRORS);
  };

  const validate = () => {
    const next = { ...EMPTY_ERRORS };

    if (!fullNameTrimmed) next.fullName = 'Por favor, introduce tu nombre completo.';
    if (!emailTrimmed) next.email = 'Por favor, introduce tu email.';
    else if (!isValidEmail(emailTrimmed)) next.email = 'Por favor, introduce un email válido.';
    if (!password) next.password = 'Por favor, introduce una contraseña.';
    else if (password.length < 8) next.password = 'La contraseña debe tener al menos 8 caracteres.';
    if (!confirmPassword) next.confirmPassword = 'Por favor, confirma tu contraseña.';
    else if (confirmPassword !== password) next.confirmPassword = 'Las contraseñas no coinciden.';

    if (mode === 'create') {
      if (!companyNameTrimmed) next.companyName = 'Por favor, introduce el nombre de tu empresa.';
    } else {
      if (!inviteCodeTrimmed) next.inviteCode = 'Por favor, introduce el código de invitación.';
    }

    setErrors(next);
    return Object.values(next).every((v) => !v);
  };

  const onSignUp = async () => {
    if (loading) return;
    setFormError('');
    if (!validate()) return;

    setLoading(true);
    let registered = false;
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: emailTrimmed,
        password,
      });

      if (signUpError) {
        const userError = normalizeAuthError(signUpError.message);
        if (/email/i.test(String(signUpError.message)) || /registered|duplicate/i.test(userError)) {
          console.log('[ERROR] signUpError email:', JSON.stringify(signUpError));
          setErrors((prev) => ({ ...prev, email: userError }));
          return;
        }
        console.log('[ERROR] signUpError general:', JSON.stringify(signUpError));
        setFormError(userError);
        return;
      }

      const user = authData?.user;
      if (!user?.id) {
        console.log('[ERROR] no user after signUp, authData:', JSON.stringify(authData));
        setFormError(
          'No se pudo obtener el usuario tras el registro. Si debes confirmar el email, hazlo e inicia sesión.'
        );
        return;
      }

      if (mode === 'create') {
        const { error: rpcError } = await supabase.rpc('handle_new_user_registration', {
          user_id: user.id,
          user_email: emailTrimmed,
          user_full_name: fullNameTrimmed,
          company_name: companyNameTrimmed,
        });
        console.log('[RPC create] error:', JSON.stringify(rpcError));
        if (rpcError) throw rpcError;
      } else {
        const { error: rpcError } = await supabase.rpc('handle_invited_user_registration', {
          user_id: user.id,
          user_email: emailTrimmed,
          user_full_name: fullNameTrimmed,
          invitation_code: inviteCodeTrimmed,
        });
        console.log('[RPC join] error:', JSON.stringify(rpcError));
        if (rpcError) throw rpcError;
      }

      // Registro completado — onAuthStateChange desmontará el componente
      registered = true;
    } catch (e) {
      console.log('Error completo:', JSON.stringify(e));
      console.log('Error message:', e?.message);
      console.log('Error code:', e?.code);
      console.log('Error details:', e?.details);
      setFormError(e?.message || 'No se pudo completar el registro. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      // No actualizar estado si el registro fue exitoso: el componente ya se está desmontando
      if (!registered) setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>HabitApp</Text>
        <Text style={styles.subtitle}>Crea tu cuenta</Text>

        <View style={styles.card}>
          <View style={styles.modeSelector}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'create' && styles.modeBtnActive]}
              onPress={() => switchMode('create')}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={[styles.modeBtnText, mode === 'create' && styles.modeBtnTextActive]}>
                Crear empresa
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'join' && styles.modeBtnActive]}
              onPress={() => switchMode('join')}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={[styles.modeBtnText, mode === 'join' && styles.modeBtnTextActive]}>
                Tengo un código
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={styles.input}
            placeholder="Juan Pérez"
            placeholderTextColor={GRAY}
            autoCapitalize="words"
            editable={!loading}
          />
          {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}

          <Text style={[styles.label, styles.mt]}>Email</Text>
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

          <Text style={[styles.label, styles.mt]}>Contraseña</Text>
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

          <Text style={[styles.label, styles.mt]}>Confirmar contraseña</Text>
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

          {mode === 'create' ? (
            <>
              <Text style={[styles.label, styles.mt]}>Nombre de la empresa</Text>
              <TextInput
                value={companyName}
                onChangeText={setCompanyName}
                style={styles.input}
                placeholder="Habit Corp."
                placeholderTextColor={GRAY}
                autoCapitalize="words"
                editable={!loading}
              />
              {errors.companyName ? <Text style={styles.errorText}>{errors.companyName}</Text> : null}
            </>
          ) : (
            <>
              <Text style={[styles.label, styles.mt]}>Código de invitación</Text>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                style={styles.input}
                placeholder="XXXX-XXXX"
                placeholderTextColor={GRAY}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
              />
              {errors.inviteCode ? <Text style={styles.errorText}>{errors.inviteCode}</Text> : null}
            </>
          )}

          {formError ? <Text style={styles.formErrorText}>{formError}</Text> : null}

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={onSignUp}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color={WHITE} />
            ) : (
              <Text style={styles.submitBtnText}>
                {mode === 'create' ? 'Crear cuenta' : 'Unirse a la empresa'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.link}>Volver a login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
  content: { paddingHorizontal: 18, paddingTop: 64, paddingBottom: 40, alignItems: 'center' },
  brand: { color: WHITE, fontSize: 28, fontWeight: '700', marginBottom: 2 },
  subtitle: { color: WHITE, opacity: 0.85, fontSize: 14, marginBottom: 26 },
  card: { width: '100%', backgroundColor: WHITE, borderRadius: 12, padding: 16 },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  modeBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: {
    backgroundColor: NAVY,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: GRAY,
  },
  modeBtnTextActive: {
    color: WHITE,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  mt: { marginTop: 14 },
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
  submitBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '800' },
  link: { color: NAVY, opacity: 0.9, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
