import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const ORANGE = '#f97316';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatExpiry(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(dateStr);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp - now) / MS_PER_DAY);
}

function getFirstName(fullName) {
  if (!fullName?.trim()) return 'Usuario';
  return fullName.trim().split(/\s+/)[0];
}

function getTodayLabel(locale) {
  return new Date().toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [habits, setHabits] = useState([]);

  const loadHomeData = useCallback(async (isRefresh = false, attempt = 1) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) {
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, company_id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      if (!profileData?.company_id) {
        setProfile(profileData);
        setHabits([]);
        setError(t('errors.no_company'));
        return;
      }

      setProfile(profileData);

      const { data: habitsData, error: habitsError } = await supabase
        .from('habits')
        .select('id, title, description, company_id, type, recurrence, is_active, created_at, expires_at')
        .eq('company_id', profileData.company_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (habitsError) throw habitsError;

      const now = new Date();
      const active = (habitsData ?? []).filter(
        (h) => !h.expires_at || new Date(h.expires_at) > now
      );

      const habitIds = active.map((h) => h.id);

      let logsData = [];
      if (habitIds.length > 0) {
        const { data: logs, error: logsError } = await supabase
          .from('habit_logs')
          .select('id, habit_id, created_at')
          .eq('user_id', user.id)
          .in('habit_id', habitIds);
        if (logsError) throw logsError;
        logsData = logs ?? [];
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const doneEver = new Set(logsData.map((l) => l.habit_id));
      const todayLogs = logsData.filter((l) => new Date(l.created_at) >= todayStart);
      const doneToday = new Set(todayLogs.map((l) => l.habit_id));

      const todayLogIdByHabit = {};
      todayLogs.forEach((l) => { todayLogIdByHabit[l.habit_id] = l.id; });

      const todayLogIds = Object.values(todayLogIdByHabit);
      let validationsMap = {};
      if (todayLogIds.length > 0) {
        const { data: validations, error: validationsError } = await supabase
          .from('habit_validations')
          .select('habit_log_id, status')
          .in('habit_log_id', todayLogIds);
        if (validationsError) throw validationsError;
        (validations ?? []).forEach((v) => {
          if (!validationsMap[v.habit_log_id]) validationsMap[v.habit_log_id] = { validatedCount: 0, rejectedCount: 0 };
          if (v.status === 'validated') validationsMap[v.habit_log_id].validatedCount++;
          if (v.status === 'rejected') validationsMap[v.habit_log_id].rejectedCount++;
        });
      }

      const processed = active
        .filter((h) => h.recurrence !== 'once' || !doneEver.has(h.id))
        .map((h) => {
          const completedToday = h.recurrence === 'daily' && doneToday.has(h.id);
          const logId = todayLogIdByHabit[h.id];
          const vCounts = (completedToday && logId && validationsMap[logId]) || null;
          return {
            ...h,
            completedToday,
            todayValidatedCount: vCounts?.validatedCount ?? 0,
            todayRejectedCount: vCounts?.rejectedCount ?? 0,
          };
        });

      setHabits(processed);
    } catch (e) {
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return loadHomeData(isRefresh, 2);
      }
      const message = e?.message || t('home.error_load');
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

  const onCompleteHabit = (habit) => {
    navigation.navigate('HabitDetail', { habit });
  };

  const renderHabit = ({ item }) => {
    const urgent = item.expires_at && daysUntil(item.expires_at) <= 3;

    let completedCardStyle = null;
    let statusText = '';
    let statusColor = GRAY;

    if (item.completedToday) {
      if (item.todayValidatedCount > 0) {
        completedCardStyle = styles.habitCardValidated;
        statusText = t('home.status_validated');
        statusColor = '#2E7D32';
      } else if (item.todayRejectedCount > 0) {
        completedCardStyle = styles.habitCardRejected;
        statusText = t('home.status_rejected');
        statusColor = '#DC2626';
      } else {
        completedCardStyle = styles.habitCardPending;
        statusText = t('home.status_pending');
        statusColor = '#F59E0B';
      }
    }

    return (
    <View style={[styles.habitCard, completedCardStyle]}>
      <Text style={styles.habitTitle}>{item.title}</Text>
      {item.description ? <Text style={styles.habitDescription}>{item.description}</Text> : null}
      {item.expires_at ? (
        <Text style={[styles.expiryText, urgent && styles.expiryUrgent]}>
          {t('home.expires', { date: formatExpiry(item.expires_at) })}
        </Text>
      ) : null}
      {item.completedToday ? (
        <View style={styles.completedRow}>
          <View style={styles.completedLeft}>
            <Ionicons name="checkmark-circle" size={16} color={statusColor} />
            <Text style={[styles.completedText, { color: statusColor }]}>{statusText}</Text>
          </View>
          {(item.todayValidatedCount > 0 || item.todayRejectedCount > 0) ? (
            <View style={styles.validationRow}>
              <Text style={styles.validationCount}>✓ {item.todayValidatedCount}</Text>
              <Text style={styles.rejectionCount}>✗ {item.todayRejectedCount}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.completeBtn}
          onPress={() => onCompleteHabit(item)}
          activeOpacity={0.9}
        >
          <Text style={styles.completeBtnText}>{t('home.complete')}</Text>
        </TouchableOpacity>
      )}
    </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('home.greeting', { name: getFirstName(profile?.full_name) })}</Text>
        <Text style={styles.date}>{getTodayLabel(locale)}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.listCard}>
        <FlatList
          data={habits}
          keyExtractor={(item) => item.id}
          renderItem={renderHabit}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={() => habits.length > 0 ? <View style={styles.separator} /> : null}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadHomeData(true)} tintColor={BLUE} />
          }
          ListEmptyComponent={
            !error ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('home.empty')}</Text>
              </View>
            ) : null
          }
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 56,
  },
  centered: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  loadingText: {
    color: TEXT,
    marginTop: 14,
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  greeting: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '800',
  },
  date: {
    color: GRAY,
    fontSize: 14,
    marginTop: 4,
    textTransform: 'capitalize',
  },
  errorBanner: {
    marginHorizontal: 18,
    marginBottom: 12,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  listCard: {
    flex: 1,
    marginHorizontal: 18,
    marginBottom: 16,
    backgroundColor: WHITE,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden',
  },
  listContent: {
    flexGrow: 1,
  },
  separator: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  habitCard: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  habitCardValidated: {
    backgroundColor: '#F0FAF0',
    borderLeftWidth: 3,
    borderLeftColor: '#2E7D32',
  },
  habitCardRejected: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 3,
    borderLeftColor: '#DC2626',
  },
  habitCardPending: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  habitTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
  },
  habitDescription: {
    marginTop: 6,
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  expiryText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: GRAY,
  },
  expiryUrgent: {
    color: ORANGE,
  },
  completeBtn: {
    marginTop: 14,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtnText: {
    color: WHITE,
    fontWeight: '600',
    fontSize: 14,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  completedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  completedText: {
    fontSize: 13,
    color: GRAY,
  },
  validationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  validationCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  rejectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b91c1c',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
