import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const GREEN = '#4CAF50';
const GREEN_LIGHT = '#81C784';
const CELL_EMPTY = '#EEEEEE';

const DAY_LABELS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_LABELS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ── Helpers de fecha ──────────────────────────────────────────────────────
function toDateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayEpoch(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 86400000);
}

// ── Rachas ────────────────────────────────────────────────────────────────
function calculateCurrentStreak(logs) {
  if (!logs.length) return 0;
  const logDays = new Set(logs.map((l) => toDateKey(new Date(l.created_at))));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = new Date(today);
  if (!logDays.has(toDateKey(today))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (logDays.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function calculateBestStreak(logs) {
  if (!logs.length) return 0;
  const uniqueDays = [...new Set(logs.map((l) => dayEpoch(new Date(l.created_at))))].sort((a, b) => a - b);
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const day of uniqueDays) {
    cur = prev !== null && day - prev === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = day;
  }
  return best;
}

function calculateCompletionRate(logs) {
  if (!logs.length) return 0;
  const uniqueDays = new Set(logs.map((l) => toDateKey(new Date(l.created_at))));
  const firstDay = new Date(logs[logs.length - 1].created_at); // logs DESC
  firstDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = Math.round((today - firstDay) / 86400000) + 1;
  return Math.min(100, Math.round((uniqueDays.size / totalDays) * 100));
}

// ── Calendario mensual ────────────────────────────────────────────────────
function getMondayKey(date) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return toDateKey(d);
}

function getDaysInMonth(year, month, logs, habit) {
  const logDaySet = new Set(logs.map((l) => toDateKey(new Date(l.created_at))));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const isWeekly = habit?.recurrence === 'weekly_x';
  const weeklyTarget = habit?.weekly_target ?? 1;

  // Para weekly_x: contar logs por semana
  const weekCountMap = {};
  if (isWeekly) {
    logs.forEach((l) => {
      const key = getMondayKey(new Date(l.created_at));
      weekCountMap[key] = (weekCountMap[key] || 0) + 1;
    });
  }

  return Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(year, month, i + 1);
    const key = toDateKey(date);
    const isFuture = date > today;
    const isToday = key === todayKey;
    const hasLog = !isFuture && logDaySet.has(key);

    let cellColor = CELL_EMPTY;
    if (isFuture) {
      cellColor = 'transparent';
    } else if (hasLog) {
      if (isWeekly) {
        const weekCount = weekCountMap[getMondayKey(date)] || 0;
        cellColor = weekCount >= weeklyTarget ? GREEN : GREEN_LIGHT;
      } else {
        cellColor = GREEN;
      }
    }

    return { day: i + 1, key, hasLog, isFuture, isToday, cellColor };
  });
}

