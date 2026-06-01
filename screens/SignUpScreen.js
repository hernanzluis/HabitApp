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
  const { t } = useTranslation();

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

  const normalizeAuthError = (message) => {
    if (!message) return t('signup.error_generic');
    const msg = String(message);
    if (/already registered|user.*exists|duplicate/i.test(msg)) return t('signup.error_already_registered');
    if (/invalid email/i.test(msg)) return t('errors.email_invalid');
    if (/password/i.test(msg)) return t('errors.password_required');
    return msg;
  };

  const validate = () => {
    const next = { ...EMPTY_ERRORS };

    if (!fullNameTrimmed) next.fullName = t('errors.name_required');
    if (!emailTrimmed) next.email = t('errors.email_required');
    else if (!isValidEmail(emailTrimmed)) next.email = t('errors.email_invalid');
    if (!password) next.password = t('errors.password_required');
    else if (password.length < 8) next.password = t('errors.password_min', { count: 8 });
    if (!confirmPassword) next.confirmPassword = t('errors.confirm_password_required');
    else if (confirmPassword !== password) next.confirmPassword = t('errors.password_mismatch');

    if (mode === 'create') {
      if (!companyNameTrimmed) next.companyName = t('errors.company_required');
    } else {
      if (!inviteCodeTrimmed) next.inviteCode = t('errors.invite_required');
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
      if (mode === 'join') {
        const { data: invitation, error: inviteError } = await supabase
          .from('invitations')
          .select('id, expires_at')
          .eq('code', inviteCodeTrimmed)
          .maybeSingle();

        if (inviteError) throw inviteError;
        if (!invitation) {
          setErrors((prev) => ({ ...prev, inviteCode: t('signup.error_invite_invalid') }));
          return;
        }
        if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
          setErrors((prev) => ({ ...prev, inviteCode: t('signup.error_invite_expired') }));
          return;
        }
      }

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

      if (mode === 'create') {
        const { error: rpcError } = await supabase.rpc('handle_new_user_registration', {
          user_id: user.id,
          user_email: emailTrimmed,
          user_full_name: fullNameTrimmed,
          company_name: companyNameTrimmed,
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: rpcError } = await supabase.rpc('handle_invited_user_registration', {
          user_id: user.id,
          user_email: emailTrimmed,
          user_full_name: fullNameTrimmed,
          invitation_code: inviteCodeTrimmed,
        });
        if (rpcError) throw rpcError;
      }

      registered = true;
    } catch (e) {
      setFormError(e?.message || t('signup.error_generic'));
    } finally {
      if (!registered) setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{t('common.app_name')}</Text>
        <Text style={styles.subtitle}>{t('signup.subtitle')}</Text>

        <View style={styles.card}>
          <View style={styles.modeSelector}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'create' && styles.modeBtnActive]}
              onPress={() => switchMode('create')}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={[styles.modeBtnText, mode === 'create' && styles.modeBtnTextActive]}>
                {t('signup.mode_create')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'join' && styles.modeBtnActive]}
              onPress={() => switchMode('join')}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={[styles.modeBtnText, mode === 'join' && styles.modeBtnTextActive]}>
                {t('signup.mode_join')}
              </Text>
            </TouchableOpacity>
          </View>

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
            <TouchableOpacity
              style={styles.toggleBtn}
              onPress={() => setShowPassword((v) => !v)}
              disabled={loading}
              activeOpacity={0.8}
            >
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
            <TouchableOpacity
              style={styles.toggleBtn}
              onPress={() => setShowConfirmPassword((v) => !v)}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.toggleBtnText}>{showConfirmPassword ? t('common.hide') : t('common.show')}</Text>
            </TouchableOpacity>
          </View>
          {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}

          {mode === 'create' ? (
            <>
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
            </>
          ) : (
            <>
              <Text style={[styles.label, styles.mt]}>{t('signup.invite_code')}</Text>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                style={styles.input}
                placeholder={t('signup.invite_placeholder')}
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
                {mode === 'create' ? t('signup.submit_create') : t('signup.submit_join')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.link}>{t('signup.back_to_login')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 18, paddingTop: 64, paddingBottom: 40, alignItems: 'center' },
  brand: { color: TEXT, fontSize: 28, fontWeight: '700', marginBottom: 2 },
  subtitle: { color: GRAY, fontSize: 14, marginBottom: 26 },
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
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
    padding: 3,
    marginBottom: 20,
  },
  modeBtn: {
    flex: 1,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: { backgroundColor: BLUE },
  modeBtnText: { fontSize: 13, fontWeight: '700', color: GRAY },
  modeBtnTextActive: { color: WHITE },
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
    alignSelf: 'center',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '600' },
  link: { color: BLUE, marginTop: 18, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
