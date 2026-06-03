import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const HIGHLIGHT = '#EEF3FB';

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  return { monday, sunday, todayEnd };
}

function formatShortDate(date, locale) {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function RankingScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [periodLabel, setPeriodLabel] = useState('');

  const loadActivity = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    const { monday, sunday, todayEnd } = getWeekBounds();

    setPeriodLabel(
      t('activity.period', {
        from: formatShortDate(monday, locale),
        to: formatShortDate(sunday, locale),
      })
    );

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      setCurrentUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error(t('errors.no_company'));

      const [
        { data: companyProfiles, error: profilesError },
        { data: activeHabits, error: habitsError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .eq('company_id', profile.company_id),
        supabase
          .from('habits')
          .select('id')
          .eq('company_id', profile.company_id)
          .eq('is_active', true),
      ]);
      if (profilesError) throw profilesError;
      if (habitsError) throw habitsError;

      const userIds = (companyProfiles ?? []).map((p) => p.id);
      const activeHabitIds = (activeHabits ?? []).map((h) => h.id);

      // Assignments: cuántos hábitos tiene asignados cada miembro
      let assignments = [];
      if (activeHabitIds.length > 0 && userIds.length > 0) {
        const { data: assignData, error: assignError } = await supabase
          .from('habit_assignments')
          .select('habit_id, user_id')
          .in('habit_id', activeHabitIds)
          .in('user_id', userIds);
        if (assignError) throw assignError;
        assignments = assignData ?? [];
      }

      const assignedMap = {};
      assignments.forEach((a) => {
        assignedMap[a.user_id] = (assignedMap[a.user_id] || 0) + 1;
      });

      // No active habits — show all members with zero counts
      if (!activeHabitIds.length) {
        setMembers(
          (companyProfiles ?? []).map((p) => ({
            id: p.id,
            full_name: p.full_name,
            avatar_url: p.avatar_url,
            assigned: 0,
            completed: 0,
            validated: 0,
          }))
        );
        return;
      }

      const { data: logs, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, user_id')
        .in('habit_id', activeHabitIds)
        .in('user_id', userIds)
        .gte('created_at', monday.toISOString())
        .lte('created_at', todayEnd.toISOString());
      if (logsError) throw logsError;

      const logIds = (logs ?? []).map((l) => l.id);
      const logUserMap = {};
      (logs ?? []).forEach((l) => { logUserMap[l.id] = l.user_id; });

      let validations = [];
      if (logIds.length > 0) {
        const { data: validationsData, error: validationsError } = await supabase
          .from('habit_validations')
          .select('habit_log_id')
          .eq('status', 'validated')
          .in('habit_log_id', logIds);
        if (validationsError) throw validationsError;
        validations = validationsData ?? [];
      }

      // Aggregate per user
      const completedMap = {};
      (logs ?? []).forEach((l) => {
        completedMap[l.user_id] = (completedMap[l.user_id] || 0) + 1;
      });

      const validatedMap = {};
      validations.forEach((v) => {
        const userId = logUserMap[v.habit_log_id];
        if (userId) validatedMap[userId] = (validatedMap[userId] || 0) + 1;
      });

      const result = (companyProfiles ?? [])
        .map((p) => ({
          id: p.id,
          full_name: p.full_name,
          avatar_url: p.avatar_url,
          assigned: assignedMap[p.id] || 0,
          completed: completedMap[p.id] || 0,
          validated: validatedMap[p.id] || 0,
        }))
        .sort((a, b) => b.completed - a.completed || (a.full_name ?? '').localeCompare(b.full_name ?? ''));

      setMembers(result);
    } catch (e) {
      setError(e?.message || t('activity.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, locale]);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [loadActivity])
  );

  const renderItem = ({ item }) => {
    const isCurrentUser = item.id === currentUserId;
    const name = item.full_name || '—';
    const initial = name.charAt(0).toUpperCase();

    return (
      <View style={[styles.row, isCurrentUser && styles.rowHighlight]}>
        {/* Avatar */}
        <View style={styles.avatarWrapper}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
        </View>

        {/* Nombre */}
        <View style={styles.nameBox}>
          <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
            {name}
          </Text>
          {isCurrentUser && <Text style={styles.youTag}>{t('activity.you')}</Text>}
        </View>

        {/* Contadores */}
        <View style={styles.countersBox}>
          <View style={styles.counter}>
            <Text style={[styles.counterValue, isCurrentUser && styles.counterValueHighlight]}>
              {item.completed}
              <Text style={styles.counterDenom}>/{item.assigned}</Text>
            </Text>
            <Text style={[styles.counterLabel, isCurrentUser && styles.counterLabelHighlight]}>
              {t('activity.completed')}
            </Text>
          </View>
          <View style={[styles.counter, styles.counterRight]}>
            <Text style={[styles.counterValue, isCurrentUser && styles.counterValueHighlight]}>
              {item.validated}
            </Text>
            <Text style={[styles.counterLabel, isCurrentUser && styles.counterLabelHighlight]}>
              {t('activity.validated')}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('activity.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Cabecera de período */}
      {periodLabel ? (
        <View style={styles.periodBanner}>
          <Text style={styles.periodText}>{periodLabel}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={() => members.length > 0 ? <View style={styles.separator} /> : null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadActivity(true)}
            tintColor={BLUE}
          />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('activity.empty')}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
  periodBanner: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  periodText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY,
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },
  separator: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  row: {
    backgroundColor: WHITE,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHighlight: {
    backgroundColor: HIGHLIGHT,
    borderLeftWidth: 3,
    borderLeftColor: BLUE,
  },
  avatarWrapper: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '800',
    color: BLUE,
  },
  nameBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
    flexShrink: 1,
  },
  nameHighlight: {
    color: BLUE,
  },
  youTag: {
    backgroundColor: BLUE,
    color: WHITE,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  countersBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  counter: {
    alignItems: 'center',
    minWidth: 52,
  },
  counterRight: {
    borderLeftWidth: 1,
    borderLeftColor: '#E0E0E0',
    paddingLeft: 16,
  },
  counterValue: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT,
  },
  counterValueHighlight: {
    color: BLUE,
  },
  counterDenom: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY,
  },
  counterLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GRAY,
    textAlign: 'center',
    marginTop: 1,
  },
  counterLabelHighlight: {
    color: BLUE,
  },
  emptyCard: {
    backgroundColor: WHITE,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
});