// ── Pantalla ──────────────────────────────────────────────────────────────
export default function HabitStatsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t, i18n } = useTranslation();
  const { habit, userId } = route.params ?? {};

  const accentColor = habit?.category?.color ?? BLUE;
  const isWeekly = habit?.recurrence === 'weekly_x';
  const dayLabels = i18n.language === 'es' ? DAY_LABELS_ES : DAY_LABELS_EN;
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  // Primer día del mes actual
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ streakCurrent: 0, streakBest: 0, totalCompleted: 0, completionRate: 0 });
  const [habitLogs, setHabitLogs] = useState([]);
  const [comments, setComments] = useState([]);

  useEffect(() => {
    navigation.setOptions({
      title: habit?.title ?? '',
      headerShown: true,
      headerBackTitle: '',
      headerStyle: { backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
      headerTitleStyle: { fontSize: 16, fontWeight: '700', color: TEXT },
      headerTitleAlign: 'center',
    });
  }, [navigation, habit]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (!habit?.id || !userId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data: logsData, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, created_at')
        .eq('habit_id', habit.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (logsError) throw logsError;
      const logs = logsData ?? [];

      setHabitLogs(logs);

      if (!logs.length) {
        setStats({ streakCurrent: 0, streakBest: 0, totalCompleted: 0, completionRate: 0 });
        setComments([]);
        return;
      }

      setStats({
        streakCurrent:  calculateCurrentStreak(logs),
        streakBest:     calculateBestStreak(logs),
        totalCompleted: logs.length,
        completionRate: calculateCompletionRate(logs),
      });

      const logIds = logs.map((l) => l.id);
      const { data: valData } = await supabase
        .from('habit_validations')
        .select('id, habit_log_id, validator_id, comment, created_at')
        .in('habit_log_id', logIds)
        .eq('status', 'validated')
        .not('comment', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

      const filtered = (valData ?? []).filter((v) => v.comment?.trim()).slice(0, 5);

      if (filtered.length > 0) {
        const validatorIds = [...new Set(filtered.map((v) => v.validator_id))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', validatorIds);
        const profileMap = {};
        (profilesData ?? []).forEach((p) => { profileMap[p.id] = p; });
        setComments(filtered.map((v) => ({ ...v, validator: profileMap[v.validator_id] ?? null })));
      } else {
        setComments([]);
      }
    } catch (e) {
      setError(e?.message || t('stats.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [habit, userId, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Navegación del calendario ─────────────────────────────────────────
  const today = new Date();
  const curYear = calendarMonth.getFullYear();
  const curMonth = calendarMonth.getMonth();

  const isCurrentMonth = curYear === today.getFullYear() && curMonth === today.getMonth();
  const minDate = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const isMinMonth = curYear === minDate.getFullYear() && curMonth === minDate.getMonth();

  const goToPrev = () => {
    if (isMinMonth) return;
    setCalendarMonth(new Date(curYear, curMonth - 1, 1));
  };
  const goToNext = () => {
    if (isCurrentMonth) return;
    setCalendarMonth(new Date(curYear, curMonth + 1, 1));
  };

  const monthTitle = new Date(curYear, curMonth, 1)
    .toLocaleString(locale, { month: 'long', year: 'numeric' });

  // Offset (celdas vacías al inicio del mes, lunes=0)
  const firstDayDow = new Date(curYear, curMonth, 1).getDay();
  const offset = firstDayDow === 0 ? 6 : firstDayDow - 1;

  const days = getDaysInMonth(curYear, curMonth, habitLogs, habit);

  // ── Loading ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  const StatBox = ({ value, label }) => (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color: accentColor }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={BLUE} />}
    >
      {/* Franja de color de categoría */}
      <View style={[styles.categoryAccent, { backgroundColor: accentColor }]} />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Estadísticas ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.statsGrid}>
          <StatBox value={stats.streakCurrent} label={t('stats.current_streak')} />
          <StatBox value={stats.streakBest}    label={t('stats.best_streak')} />
          <StatBox value={stats.totalCompleted} label={t('stats.total_completed')} />
          <StatBox value={`${stats.completionRate}%`} label={t('stats.completion_rate')} />
        </View>
        {isWeekly && habit.weekly_target ? (
          <Text style={styles.weeklyContext}>
            {habit.weekly_target}× / {t('stats.days').toLowerCase()}
          </Text>
        ) : null}
      </View>

      {/* ── Calendario mensual ───────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionSpaced]}>
        <Text style={styles.sectionTitle}>{t('stats.activity')}</Text>

        {/* Header de navegación */}
        <View style={styles.calMonthHeader}>
          <TouchableOpacity
            onPress={goToPrev}
            disabled={isMinMonth}
            style={styles.calNavBtn}
            activeOpacity={0.7}
          >
            <Text style={[styles.calNavText, isMinMonth && styles.calNavDisabled]}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.calMonthTitle}>{monthTitle}</Text>
          <TouchableOpacity
            onPress={goToNext}
            disabled={isCurrentMonth}
            style={styles.calNavBtn}
            activeOpacity={0.7}
          >
            <Text style={[styles.calNavText, isCurrentMonth && styles.calNavDisabled]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Cabecera días de la semana */}
        <View style={styles.calDaysGrid}>
          {dayLabels.map((label, i) => (
            <View key={i} style={styles.calDayCell}>
              <Text style={styles.calDayLabel}>{label}</Text>
            </View>
          ))}

          {/* Celdas vacías de offset */}
          {Array.from({ length: offset }, (_, i) => (
            <View key={`empty-${i}`} style={styles.calDayCell} />
          ))}

          {/* Días del mes */}
          {days.map((d) => (
            <View key={d.key} style={styles.calDayCell}>
              <View style={[
                styles.calDayCircle,
                d.isFuture
                  ? { backgroundColor: 'transparent' }
                  : d.hasLog
                  ? { backgroundColor: d.cellColor }
                  : d.isToday
                  ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: BLUE }
                  : { backgroundColor: CELL_EMPTY },
              ]}>
                <Text style={[
                  styles.calDayNum,
                  d.hasLog   ? { color: WHITE, fontWeight: '600' } :
                  d.isToday  ? { color: BLUE, fontWeight: '700' } :
                  d.isFuture ? { color: '#D0D0D0' } :
                               { color: GRAY },
                ]}>
                  {d.day}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── Últimas validaciones ──────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionSpaced]}>
        <Text style={styles.sectionTitle}>{t('stats.last_validations')}</Text>
        {comments.length === 0 ? (
          <Text style={styles.emptyText}>{t('stats.no_comments')}</Text>
        ) : (
          comments.map((v) => {
            const name = v.validator?.full_name ?? '—';
            const initial = name.charAt(0).toUpperCase();
            const dateStr = new Date(v.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
            return (
              <View key={v.id} style={styles.commentRow}>
                {v.validator?.avatar_url ? (
                  <Image source={{ uri: v.validator.avatar_url }} style={styles.commentAvatar} />
                ) : (
                  <View style={styles.commentAvatarFallback}>
                    <Text style={styles.commentAvatarInitial}>{initial}</Text>
                  </View>
                )}
                <View style={styles.commentBody}>
                  <View style={styles.commentMeta}>
                    <Text style={styles.commentName}>{name}</Text>
                    <Text style={styles.commentDate}>{dateStr}</Text>
                  </View>
                  <Text style={styles.commentText}>"{v.comment}"</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { flexGrow: 1 },
  centered: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  categoryAccent: { height: 3 },
  errorBanner: { backgroundColor: '#fee2e2', paddingHorizontal: 16, paddingVertical: 10 },
  errorText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  // Sections
  section: { backgroundColor: WHITE, paddingHorizontal: 16, paddingBottom: 20, paddingTop: 16 },
  sectionSpaced: { marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: TEXT, marginBottom: 14 },
  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statBox: { width: '50%', paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  statValue: { fontSize: 40, fontWeight: '800', lineHeight: 46 },
  statLabel: { fontSize: 12, color: GRAY, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  weeklyContext: { fontSize: 12, color: GRAY, textAlign: 'center', marginTop: 8 },
  // Calendar
  calMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calNavBtn: { padding: 8 },
  calNavText: { fontSize: 22, color: TEXT, fontWeight: '600', lineHeight: 26 },
  calNavDisabled: { color: '#D0D0D0' },
  calMonthTitle: { fontSize: 15, fontWeight: '700', color: TEXT, textTransform: 'capitalize' },
  calDaysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDayCell: { width: '14.285%', alignItems: 'center', paddingVertical: 3 },
  calDayLabel: { fontSize: 11, color: GRAY, fontWeight: '600', paddingVertical: 4 },
  calDayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayNum: { fontSize: 13, fontWeight: '500' },
  // Comments
  emptyText: { fontSize: 13, color: GRAY, fontStyle: 'italic' },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  commentAvatar: { width: 36, height: 36, borderRadius: 18 },
  commentAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarInitial: { fontSize: 15, fontWeight: '800', color: BLUE },
  commentBody: { flex: 1 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  commentName: { fontSize: 13, fontWeight: '700', color: TEXT },
  commentDate: { fontSize: 11, color: GRAY },
  commentText: { fontSize: 13, color: GRAY, fontStyle: 'italic', lineHeight: 18 },
  bottomPad: { height: 32 },
});
