import React, { useCallback, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const GREEN = '#4CAF50';
const YELLOW = '#F59E0B';
const FLAME = GREEN;

const DAY_LABELS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_LABELS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// "YYYY-M-D" key in local time — used for day-level comparisons
function toDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Monday 00:00:00 of the current week (local time)
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function get30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Consecutive-day streak for a specific habit.
// If today has no log yet, the streak is not broken — counting starts from yesterday.
function calculateStreak(logs, habitId) {
  const logDays = new Set(
    logs.filter((l) => l.habit_id === habitId).map((l) => toDateKey(new Date(l.created_at)))
  );
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

// General streak for a member: days where they completed at least one assigned habit.
function calculateGeneralStreak(logs, assignedHabitIds, memberId) {
  const logDays = new Set(
    logs
      .filter((l) => l.user_id === memberId && assignedHabitIds.has(l.habit_id))
      .map((l) => toDateKey(new Date(l.created_at)))
  );
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

// 7 states (Mon→Sun): 'validated' | 'pending' | 'none'
function getWeekDots(logs, habitId, validatedLogIds) {
  const monday = getWeekStart();
  const dayLogsMap = {};
  logs
    .filter((l) => l.habit_id === habitId)
    .forEach((l) => {
      const key = toDateKey(new Date(l.created_at));
      if (!dayLogsMap[key]) dayLogsMap[key] = [];
      dayLogsMap[key].push(l.id);
    });
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const ids = dayLogsMap[toDateKey(day)] || [];
    if (ids.length === 0) return 'none';
    return ids.some((id) => validatedLogIds.has(id)) ? 'validated' : 'pending';
  });
}

// 7 states — 'validated' | 'pending' | 'none' for any assigned habit that day
function getGeneralWeekDots(logs, assignedHabitIds, memberId, validatedLogIds) {
  const monday = getWeekStart();
  const dayLogsMap = {};
  logs
    .filter((l) => l.user_id === memberId && assignedHabitIds.has(l.habit_id))
    .forEach((l) => {
      const key = toDateKey(new Date(l.created_at));
      if (!dayLogsMap[key]) dayLogsMap[key] = [];
      dayLogsMap[key].push(l.id);
    });
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const ids = dayLogsMap[toDateKey(day)] || [];
    if (ids.length === 0) return 'none';
    return ids.some((id) => validatedLogIds.has(id)) ? 'validated' : 'pending';
  });
}

// Count how many times a habit was logged this week (Mon→today)
function getWeeklyTargetCount(logs, habitId) {
  const monday = getWeekStart();
  return logs.filter((l) => l.habit_id === habitId && new Date(l.created_at) >= monday).length;
}

// Consecutive weeks where weeklyCount >= weeklyTarget.
// If current week not yet met, start counting from last week.
function calculateWeeklyStreak(logs, habitId, weeklyTarget) {
  const habitLogs = logs.filter((l) => l.habit_id === habitId);
  if (!habitLogs.length) return 0;
  let weekStart = getWeekStart();
  const currentWeekEnd = new Date(weekStart);
  currentWeekEnd.setDate(weekStart.getDate() + 7);
  const currentCount = habitLogs.filter((l) => {
    const d = new Date(l.created_at);
    return d >= weekStart && d < currentWeekEnd;
  }).length;
  if (currentCount < weeklyTarget) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    weekStart = d;
  }
  let streak = 0;
  while (true) {
    const wEnd = new Date(weekStart);
    wEnd.setDate(weekStart.getDate() + 7);
    const count = habitLogs.filter((l) => { const d = new Date(l.created_at); return d >= weekStart && d < wEnd; }).length;
    if (count < weeklyTarget) break;
    streak++;
    const next = new Date(weekStart);
    next.setDate(next.getDate() - 7);
    weekStart = next;
  }
  return streak;
}

