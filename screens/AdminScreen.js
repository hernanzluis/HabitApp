import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const TEXT = '#1D2226';
const GRAY = '#666666';
const BLUE = '#0A66C2';

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg()}-${seg()}`;
}

function formatDate(dateString, locale) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function AdminScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [habits, setHabits] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('admin.header_title'),
      headerBackTitle: '',
      headerBackButtonDisplayMode: 'minimal',
      headerStyle: {
        backgroundColor: WHITE,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
      },
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: TEXT },
      headerTitleAlign: 'center',
    });
  }, [navigation, t]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) return;

      setCompanyId(profile.company_id);

      const [
        { data: invitations, error: invError },
        { data: habitsData, error: habitsError },
      ] = await Promise.all([
        supabase
          .from('invitations')
          .select('code, expires_at')
          .eq('company_id', profile.company_id)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('habits')
          .select('id, title, is_active, expires_at')
          .eq('company_id', profile.company_id)
          .order('created_at', { ascending: false }),
      ]);
      if (invError) throw invError;
      if (habitsError) throw habitsError;

      setInviteCode(invitations?.[0]?.code ?? '');
      setHabits(habitsData ?? []);
    } catch (e) {
      setError(e?.message || t('admin.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleShare = async () => {
    if (!inviteCode) return;
    try {
      await Share.share({ message: t('admin.invite_share_message', { code: inviteCode }) });
    } catch {}
  };

  const handleGenerate = async () => {
    if (!companyId || generating) return;
    setGenerating(true);
    try {
      const code = generateInviteCode();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: insertError } = await supabase
        .from('invitations')
        .insert({ company_id: companyId, code, expires_at: expiresAt });
      if (insertError) throw insertError;
      setInviteCode(code);
    } catch {
      setError(t('admin.error_generate'));
    } finally {
      setGenerating(false);
    }
  };

  const handleToggle = async (habitId, currentValue) => {
    const newValue = !currentValue;
    setHabits((prev) =>
      prev.map((h) => (h.id === habitId ? { ...h, is_active: newValue } : h))
    );
    console.log('Actualizando hábito:', habitId, 'a is_active:', newValue);
    try {
      const { error: updateError } = await supabase
        .from('habits')
        .update({ is_active: newValue })
        .eq('id', habitId);
      console.log('Resultado update:', JSON.stringify(updateError));
      if (updateError) throw updateError;
    } catch {
      setHabits((prev) =>
        prev.map((h) => (h.id === habitId ? { ...h, is_active: currentValue } : h))
      );
      setError(t('admin.error_toggle'));
    }
  };

  const renderHabit = ({ item }) => (
    <View style={styles.habitRow}>
      <View style={styles.habitInfo}>
        <Text style={styles.habitTitle} numberOfLines={2}>{item.title}</Text>
        {item.expires_at ? (
          <Text style={styles.habitExpires}>
            {t('admin.habit_expires', { date: formatDate(item.expires_at, locale) })}
          </Text>
        ) : null}
      </View>
      <Switch
        value={!!item.is_active}
        onValueChange={() => handleToggle(item.id, !!item.is_active)}
        trackColor={{ false: '#D0D0D0', true: '#BFDBFE' }}
        thumbColor={item.is_active ? BLUE : '#888'}
      />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('admin.loading')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={habits}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={BLUE} />
      }
      ListHeaderComponent={
        <>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Invite section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('admin.invite_section')}</Text>
            <Text style={styles.sectionHint}>{t('admin.invite_code_hint')}</Text>

            <View style={styles.codeBox}>
              <Text style={styles.codeText} selectable>
                {inviteCode || '—'}
              </Text>
            </View>

            <View style={styles.inviteActions}>
              {inviteCode ? (
                <TouchableOpacity style={styles.btnPrimary} onPress={handleShare} activeOpacity={0.75}>
                  <Text style={styles.btnPrimaryText}>{t('admin.invite_share')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.btnSecondary, generating && styles.btnDisabled]}
                onPress={handleGenerate}
                activeOpacity={0.75}
                disabled={generating}
              >
                <Text style={styles.btnSecondaryText}>
                  {generating ? t('admin.invite_generating') : t('admin.invite_generate')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.sectionDivider} />

          {/* Habits section header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('admin.habits_section')}</Text>
          </View>
        </>
      }
      renderItem={renderHabit}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        !error ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>{t('admin.empty_habits')}</Text>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: TEXT,
    marginTop: 14,
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  sectionDivider: {
    height: 8,
    backgroundColor: BG,
  },
  sectionHeader: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: GRAY,
    marginBottom: 16,
  },
  codeBox: {
    backgroundColor: BG,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  codeText: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: 4,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: BLUE,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BLUE,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnSecondaryText: {
    color: BLUE,
    fontSize: 14,
    fontWeight: '600',
  },
  habitRow: {
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  habitInfo: {
    flex: 1,
    gap: 3,
  },
  habitTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  habitExpires: {
    fontSize: 12,
    color: GRAY,
  },
  separator: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginLeft: 16,
  },
  emptyRow: {
    backgroundColor: WHITE,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
  },
});
