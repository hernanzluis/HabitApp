import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const HIGHLIGHT = '#EEF3FB';

const MEDALS = ['🥇', '🥈', '🥉'];

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export default function RankingScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [ranking, setRanking] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [period, setPeriod] = useState('week');
  const [selectedHabit, setSelectedHabit] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitModalVisible, setHabitModalVisible] = useState(false);

  const PERIODS = [
    { value: 'week', label: t('ranking.period_week') },
    { value: 'month', label: t('ranking.period_month') },
    { value: 'all', label: t('ranking.period_all') },
  ];

  const selectedHabitLabel = selectedHabit
    ? (habits.find((h) => h.id === selectedHabit)?.title ?? t('ranking.filter_all_habits'))
    : t('ranking.filter_all_habits');

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
        { data: habitsData, error: habitsError },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('company_id', profile.company_id),
        supabase
          .from('habits')
          .select('id, title')
          .eq('company_id', profile.company_id)
          .eq('is_active', true)
          .order('title'),
      ]);
      if (profilesError) throw profilesError;
      if (habitsError) throw habitsError;

      setHabits(habitsData ?? []);

      const userIds = (companyProfiles ?? []).map((p) => p.id);

      let logsQuery = supabase
        .from('habit_logs')
        .select('id, user_id')
        .in('user_id', userIds);
      if (selectedHabit) {
        logsQuery = logsQuery.eq('habit_id', selectedHabit);
      }
      const { data: logs, error: logsError } = await logsQuery;
      if (logsError) throw logsError;

      const logIds = (logs ?? []).map((l) => l.id);
      const logUserMap = {};
      (logs ?? []).forEach((l) => { logUserMap[l.id] = l.user_id; });

      let validations = [];
      if (logIds.length > 0) {
        let valQuery = supabase
          .from('habit_validations')
          .select('habit_log_id')
          .eq('status', 'validated')
          .in('habit_log_id', logIds);

        if (period === 'week') {
          valQuery = valQuery.gte('created_at', getWeekStart());
        } else if (period === 'month') {
          valQuery = valQuery.gte('created_at', getMonthStart());
        }

        const { data: validationsData, error: validationsError } = await valQuery;
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
  }, [period, selectedHabit]);

  useFocusEffect(
    useCallback(() => {
      loadRanking();
    }, [loadRanking])
  );

  const selectHabit = (id) => {
    setSelectedHabit(id);
    setHabitModalVisible(false);
  };

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
      {/* Filtros */}
      <View style={styles.filtersCard}>
        {/* Pills de período */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.value}
              style={[styles.pill, period === p.value && styles.pillActive]}
              onPress={() => setPeriod(p.value)}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, period === p.value && styles.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Dropdown de hábito */}
        {habits.length > 0 && (
          <>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.dropdownRow}
              onPress={() => setHabitModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dropdownLabel}>{t('ranking.filter_habit_label')}</Text>
              <View style={styles.dropdownValue}>
                <Text style={styles.dropdownValueText} numberOfLines={1}>{selectedHabitLabel}</Text>
                <Ionicons name="chevron-down" size={16} color={GRAY} />
              </View>
            </TouchableOpacity>
          </>
        )}
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

      {/* Modal selector de hábito */}
      <Modal
        visible={habitModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHabitModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setHabitModalVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('ranking.filter_habit_label')}</Text>
            <ScrollView bounces={false}>
              {/* Opción "Todos" */}
              <TouchableOpacity
                style={styles.modalOption}
                onPress={() => selectHabit(null)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modalOptionText, selectedHabit === null && styles.modalOptionTextActive]}>
                  {t('ranking.filter_all_habits')}
                </Text>
                {selectedHabit === null && (
                  <Ionicons name="checkmark" size={18} color={BLUE} />
                )}
              </TouchableOpacity>
              <View style={styles.modalDivider} />
              {habits.map((h, index) => (
                <React.Fragment key={h.id}>
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => selectHabit(h.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modalOptionText, selectedHabit === h.id && styles.modalOptionTextActive]}>
                      {h.title}
                    </Text>
                    {selectedHabit === h.id && (
                      <Ionicons name="checkmark" size={18} color={BLUE} />
                    )}
                  </TouchableOpacity>
                  {index < habits.length - 1 && <View style={styles.modalDivider} />}
                </React.Fragment>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  filtersCard: {
    backgroundColor: WHITE,
    paddingTop: 10,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    gap: 8,
    paddingVertical: 4,
    paddingBottom: 10,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: BG,
  },
  pillActive: {
    backgroundColor: BLUE,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  pillTextActive: {
    color: WHITE,
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  dropdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY,
  },
  dropdownValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '60%',
  },
  dropdownValueText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
    flexShrink: 1,
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
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    flex: 1,
  },
  modalOptionTextActive: {
    color: BLUE,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 16,
  },
});
