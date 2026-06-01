import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

const MEDALS = ['🥇', '🥈', '🥉'];

export default function RankingScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [ranking, setRanking] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);

  const loadRanking = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
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

      setCurrentUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error(t('errors.no_company'));

      const { data: companyProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('company_id', profile.company_id);
      if (profilesError) throw profilesError;

      const userIds = (companyProfiles ?? []).map((p) => p.id);

      const { data: logs, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, user_id')
        .in('user_id', userIds);
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

      const counts = {};
      validations.forEach((v) => {
        const userId = logUserMap[v.habit_log_id];
        if (userId) counts[userId] = (counts[userId] || 0) + 1;
      });

      const sorted = (companyProfiles ?? [])
        .map((p) => ({ id: p.id, full_name: p.full_name, count: counts[p.id] || 0 }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count);

      setRanking(sorted);
    } catch (e) {
      setError(e?.message || t('ranking.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRanking();
    }, [loadRanking])
  );

  const renderItem = ({ item, index }) => {
    const isCurrentUser = item.id === currentUserId;
    const isTopThree = index < 3;

    return (
      <View style={[styles.row, isCurrentUser && styles.rowHighlight]}>
        <View style={styles.positionBox}>
          {isTopThree ? (
            <Text style={styles.medal}>{MEDALS[index]}</Text>
          ) : (
            <Text style={[styles.position, isCurrentUser && styles.positionHighlight]}>
              {t('ranking.position', { count: index + 1 })}
            </Text>
          )}
        </View>
        <View style={styles.nameBox}>
          <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
            {item.full_name || '—'}
          </Text>
          {isCurrentUser && <Text style={styles.youTag}>{t('ranking.you')}</Text>}
        </View>
        <View style={styles.countBox}>
          <Text style={[styles.count, isCurrentUser && styles.countHighlight]}>{item.count}</Text>
          <Text style={[styles.countLabel, isCurrentUser && styles.countLabelHighlight]}>
            {t('ranking.habit', { count: item.count })}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('ranking.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('ranking.title')}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={ranking}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadRanking(true)}
            tintColor={BLUE}
          />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('ranking.empty')}</Text>
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
    marginBottom: 20,
  },
  title: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '800',
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
    paddingBottom: 28,
    flexGrow: 1,
  },
  row: {
    backgroundColor: WHITE,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHighlight: {
    backgroundColor: HIGHLIGHT,
    borderLeftWidth: 3,
    borderLeftColor: BLUE,
  },
  positionBox: {
    width: 40,
    alignItems: 'center',
  },
  medal: {
    fontSize: 24,
  },
  position: {
    fontSize: 16,
    fontWeight: '800',
    color: GRAY,
  },
  positionHighlight: {
    color: BLUE,
  },
  nameBox: {
    flex: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  },
  countBox: {
    alignItems: 'flex-end',
  },
  count: {
    fontSize: 20,
    fontWeight: '900',
    color: BLUE,
  },
  countHighlight: {
    color: BLUE,
  },
  countLabel: {
    fontSize: 11,
    color: GRAY,
    fontWeight: '600',
  },
  countLabelHighlight: {
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
