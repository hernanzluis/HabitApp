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
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { authFlags, activateSession } from '../lib/authFlags';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const INPUT_BG = '#ffffff';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const EMPTY_ERRORS = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  companyName: '',
  activationCode: '',
};

export default function SignUpScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  // step: 'choose' | 'form' | 'activate_code' | 'activate_password'
  const [step, setStep] = useState('choose');
  const [mode, setMode] = useState('create'); // 'create' | 'activate'

  // Campos modo create
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [companyName, setCompanyName] = useState('');

  // Campos modo activate
  const [activationCode, setActivationCode] = useState('');
  const [activationData, setActivationData] = useState(null); // { email, full_name, company_id }

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const fullNameTrimmed = useMemo(() => fullName.trim(), [fullName]);
  const emailTrimmed = useMemo(() => email.trim(), [email]);
  const companyNameTrimmed = useMemo(() => companyName.trim(), [companyName]);
  const activationCodeTrimmed = useMemo(() => activationCode.trim(), [activationCode]);

  const chooseMode = (m) => {
    setMode(m);
    setFormError('');
    setErrors(EMPTY_ERRORS);
    setStep(m === 'create' ? 'form' : 'activate_code');
  };

  const goBack = () => {
    setFormError('');
    setErrors(EMPTY_ERRORS);
    if (step === 'activate_password') {
      setStep('activate_code');
    } else {
      setStep('choose');
    }
  };

  const normalizeAuthError = (message) => {
    if (!message) return t('signup.error_generic');
    const msg = String(message);
    if (/already registered|user.*exists|duplicate/i.test(msg)) return t('signup.error_already_registered');
    if (/invalid email/i.test(msg)) return t('errors.email_invalid');
    if (/password/i.test(msg)) return t('errors.password_required');
    return msg;
  };

  // ── Validación formulario create ──────────────────────────────────────────
  const validateCreate = () => {
    const next = { ...EMPTY_ERRORS };

    if (!fullNameTrimmed) next.fullName = t('errors.name_required');
    if (!emailTrimmed) next.email = t('errors.email_required');
    else if (!isValidEmail(emailTrimmed)) next.email = t('errors.email_invalid');
    if (!password) next.password = t('errors.password_required');
    else if (password.length < 8) next.password = t('errors.password_min', { count: 8 });
    if (!confirmPassword) next.confirmPassword = t('errors.confirm_password_required');
    else if (confirmPassword !== password) next.confirmPassword = t('errors.password_mismatch');
    if (!companyNameTrimmed) next.companyName = t('errors.company_required');

    setErrors(next);
    return Object.values(next).every((v) => !v);
  };

  // ── Submit: modo create ───────────────────────────────────────────────────
  const onSignUp = async () => {
    if (loading) return;
    setFormError('');
    if (!validateCreate()) return;

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
          setErrors((prev) => ({ ...prev, email: userError }));
          return;
        }
        setFormError(userError);
        return;
      }

      const user = authData?.user;
      if (!user?.id) {
        setFormError(t('signup.error_no_user'));
        return;
      }

      const { error: rpcError } = await supabase.rpc('handle_new_user_registration', {
        user_id: user.id,
        user_email: emailTrimmed,
        user_full_name: fullNameTrimmed,
        company_name: companyNameTrimmed,
      });
      if (rpcError) throw rpcError;

      registered = true;
    } catch (e) {
      setFormError(e?.message || t('signup.error_generic'));
    } finally {
      if (!registered) setLoading(false);
    }
  };

  // ── Activate paso 1: validar código ───────────────────────────────────────
  const onCheckCode = async () => {
    if (loading) return;
    setFormError('');
    setErrors(EMPTY_ERRORS);

    if (!activationCodeTrimmed || activationCodeTrimmed.length !== 6) {
      setErrors((prev) => ({ ...prev, activationCode: t('signup.code_invalid') }));
      return;
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      const { data: record, error } = await supabase
        .from('activation_codes')
        .select('email, full_name, company_id')
        .eq('code', activationCodeTrimmed)
        .eq('used', false)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .maybeSingle();

      if (error) throw error;

      if (!record) {
        setErrors((prev) => ({ ...prev, activationCode: t('signup.code_invalid') }));
        return;
      }

      setActivationData(record);
      setStep('activate_password');
    } catch (e) {
      setFormError(e?.message || t('signup.error_generic'));
    } finally {
      setLoading(false);
    }
  };

  // ── Activate paso 2: crear contraseña y registrar ─────────────────────────
  const onActivate = async () => {
    if (loading) return;
    setFormError('');
    const next = { ...EMPTY_ERRORS };

    if (!password) next.password = t('errors.password_required');
    else if (password.length < 8) next.password = t('errors.password_min', { count: 8 });
    if (!confirmPassword) next.confirmPassword = t('errors.confirm_password_required');
    else if (confirmPassword !== password) next.confirmPassword = t('errors.password_mismatch');

    setErrors(next);
    if (Object.values(next).some((v) => v)) return;

    setLoading(true);
    let registered = false;

    // Bloqueamos el redirect automático de onAuthStateChange para que
    // handle_invited_user_registration termine antes de mostrar el AppStack.
    authFlags.skipNextRedirect = true;

    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: activationData.email,
        password,
      });

      if (signUpError) {
        authFlags.skipNextRedirect = false;
        setFormError(normalizeAuthError(signUpError.message));
        return;
      }

      const user = authData?.user;
      if (!user?.id) {
        authFlags.skipNextRedirect = false;
        setFormError(t('signup.error_no_user'));
        return;
      }

      const { error: rpcError } = await supabase.rpc('handle_activation_registration', {
        user_id: user.id,
        user_email: activationData.email,
        user_full_name: activationData.full_name,
        activation_code: activationCodeTrimmed,
      });
      if (rpcError) {
        if (rpcError.message === 'limit_members_reached') {
          setFormError(t('admin.limit_members_reached'));
          return;
        }
        throw rpcError;
      }

      await supabase
        .from('activation_codes')
        .update({ used: true })
        .eq('code', activationCodeTrimmed);

      // Todo OK: obtenemos la sesión activa y navegamos al AppStack manualmente.
      const { data: { session } } = await supabase.auth.getSession();
      activateSession(session);
      registered = true;
    } catch (e) {
      setFormError(e?.message || t('signup.error_generic'));
    } finally {
      if (!registered) {
        authFlags.skipNextRedirect = false; // garantiza reset aunque haya crash o return temprano
        setLoading(false);
      }
    }
  };

  // ── Paso 1: elegir modo ───────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.chooseContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.welcomeTitle}>{t('signup.welcome_title')}</Text>
          <Text style={styles.welcomeSubtitle}>{t('signup.welcome_subtitle')}</Text>

          <TouchableOpacity
            style={styles.modeCardCreate}
            onPress={() => chooseMode('create')}
            activeOpacity={0.85}
          >
            <Ionicons name="people-outline" size={32} color={WHITE} />
            <View style={styles.modeCardText}>
              <Text style={styles.modeCardTitleLight}>{t('signup.create_group')}</Text>
              <Text style={styles.modeCardDescLight}>{t('signup.create_group_desc')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modeCardJoin}
            onPress={() => chooseMode('activate')}
            activeOpacity={0.85}
          >
            <Ionicons name="key-outline" size={32} color={BLUE} />
            <View style={styles.modeCardText}>
              <Text style={styles.modeCardTitleBlue}>{t('signup.activate_account')}</Text>
              <Text style={styles.modeCardDescBlue}>{t('signup.activate_desc')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} activeOpacity={0.8}>
            <Text style={styles.link}>{t('signup.back_to_login')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Activate paso 1: introducir código ────────────────────────────────────
  if (step === 'activate_code') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={goBack} disabled={loading} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={TEXT} />
            <Text style={styles.backBtnText}>{t('signup.back_to_login')}</Text>
          </TouchableOpacity>

          <Text style={styles.formTitle}>{t('signup.activate_account')}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>{t('signup.enter_code')}</Text>
            <TextInput
              value={activationCode}
              onChangeText={(v) => setActivationCode(v.replace(/\D/g, '').slice(0, 6))}
              style={styles.input}
              placeholder={t('signup.code_placeholder')}
              placeholderTextColor={GRAY}
              keyboardType="numeric"
              maxLength={6}
              editable={!loading}
            />
            {errors.activationCode ? <Text style={styles.errorText}>{errors.activationCode}</Text> : null}

            {formError ? <Text style={styles.formErrorText}>{formError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={onCheckCode}
              disabled={loading}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.submitBtnText}>{t('signup.submit_continue')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Activate paso 2: crear contraseña ────────────────────────────────────
  if (step === 'activate_password') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={goBack} disabled={loading} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={TEXT} />
            <Text style={styles.backBtnText}>{t('signup.back_to_login')}</Text>
          </TouchableOpacity>

          <Text style={styles.formTitle}>{t('signup.create_password')}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>{t('signup.your_email')}</Text>
            <TextInput
              value={activationData?.email ?? ''}
              style={[styles.input, styles.inputDisabled]}
              editable={false}
            />

            <Text style={[styles.label, styles.mt]}>{t('common.password')}</Text>
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

            {formError ? <Text style={styles.formErrorText}>{formError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={onActivate}
              disabled={loading}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.submitBtnText}>{t('signup.submit_activate')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Paso 2: formulario modo create ────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backBtn} onPress={goBack} disabled={loading} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={TEXT} />
          <Text style={styles.backBtnText}>{t('signup.back_to_login')}</Text>
        </TouchableOpacity>

        <Text style={styles.formTitle}>{t('signup.create_group')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('signup.full_name')}</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={styles.input}
            placeholder={t('signup.full_name_placeholder')}
            placeholderTextColor={GRAY}
            autoCapitalize="words"
            editable={!loading}
          />
          {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}

          <Text style={[styles.label, styles.mt]}>{t('common.email')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder={t('common.email_placeholder')}
            placeholderTextColor={GRAY}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

          <Text style={[styles.label, styles.mt]}>{t('common.password')}</Text>
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

          <Text style={[styles.label, styles.mt]}>{t('signup.company_name')}</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            style={styles.input}
            placeholder={t('signup.company_placeholder')}
            placeholderTextColor={GRAY}
            autoCapitalize="words"
            editable={!loading}
          />
          {errors.companyName ? <Text style={styles.errorText}>{errors.companyName}</Text> : null}

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
              <Text style={styles.submitBtnText}>{t('signup.submit_create')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  // ── Choose step
  chooseContent: { paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40 },
  brand: { color: TEXT, fontSize: 28, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  welcomeTitle: { color: TEXT, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  welcomeSubtitle: { color: GRAY, fontSize: 15, textAlign: 'center', marginBottom: 40 },
  modeCardCreate: {
    height: 80,
    borderRadius: 8,
    backgroundColor: BLUE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 16,
  },
  modeCardJoin: {
    height: 80,
    borderRadius: 8,
    backgroundColor: WHITE,
    borderWidth: 1.5,
    borderColor: BLUE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 16,
    marginBottom: 32,
  },
  modeCardText: { flex: 1 },
  modeCardTitleLight: { fontSize: 16, fontWeight: '700', color: WHITE },
  modeCardDescLight: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  modeCardTitleBlue: { fontSize: 16, fontWeight: '700', color: BLUE },
  modeCardDescBlue: { fontSize: 12, color: GRAY, marginTop: 2 },
  // ── Form step
  content: { paddingHorizontal: 18, paddingTop: 56, paddingBottom: 40 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backBtnText: { color: TEXT, fontSize: 14, fontWeight: '600' },
  formTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 20 },
  card: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 8,
    padding: 16,
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
  inputDisabled: {
    backgroundColor: '#F0F0F0',
    color: GRAY,
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
  errorText: { marginTop: 6, color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  formErrorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '700' },
  submitBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '600' },
  link: { color: BLUE, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