function WeeklyTargetDots({ count, target, validatedCount = 0, weekLogDates = [], dayLabels = [] }) {
  return (
    <View style={styles.targetDotsRow}>
      {Array.from({ length: target }, (_, i) => {
        let bg = '#E0E0E0';
        if (i < validatedCount) bg = GREEN;
        else if (i < count) bg = YELLOW;
        const date = i < count ? weekLogDates[i] : null;
        const label = date ? dayLabels[(date.getDay() + 6) % 7] ?? '' : '';
        return (
          <View key={i} style={styles.targetDotWrapper}>
            <Text style={styles.targetDotLabel}>{label}</Text>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: bg }} />
          </View>
        );
      })}
    </View>
  );
}

function formatExpiryDate(dateStr, locale) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function OnceHabitCard({ habit, logs, t, locale }) {
  const done = logs.some((l) => l.habit_id === habit.id);
  return (
    <View style={[styles.habitCard, { borderLeftColor: habit.category?.color ?? BLUE }]}>
      <View style={styles.habitTitleRow}>
        {habit.category ? (
          <View style={[styles.catBadge, { backgroundColor: habit.category.color + '26' }]}>
            <Ionicons name={habit.category.icon} size={16} color={habit.category.color} />
          </View>
        ) : null}
        <Text style={styles.habitTitle} numberOfLines={2}>{habit.title}</Text>
      </View>
      {habit.expires_at ? (
        <Text style={styles.weekSummary}>{formatExpiryDate(habit.expires_at, locale)}</Text>
      ) : null}
      <View style={styles.onceStatusRow}>
        <Ionicons
          name={done ? 'checkmark-circle' : 'ellipse-outline'}
          size={15}
          color={done ? GREEN : GRAY}
        />
        <Text style={[styles.onceStatusText, { color: done ? GREEN : GRAY }]}>
          {done ? t('activity.completed_once') : t('activity.pending_once')}
        </Text>
      </View>
    </View>
  );
}

function WeekDots({ dots, dayLabels, size = 28, compact = false }) {
  return (
    <View style={compact ? styles.weekRowCompact : styles.weekRow}>
      {dots.map((state, i) => (
        <View key={i} style={compact ? styles.dotColCompact : styles.dotCol}>
          <Text style={styles.dotLabel}>{dayLabels[i]}</Text>
          <View style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor:
              state === 'validated' ? GREEN
              : state === 'pending' ? YELLOW
              : '#E0E0E0',
          }} />
        </View>
      ))}
    </View>
  );
}

