import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

export const ONBOARDING_KEY = 'onboarding_completed';

const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const BG = '#F3F2EF';

const CATEGORY_NAMES = ['Alimentación', 'Ejercicio', 'Salud', 'Lectura', 'Descanso', 'Hogar'];

const SUGGESTED = [
  { icon: 'restaurant-outline',           color: '#FF9800', nameKey: 'onboarding.habit_water',  categoryName: 'Alimentación' },
  { icon: 'fitness-outline',              color: '#4CAF50', nameKey: 'onboarding.habit_walk',   categoryName: 'Ejercicio' },
  { icon: 'medical-outline',              color: '#F44336', nameKey: 'onboarding.habit_meds',   categoryName: 'Salud' },
  { icon: 'book-outline',                 color: '#2196F3', nameKey: 'onboarding.habit_read',   categoryName: 'Lectura' },
  { icon: 'moon-outline',                 color: '#9C27B0', nameKey: 'onboarding.habit_sleep',  categoryName: 'Descanso' },
  { icon: 'ellipsis-horizontal-outline',  color: '#9E9E9E', nameKey: 'onboarding.habit_chores', categoryName: 'Hogar' },
];

function genCode() {
  const part = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${part()}-${part()}`;
}

export default function OnboardingModal({ visible, companyId, userId, onComplete, onGoToAdmin }) {
  const { t } = useTranslation();

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [categoriesMap, setCategoriesMap] = useState({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loadingInvite, setLoadingInvite] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('categories')
        .select('id, name')
        .is('company_id', null)
        .in('name', CATEGORY_NAMES);
      const map = {};
      (data ?? []).forEach((c) => { map[c.name] = c.id; });
      setCategoriesMap(map);
    } catch {
      // non-critical — habit will be created without category
    }
  }, []);

  const loadOrCreateInvite = useCallback(async () => {
    if (!companyId) return;
    setLoadingInvite(true);
    try {
      const { data: existing } = await supabase
        .from('invitations')
        .select('code')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.code) {
        setInviteCode(existing.code);
        return;
      }

      const code = genCode();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await supabase.from('invitations').insert({ code, company_id: companyId, expires_at: expiresAt.toISOString() });
      setInviteCode(code);
    } catch {
      // non-critical
    } finally {
      setLoadingInvite(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (visible) {
      setStep(0);
      setSelected(null);
      setCreateError('');
      loadCategories();
    }
  }, [visible, loadCategories]);

  useEffect(() => {
    if (step === 2) loadOrCreateInvite();
  }, [step, loadOrCreateInvite]);

  const handleCreateHabit = async () => {
    if (selected === null) return;
    setCreating(true);
    setCreateError('');
    try {
      const habit = SUGGESTED[selected];
      const categoryId = categoriesMap[habit.categoryName] ?? null;
      const title = t(habit.nameKey);

      const { data: newHabit, error: habitError } = await supabase
        .from('habits')
        .insert({
          title,
          type: 'general',
          recurrence: 'daily',
          company_id: companyId,
          created_by: userId,
          is_active: true,
          category_id: categoryId,
        })
        .select('id')
        .single();
      if (habitError) throw habitError;

      const { error: assignError } = await supabase
        .from('habit_assignments')
        .insert({ habit_id: newHabit.id, user_id: userId });
      if (assignError) throw assignError;

      setStep(2);
    } catch (e) {
      setCreateError(e?.message || 'Error');
    } finally {
      setCreating(false);
    }
  };

  const handleShare = async () => {
    if (!inviteCode) return;
    try {
      await Share.share({ message: t('admin.invite_share_message', { code: inviteCode }) });
    } catch {
      // ignore
    }
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    onComplete();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {/* Indicador de pasos */}
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        {/* PASO A — Bienvenida */}
        {step === 0 && (
          <View style={styles.stepContent}>
            <Ionicons name="people-outline" size={100} color={BLUE} />
            <Text style={styles.title}>{t('onboarding.welcome_title')}</Text>
            <Text style={styles.subtitle}>{t('onboarding.welcome_subtitle')}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(1)} activeOpacity={0.9}>
              <Text style={styles.primaryBtnText}>{t('onboarding.start')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PASO B — Primer hábito */}
        {step === 1 && (
          <ScrollView
            contentContainerStyle={styles.stepScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{t('onboarding.habit_title')}</Text>
            <Text style={styles.subtitle}>{t('onboarding.habit_subtitle')}</Text>

            {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

            <View style={styles.grid}>
              {SUGGESTED.map((h, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.habitCard, selected === idx && styles.habitCardSelected]}
                  onPress={() => setSelected(selected === idx ? null : idx)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.habitIconCircle, { backgroundColor: h.color + '26' }]}>
                    <Ionicons name={h.icon} size={28} color={h.color} />
                  </View>
                  <Text style={styles.habitName}>{t(h.nameKey)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity onPress={onGoToAdmin} activeOpacity={0.7} style={styles.customLinkBtn}>
              <Text style={styles.customLink}>{t('onboarding.habit_custom')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, selected === null && styles.primaryBtnDisabled]}
              onPress={handleCreateHabit}
              disabled={selected === null || creating}
              activeOpacity={0.9}
            >
              {creating
                ? <ActivityIndicator color={WHITE} />
                : <Text style={styles.primaryBtnText}>{t('onboarding.habit_continue')}</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* PASO C — Invitar familia */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Ionicons name="share-social-outline" size={80} color={BLUE} />
            <Text style={styles.title}>{t('onboarding.invite_title')}</Text>
            <Text style={styles.subtitle}>{t('onboarding.invite_subtitle')}</Text>

            {loadingInvite ? (
              <ActivityIndicator color={BLUE} style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{inviteCode}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, !inviteCode && styles.primaryBtnDisabled]}
              onPress={handleShare}
              disabled={!inviteCode}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>{t('onboarding.invite_share')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleFinish} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>{t('onboarding.invite_done')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 40,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
  },
  dotActive: {
    backgroundColor: BLUE,
    width: 20,
    borderRadius: 4,
  },
  stepContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  stepScrollContent: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: GRAY,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryBtn: {
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: WHITE,
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: GRAY,
    fontSize: 15,
    fontWeight: '600',
  },
  customLinkBtn: {
    paddingVertical: 4,
  },
  customLink: {
    color: BLUE,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
    marginVertical: 4,
  },
  habitCard: {
    width: '46%',
    backgroundColor: BG,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  habitCardSelected: {
    borderColor: BLUE,
    backgroundColor: '#EEF3FB',
  },
  habitIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitName: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  codeBox: {
    backgroundColor: '#EEF3FB',
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 16,
    marginVertical: 8,
  },
  codeText: {
    fontSize: 28,
    fontWeight: '900',
    color: BLUE,
    letterSpacing: 4,
  },
});