export default function RankingScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const dayLabels = i18n.language === 'es' ? DAY_LABELS_ES : DAY_LABELS_EN;
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [myHabits, setMyHabits] = useState([]);
  const [myLogs, setMyLogs] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [memberAssignmentsMap, setMemberAssignmentsMap] = useState({});
  const [activeHabitsWithCat, setActiveHabitsWithCat] = useState([]);
  const [validatedLogIds, setValidatedLogIds] = useState(new Set());

  const loadActivity = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id, role')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error(t('errors.no_company'));

      const { company_id: companyId } = profile;

      // Round trip 1: members, categories, active habits — all independent
      const [profilesResult, catsResult, habitsResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url').eq('company_id', companyId),
        supabase.from('categories').select('id, name, icon, color').or(`company_id.is.null,company_id.eq.${companyId}`),
        supabase.from('habits').select('id, title, category_id, recurrence, expires_at, weekly_target').eq('company_id', companyId).eq('is_active', true),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (habitsResult.error) throw habitsResult.error;

      const allMembers = profilesResult.data ?? [];
      const allMemberIds = allMembers.map((p) => p.id);
      const activeHabits = habitsResult.data ?? [];
      const activeHabitIds = activeHabits.map((h) => h.id);

      const catsMap = {};
      (catsResult.data ?? []).forEach((c) => { catsMap[c.id] = c; });

      // Split habits by recurrence for separate log queries
      const dailyHabitIds = activeHabits.filter((h) => h.recurrence === 'daily' || h.recurrence === 'weekly_x').map((h) => h.id);
      const onceHabitIds  = activeHabits.filter((h) => h.recurrence === 'once').map((h) => h.id);

      // Round trip 2: assignments + daily logs (30d) + once logs (all-time) — all parallel
      const thirtyDaysAgo = get30DaysAgo();
      const hasData = activeHabitIds.length > 0 && allMemberIds.length > 0;

      const [assignmentsResult, dailyLogsResult, onceLogsResult] = await Promise.all([
        hasData
          ? supabase.from('habit_assignments').select('habit_id, user_id').in('habit_id', activeHabitIds).in('user_id', allMemberIds)
          : Promise.resolve({ data: [], error: null }),
        dailyHabitIds.length > 0 && allMemberIds.length > 0
          ? supabase.from('habit_logs').select('id, habit_id, user_id, created_at').in('user_id', allMemberIds).in('habit_id', dailyHabitIds).gte('created_at', thirtyDaysAgo.toISOString())
          : Promise.resolve({ data: [], error: null }),
        onceHabitIds.length > 0 && allMemberIds.length > 0
          ? supabase.from('habit_logs').select('id, habit_id, user_id, created_at').in('user_id', allMemberIds).in('habit_id', onceHabitIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (assignmentsResult.error) throw assignmentsResult.error;
      if (dailyLogsResult.error) throw dailyLogsResult.error;
      if (onceLogsResult.error) throw onceLogsResult.error;

      const assignments = assignmentsResult.data ?? [];
      const logs = [...(dailyLogsResult.data ?? []), ...(onceLogsResult.data ?? [])];

      // Round trip 3: validated habit_validations for all daily logs
      const allLogIds = (dailyLogsResult.data ?? []).map((l) => l.id);
      let validatedIds = new Set();
      if (allLogIds.length > 0) {
        const { data: validationsData, error: validationsError } = await supabase
          .from('habit_validations')
          .select('habit_log_id')
          .in('habit_log_id', allLogIds)
          .eq('status', 'validated');
        if (validationsError) throw validationsError;
        validatedIds = new Set((validationsData ?? []).map((v) => v.habit_log_id));
      }

      // Build userId → Set<habitId> map
      const memberAssignMap = {};
      allMemberIds.forEach((id) => { memberAssignMap[id] = new Set(); });
      assignments.forEach((a) => { memberAssignMap[a.user_id]?.add(a.habit_id); });

      // Resolve categories for all active habits once — reused for my cards and member cards
      const allHabitsWithCat = activeHabits.map((h) => ({
        ...h,
        category: h.category_id ? (catsMap[h.category_id] ?? null) : null,
      }));

      const myHabitIds = memberAssignMap[user.id] || new Set();

      setIsAdmin(profile.role === 'admin');
      setMyUserId(user.id);
      setActiveHabitsWithCat(allHabitsWithCat);
      setMyHabits(allHabitsWithCat.filter((h) => myHabitIds.has(h.id)));
      setMyLogs(logs.filter((l) => l.user_id === user.id));
      setAllLogs(logs);
      setGroupMembers(allMembers.filter((m) => m.id !== user.id));
      setMemberAssignmentsMap(memberAssignMap);
      setValidatedLogIds(validatedIds);
    } catch (e) {
      setError(e?.message || t('activity.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => { loadActivity(); }, [loadActivity]));

  // Derived at render time — cheap, avoids storing in state
  const dailyHabitIdsSet = new Set(
    activeHabitsWithCat.filter((h) => h.recurrence === 'daily' || h.recurrence === 'weekly_x').map((h) => h.id)
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('activity.loading')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadActivity(true)} tintColor={BLUE} />
      }
    >
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Section 1: Tu actividad ─────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('activity.your_activity')}</Text>
      </View>

      {myHabits.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t('activity.empty')}</Text>
        </View>
      ) : (
        <>
          {myHabits.filter((h) => h.recurrence === 'daily').map((habit) => {
            const dots = getWeekDots(myLogs, habit.id, validatedLogIds);
            const streak = calculateStreak(myLogs, habit.id);
            const weekCompleted = dots.filter((s) => s !== 'none').length;
            return (
              <TouchableOpacity
                key={habit.id}
                style={[styles.habitCard, { borderLeftColor: habit.category?.color ?? BLUE }]}
                onPress={() => navigation.navigate('HabitStats', { habit, userId: myUserId })}
                activeOpacity={0.8}
              >
                <View style={styles.habitTitleRow}>
                  {habit.category ? (
                    <View style={[styles.catBadge, { backgroundColor: habit.category.color + '26' }]}>
                      <Ionicons name={habit.category.icon} size={16} color={habit.category.color} />
                    </View>
                  ) : null}
                  <Text style={[styles.habitTitle, { flex: 1 }]} numberOfLines={2}>{habit.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </View>
                <View style={styles.streakRow}>
                  <Ionicons name="flame-outline" size={22} color={streak > 0 ? FLAME : '#E0E0E0'} />
                  {streak > 0 ? (
                    <View style={styles.streakNums}>
                      <Text style={styles.streakNumber}>{streak}</Text>
                      <Text style={styles.streakUnit}>{t('activity.days')}</Text>
                    </View>
                  ) : null}
                </View>
                <WeekDots dots={dots} dayLabels={dayLabels} size={28} />
                <Text style={styles.weekSummary}>
                  {t('activity.week_completed', { completed: weekCompleted })}
                </Text>
              </TouchableOpacity>
            );
          })}
          {myHabits.filter((h) => h.recurrence === 'weekly_x').map((habit) => {
            const wCount = getWeeklyTargetCount(myLogs, habit.id);
            const wStreak = calculateWeeklyStreak(myLogs, habit.id, habit.weekly_target || 1);
            const monday = getWeekStart();
            const weekLogs = myLogs
              .filter((l) => l.habit_id === habit.id && new Date(l.created_at) >= monday)
              .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const weekLogIds = weekLogs.map((l) => l.id);
            const weekLogDates = weekLogs.map((l) => new Date(l.created_at));
            const wValidatedCount = weekLogIds.filter((id) => validatedLogIds.has(id)).length;
            return (
              <TouchableOpacity
                key={habit.id}
                style={[styles.habitCard, { borderLeftColor: habit.category?.color ?? BLUE }]}
                onPress={() => navigation.navigate('HabitStats', { habit, userId: myUserId })}
                activeOpacity={0.8}
              >
                <View style={styles.habitTitleRow}>
                  {habit.category ? (
                    <View style={[styles.catBadge, { backgroundColor: habit.category.color + '26' }]}>
                      <Ionicons name={habit.category.icon} size={16} color={habit.category.color} />
                    </View>
                  ) : null}
                  <Text style={[styles.habitTitle, { flex: 1 }]} numberOfLines={2}>{habit.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </View>
                <View style={styles.streakRow}>
                  <Ionicons name="flame-outline" size={22} color={wStreak > 0 ? FLAME : '#E0E0E0'} />
                  {wStreak > 0 ? (
                    <Text style={[styles.streakUnit, { color: FLAME }]}>
                      {t('activity.weeks', { count: wStreak })}
                    </Text>
                  ) : null}
                </View>
                <WeeklyTargetDots count={wCount} target={habit.weekly_target || 1} validatedCount={wValidatedCount} weekLogDates={weekLogDates} dayLabels={dayLabels} />
                <Text style={styles.weekSummary}>
                  {t('home.weekly_progress', { done: wCount, target: habit.weekly_target || 1 })}
                </Text>
              </TouchableOpacity>
            );
          })}
          {myHabits.some((h) => h.recurrence === 'once') ? (
            <>
              <View style={styles.eventsLabel}>
                <Text style={styles.eventsLabelText}>{t('activity.events')}</Text>
              </View>
              {myHabits.filter((h) => h.recurrence === 'once').map((habit) => (
                <OnceHabitCard key={habit.id} habit={habit} logs={myLogs} t={t} locale={locale} />
              ))}
            </>
          ) : null}
        </>
      )}

      {/* ── Section 2: Tu familia ────────────────────────────────────────────── */}
      {groupMembers.length > 0 ? (
        <>
          <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
            <Text style={styles.sectionTitle}>{t('activity.your_family')}</Text>
          </View>

          {groupMembers.map((member, index) => {
            const name = member.full_name || '—';
            const assignedSet = memberAssignmentsMap[member.id] || new Set();

            // ── Admin: expanded per-habit detail ────────────────────────────
            if (isAdmin) {
              const memberHabits = activeHabitsWithCat.filter((h) => assignedSet.has(h.id));
              const memberLogs = allLogs.filter((l) => l.user_id === member.id);
              const dailyMemberHabits   = memberHabits.filter((h) => h.recurrence === 'daily');
              const weeklyMemberHabits  = memberHabits.filter((h) => h.recurrence === 'weekly_x');
              const onceMemberHabits    = memberHabits.filter((h) => h.recurrence === 'once');

              return (
                <View key={member.id} style={index > 0 ? styles.memberGroup : undefined}>
                  <View style={styles.memberSubheader}>
                    {member.avatar_url ? (
                      <Image source={{ uri: member.avatar_url }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.memberSubheaderName}>{name}</Text>
                  </View>

                  {memberHabits.length === 0 ? (
                    <View style={styles.memberNoHabits}>
                      <Text style={styles.weekSummary}>{t('activity.empty')}</Text>
                    </View>
                  ) : (
                    <>
                      {dailyMemberHabits.map((habit) => {
                        const dots = getWeekDots(memberLogs, habit.id, validatedLogIds);
                        const streak = calculateStreak(memberLogs, habit.id);
                        const weekCompleted = dots.filter((s) => s !== 'none').length;
                        return (
                          <TouchableOpacity
                            key={habit.id}
                            style={[styles.habitCard, { borderLeftColor: habit.category?.color ?? BLUE }]}
                            onPress={() => navigation.navigate('HabitStats', { habit, userId: member.id })}
                            activeOpacity={0.8}
                          >
                            <View style={styles.habitTitleRow}>
                              {habit.category ? (
                                <View style={[styles.catBadge, { backgroundColor: habit.category.color + '26' }]}>
                                  <Ionicons name={habit.category.icon} size={16} color={habit.category.color} />
                                </View>
                              ) : null}
                              <Text style={[styles.habitTitle, { flex: 1 }]} numberOfLines={2}>{habit.title}</Text>
                              <Ionicons name="chevron-forward" size={16} color={GRAY} />
                            </View>
                            <View style={styles.streakRow}>
                              <Ionicons name="flame-outline" size={22} color={streak > 0 ? FLAME : '#E0E0E0'} />
                              {streak > 0 ? (
                                <View style={styles.streakNums}>
                                  <Text style={styles.streakNumber}>{streak}</Text>
                                  <Text style={styles.streakUnit}>{t('activity.days')}</Text>
                                </View>
                              ) : null}
                            </View>
                            <WeekDots dots={dots} dayLabels={dayLabels} size={28} />
                            <Text style={styles.weekSummary}>
                              {t('activity.week_completed', { completed: weekCompleted })}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      {weeklyMemberHabits.map((habit) => {
                        const wCount = getWeeklyTargetCount(memberLogs, habit.id);
                        const wStreak = calculateWeeklyStreak(memberLogs, habit.id, habit.weekly_target || 1);
                        const monday = getWeekStart();
                        const weekLogs = memberLogs
                          .filter((l) => l.habit_id === habit.id && new Date(l.created_at) >= monday)
                          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                        const weekLogIds = weekLogs.map((l) => l.id);
                        const weekLogDates = weekLogs.map((l) => new Date(l.created_at));
                        const wValidatedCount = weekLogIds.filter((id) => validatedLogIds.has(id)).length;
                        return (
                          <TouchableOpacity
                            key={habit.id}
                            style={[styles.habitCard, { borderLeftColor: habit.category?.color ?? BLUE }]}
                            onPress={() => navigation.navigate('HabitStats', { habit, userId: member.id })}
                            activeOpacity={0.8}
                          >
                            <View style={styles.habitTitleRow}>
                              {habit.category ? (
                                <View style={[styles.catBadge, { backgroundColor: habit.category.color + '26' }]}>
                                  <Ionicons name={habit.category.icon} size={16} color={habit.category.color} />
                                </View>
                              ) : null}
                              <Text style={[styles.habitTitle, { flex: 1 }]} numberOfLines={2}>{habit.title}</Text>
                              <Ionicons name="chevron-forward" size={16} color={GRAY} />
                            </View>
                            <View style={styles.streakRow}>
                              <Ionicons name="flame-outline" size={22} color={wStreak > 0 ? FLAME : '#E0E0E0'} />
                              {wStreak > 0 ? (
                                <Text style={[styles.streakUnit, { color: FLAME }]}>
                                  {t('activity.weeks', { count: wStreak })}
                                </Text>
                              ) : null}
                            </View>
                            <WeeklyTargetDots count={wCount} target={habit.weekly_target || 1} validatedCount={wValidatedCount} weekLogDates={weekLogDates} dayLabels={dayLabels} />
                            <Text style={styles.weekSummary}>
                              {t('home.weekly_progress', { done: wCount, target: habit.weekly_target || 1 })}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      {onceMemberHabits.length > 0 ? (
                        <>
                          <View style={styles.eventsLabel}>
                            <Text style={styles.eventsLabelText}>{t('activity.events')}</Text>
                          </View>
                          {onceMemberHabits.map((habit) => (
                            <OnceHabitCard key={habit.id} habit={habit} logs={memberLogs} t={t} locale={locale} />
                          ))}
                        </>
                      ) : null}
                    </>
                  )}
                </View>
              );
            }

            // ── Non-admin: compact summary card (daily habits only for streak/dots) ──
            const dailyAssignedSet = new Set([...assignedSet].filter((id) => dailyHabitIdsSet.has(id)));
            const dots = getGeneralWeekDots(allLogs, dailyAssignedSet, member.id, validatedLogIds);
            const streak = calculateGeneralStreak(allLogs, dailyAssignedSet, member.id);
            const weekCompleted = dots.filter((s) => s !== 'none').length;

            return (
              <View key={member.id} style={styles.memberCard}>
                <View style={styles.memberHeader}>
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                  <View style={styles.memberStreakBadge}>
                    <Ionicons name="flame-outline" size={14} color={streak > 0 ? FLAME : '#E0E0E0'} />
                    {streak > 0 ? (
                      <Text style={styles.memberStreakNum}>{streak}</Text>
                    ) : null}
                  </View>
                </View>

                <WeekDots dots={dots} dayLabels={dayLabels} size={24} compact />

                <Text style={styles.weekSummary}>
                  {t('activity.member_progress', { completed: weekCompleted, total: 7 })}
                </Text>
              </View>
            );
          })}
        </>
      ) : null}

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    flexGrow: 1,
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
  sectionHeader: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sectionHeaderSpaced: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  // Habit cards (Section 1)
  habitCard: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 1,
    borderLeftWidth: 4,
  },
  habitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  catBadge: {
    width: 28,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  streakNums: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  streakNumber: {
    fontSize: 28,
    fontWeight: '700',
    color: FLAME,
    lineHeight: 32,
  },
  streakUnit: {
    fontSize: 13,
    fontWeight: '400',
    color: FLAME,
    paddingBottom: 3,
  },
  // Week dots
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weekRowCompact: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  dotCol: {
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  dotColCompact: {
    alignItems: 'center',
    gap: 3,
  },
  dotLabel: {
    fontSize: 10,
    color: GRAY,
    fontWeight: '600',
  },
  weekSummary: {
    fontSize: 12,
    color: GRAY,
    marginTop: 2,
  },
  // Member cards (Section 2)
  memberCard: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 1,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '800',
    color: BLUE,
  },
  memberName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  memberStreakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  memberStreakNum: {
    fontSize: 14,
    fontWeight: '700',
    color: FLAME,
  },
  // Admin expanded member view
  memberGroup: {
    marginTop: 8,
  },
  memberSubheader: {
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberSubheaderName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  memberNoHabits: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 1,
  },
  targetDotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  targetDotWrapper: {
    alignItems: 'center',
  },
  targetDotLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GRAY,
    marginBottom: 2,
    height: 14,
    lineHeight: 14,
  },
  // Once habits
  eventsLabel: {
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 4,
  },
  eventsLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  onceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  onceStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Empty state
  emptyCard: {
    backgroundColor: WHITE,
    padding: 24,
    alignItems: 'center',
    marginTop: 1,
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomPad: {
    height: 24,
  },
});
