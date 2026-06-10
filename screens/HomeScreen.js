import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const FAMILY_SETUP_KEY = 'family_setup_done';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const ORANGE = '#f97316';


function formatExpiry(dateStr) {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (d.getHours() !== 0 || d.getMinutes() !== 0) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${date} ${hh}:${mm}`;
  }
  return date;
}

function isDuePast(dueTime) {
  const [hh, mm] = dueTime.split(':').map(Number);
  const limit = new Date();
  limit.setHours(hh, mm, 0, 0);
  return new Date() > limit;
}

function sortHabitsByUrgency(habits) {
  function urgency(h) {
    if (h.completedToday || h.weeklyGoalMet || h.monthlyGoalMet) return 4;
    if (h.due_time) return isDuePast(h.due_time) ? 0 : 1;
    if (h.expires_at) return 2;
    return 3;
  }

  return [...habits].sort((a, b) => {
    const ua = urgency(a);
    const ub = urgency(b);
    if (ua !== ub) return ua - ub;
    if (ua === 1) return a.due_time.localeCompare(b.due_time);
    if (ua === 2) return new Date(a.expires_at) - new Date(b.expires_at);
    return 0;
  });
}


function getFirstName(fullName, fallback) {
  if (!fullName?.trim()) return fallback;
  return fullName.trim().split(/\s+/)[0];
}

function ValidatorAvatar({ profile, status, size = 28 }) {
  const initial = (profile?.full_name || '?').charAt(0).toUpperCase();
  const borderColor = status === 'validated' ? '#4CAF50' : '#F44336';
  const innerSize = size - 4;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor, backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' }}>
      {profile?.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }} />
      ) : (
        <Text style={{ fontSize: Math.floor(size * 0.38), fontWeight: '700', color: '#0A66C2' }}>{initial}</Text>
      )}
    </View>
  );
}

function ValidatorRow({ profile, status, comment, reaction }) {
  const name = profile?.full_name || '?';
  const isPending = status === 'pending';
  return (
    <View style={styles.validatorRow}>
      {profile?.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={styles.validatorRowAvatar} />
      ) : (
        <View style={[styles.validatorRowAvatarFallback, { backgroundColor: isPending ? '#E8E8E8' : '#0A66C2' }]}>
          <Text style={[styles.validatorRowInitial, { color: isPending ? '#666666' : '#ffffff' }]}>
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.validatorRowInfo}>
        <View style={styles.validatorRowNameRow}>
          <Text style={[styles.validatorRowName, isPending && { color: '#666666' }]} numberOfLines={1}>{name}</Text>
          {reaction ? <Text style={styles.validatorReaction}>{reaction}</Text> : null}
        </View>
        {comment ? <Text style={styles.validatorComment}>{comment}</Text> : null}
      </View>
      {status === 'validated' ? <Ionicons name="checkmark-circle" size={18} color="#2E7D32" /> : null}
      {status === 'rejected'  ? <Ionicons name="close-circle"     size={18} color="#DC2626" /> : null}
    </View>
  );
}


export default function HomeScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const [categoriesMap, setCategoriesMap] = useState({});
  const { t } = useTranslation();

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [pulseHabitId, setPulseHabitId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [habits, setHabits] = useState([]);
  const [detailHabit, setDetailHabit] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Pulso verde en la tarjeta recién completada al volver de HabitDetailScreen
  useEffect(() => {
    const id = route.params?.justCompletedHabitId;
    if (!id) return;
    navigation.setParams({ justCompletedHabitId: undefined });
    const timer = setTimeout(() => {
      setPulseHabitId(id);
      pulseAnim.setValue(0);
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.25, duration: 300, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0,    duration: 300, useNativeDriver: true }),
      ]).start(() => setPulseHabitId(null));
    }, 700);
    return () => clearTimeout(timer);
  }, [route.params?.justCompletedHabitId]);

  // Si el admin no tiene hábitos ni ha configurado su familia todavía → ir a pestaña Familia
  useEffect(() => {
    let cancelled = false;
    const checkFamilySetup = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        let { data: prof } = await supabase
          .from('profiles').select('role, company_id').eq('id', user.id).maybeSingle();

        if (!prof && !cancelled) {
          await new Promise((r) => setTimeout(r, 800));
          if (cancelled) return;
          ({ data: prof } = await supabase
            .from('profiles').select('role, company_id').eq('id', user.id).maybeSingle());
        }

        if (!prof || prof.role !== 'admin' || !prof.company_id || cancelled) return;

        const done = await AsyncStorage.getItem(FAMILY_SETUP_KEY);
        if (done || cancelled) return;

        const { count } = await supabase
          .from('habits').select('id', { count: 'exact', head: true })
          .eq('company_id', prof.company_id).eq('is_active', true);

        if ((count ?? 0) === 0 && !cancelled) {
          navigation.navigate('Admin', { initialTab: 'family' });
        }
      } catch (e) {
        // No-crítico: la redirección de onboarding del admin falla silenciosamente
        if (__DEV__) console.warn('checkFamilySetup error:', e?.message);
      }
    };
    checkFamilySetup();
    return () => { cancelled = true; };
  }, []);

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
        .select('id, full_name, company_id, role')
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
      setIsAdmin(profileData.role === 'admin');

      // Solo hábitos asignados explícitamente al usuario
      const { data: assignments, error: assignmentsError } = await supabase
        .from('habit_assignments')
        .select('habit_id')
        .eq('user_id', user.id);
      if (assignmentsError) throw assignmentsError;

      const assignedIds = (assignments ?? []).map((a) => a.habit_id);
      if (!assignedIds.length) {
        setHabits([]);
        return;
      }

      const { data: habitsData, error: habitsError } = await supabase
        .from('habits')
        .select('id, title, description, company_id, type, recurrence, is_active, created_at, expires_at, due_time, category_id, weekly_target, monthly_target, photo_required')
        .eq('company_id', profileData.company_id)
        .eq('is_active', true)
        .in('id', assignedIds)
        .order('created_at', { ascending: true });

      if (habitsError) throw habitsError;

      const now = new Date();
      const active = (habitsData ?? []).filter(
        (h) => !h.expires_at || new Date(h.expires_at) > now
      );

      const habitIds = active.map((h) => h.id);

      const [logsResult, catsResult, validatorsResult] = await Promise.all([
        habitIds.length > 0
          ? supabase.from('habit_logs').select('id, habit_id, created_at, habit_validations(habit_log_id, status, validator_id, comment, reaction)').eq('user_id', user.id).in('habit_id', habitIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('categories').select('id, name, icon, color').or(`company_id.is.null,company_id.eq.${profileData.company_id}`),
        habitIds.length > 0
          ? supabase.from('habit_validators').select('habit_id, user_id, profiles(id, full_name, avatar_url)').in('habit_id', habitIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (logsResult.error) throw logsResult.error;
      if (validatorsResult.error) throw validatorsResult.error;

      const logsData = logsResult.data ?? [];
      const cMap = {};
      (catsResult.data ?? []).forEach((c) => { cMap[c.id] = c; });
      setCategoriesMap(cMap);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Week start (Monday) for weekly_x habits
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
      weekStart.setHours(0, 0, 0, 0);
      const weekLogs = logsData.filter((l) => new Date(l.created_at) >= weekStart);
      const weeklyCountMap = {};
      weekLogs.forEach((l) => {
        weeklyCountMap[l.habit_id] = (weeklyCountMap[l.habit_id] || 0) + 1;
      });

      // Month start for monthly_x habits
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const monthLogs = logsData.filter((l) => { const d = new Date(l.created_at); return d >= monthStart && d < monthEnd; });
      const monthlyCountMap = {};
      monthLogs.forEach((l) => {
        monthlyCountMap[l.habit_id] = (monthlyCountMap[l.habit_id] || 0) + 1;
      });

      const doneEver = new Set(logsData.map((l) => l.habit_id));
      const todayLogs = logsData.filter((l) => new Date(l.created_at) >= todayStart);
      const doneToday = new Set(todayLogs.map((l) => l.habit_id));

      const todayLogIdByHabit = {};
      todayLogs.forEach((l) => { todayLogIdByHabit[l.habit_id] = l.id; });

      const validationsMap = {};
      todayLogs.forEach((l) => {
        if (l.habit_validations?.length) {
          validationsMap[l.id] = { validatedCount: 0, rejectedCount: 0 };
          l.habit_validations.forEach((v) => {
            if (v.status === 'validated') validationsMap[l.id].validatedCount++;
            if (v.status === 'rejected') validationsMap[l.id].rejectedCount++;
          });
        }
      });

      // habitId → [{userId, profile}]
      const validatorsPerHabit = {};
      (validatorsResult.data ?? []).forEach((v) => {
        if (!validatorsPerHabit[v.habit_id]) validatorsPerHabit[v.habit_id] = [];
        validatorsPerHabit[v.habit_id].push({
          userId: v.user_id,
          profile: v.profiles ?? { id: v.user_id, full_name: null, avatar_url: null },
        });
      });

      // logId → [{validatorId, status}]
      const todayValidationsPerLog = {};
      todayLogs.forEach((l) => {
        if (l.habit_validations?.length) {
          todayValidationsPerLog[l.id] = l.habit_validations.map((v) => ({
            validatorId: v.validator_id,
            status: v.status,
            comment: v.comment ?? null,
            reaction: v.reaction ?? null,
          }));
        }
      });

      const processed = active
        .filter((h) => h.recurrence !== 'once' || !doneEver.has(h.id))
        .map((h) => {
          const weeklyCount = h.recurrence === 'weekly_x' ? (weeklyCountMap[h.id] || 0) : 0;
          const weeklyGoalMet = h.recurrence === 'weekly_x' && weeklyCount >= (h.weekly_target || 1);
          const monthlyCount = h.recurrence === 'monthly_x' ? (monthlyCountMap[h.id] || 0) : 0;
          const monthlyGoalMet = h.recurrence === 'monthly_x' && monthlyCount >= (h.monthly_target || 1);
          const completedToday = doneToday.has(h.id);
          const logId = todayLogIdByHabit[h.id];
          const vCounts = (completedToday && logId && validationsMap[logId]) || null;
          return {
            ...h,
            completedToday,
            weeklyCount,
            weeklyGoalMet,
            monthlyCount,
            monthlyGoalMet,
            todayValidatedCount: vCounts?.validatedCount ?? 0,
            todayRejectedCount:  vCounts?.rejectedCount  ?? 0,
            todayValidations: (completedToday && logId) ? (todayValidationsPerLog[logId] ?? []) : [],
            validators: validatorsPerHabit[h.id] ?? [],
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
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

  const onCompleteHabit = (habit) => {
    navigation.navigate('HabitDetail', { habit });
  };

  const renderHabit = ({ item }) => {
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
        statusText = t('home.awaiting_validation');
        statusColor = '#F59E0B';
      }
    } else if (item.weeklyGoalMet) {
      completedCardStyle = styles.habitCardValidated;
    }

    const cat = item.category_id ? categoriesMap[item.category_id] : null;

    // Avatar stack data (only voted validators)
    const validatorById = {};
    (item.validators ?? []).forEach((v) => { validatorById[v.userId] = v.profile; });
    const voted = item.todayValidations ?? [];
    const visibleVoters = voted.slice(0, 4);
    const overflowCount = voted.length - visibleVoters.length;
    const totalValidators = (item.validators ?? []).filter((v) => v.userId !== profile?.id).length;

    const showValidators = (item.validators?.length ?? 0) > 0 && item.completedToday;
    const isCardTappable = item.completedToday;
    const Card = isCardTappable ? TouchableOpacity : View;
    const cardPressProps = isCardTappable
      ? { onPress: () => setDetailHabit(item), activeOpacity: 0.92 }
      : {};

    return (
      <Card style={[styles.habitCard, completedCardStyle]} {...cardPressProps}>
        {item.id === pulseHabitId ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#4CAF50', opacity: pulseAnim }]}
          />
        ) : null}
        <View style={styles.habitTitleRow}>
          <Text style={styles.habitTitle}>{item.title}</Text>
          {cat ? (
            <View style={[styles.catBadge, { backgroundColor: cat.color + '26' }]}>
              <Ionicons name={cat.icon} size={16} color={cat.color} />
            </View>
          ) : null}
        </View>
        {item.description ? <Text style={styles.habitDescription}>{item.description}</Text> : null}
        {item.recurrence === 'daily' && item.due_time ? (
          <Text style={[styles.dueTimeText, !item.completedToday && isDuePast(item.due_time) && styles.dueTimeUrgent]}>
            {t('home.due_before', { time: item.due_time.slice(0, 5) })}
          </Text>
        ) : null}
        {item.expires_at ? (
          <Text style={styles.expiryText}>
            {t('home.expires', { date: formatExpiry(item.expires_at) })}
          </Text>
        ) : null}
        {item.recurrence === 'weekly_x' ? (
          <Text style={styles.weeklyProgressText}>
            {t('home.weekly_progress', { done: item.weeklyCount, target: item.weekly_target })}
          </Text>
        ) : null}
        {item.recurrence === 'monthly_x' ? (
          <Text style={styles.weeklyProgressText}>
            {t('home.monthly_progress', { done: item.monthlyCount, target: item.monthly_target })}
          </Text>
        ) : null}
        {item.completedToday ? (
          <View style={styles.completedRow}>
            <View style={styles.completedLeft}>
              <Ionicons name="checkmark-circle" size={16} color={statusColor} />
              <Text style={[styles.completedText, { color: statusColor }]}>{statusText}</Text>
            </View>
          </View>
        ) : item.weeklyGoalMet ? (
          <View style={styles.completedRow}>
            <View style={styles.completedLeft}>
              <Ionicons name="checkmark-circle" size={16} color="#2E7D32" />
              <Text style={[styles.completedText, { color: '#2E7D32' }]}>{t('home.weekly_goal_met')}</Text>
            </View>
          </View>
        ) : item.monthlyGoalMet ? (
          <View style={styles.completedRow}>
            <View style={styles.completedLeft}>
              <Ionicons name="checkmark-circle" size={16} color="#2E7D32" />
              <Text style={[styles.completedText, { color: '#2E7D32' }]}>{t('home.monthly_goal_met')}</Text>
            </View>
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
        {showValidators ? (
          <View style={styles.validatorSection}>
            <View style={styles.avatarStack}>
              {visibleVoters.map((vote, idx) => (
                <View key={vote.validatorId} style={[styles.avatarItem, { marginLeft: idx > 0 ? -8 : 0, zIndex: 4 - idx }]}>
                  <ValidatorAvatar profile={validatorById[vote.validatorId]} status={vote.status} />
                </View>
              ))}
              {overflowCount > 0 ? (
                <View style={[styles.avatarItem, styles.avatarOverflow, { marginLeft: -8, zIndex: 0 }]}>
                  <Text style={styles.avatarOverflowText}>+{overflowCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.validatorCountText}>
              {t('home.validators_count', { done: voted.length, total: totalValidators })}
            </Text>
          </View>
        ) : null}
      </Card>
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

  // Precompute modal sections when a completed card is tapped
  let modalSections = null;
  if (detailHabit) {
    const vById = {};
    detailHabit.validators.forEach((v) => { vById[v.userId] = v.profile; });
    const approved = detailHabit.todayValidations
      .filter((v) => v.status === 'validated')
      .map((v) => ({ ...v, profile: vById[v.validatorId] }));
    const rejected = detailHabit.todayValidations
      .filter((v) => v.status === 'rejected')
      .map((v) => ({ ...v, profile: vById[v.validatorId] }));
    const votedIds = new Set(detailHabit.todayValidations.map((v) => v.validatorId));
    const pending = detailHabit.validators.filter((v) => !votedIds.has(v.userId) && v.userId !== profile?.id);
    modalSections = { approved, rejected, pending };
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('home.greeting', { name: getFirstName(profile?.full_name, t('profile.role_user')) })}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.listCard}>
        <FlatList
          data={sortHabitsByUrgency(habits)}
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
              isAdmin ? (
                <View style={styles.emptyState}>
                  <Ionicons name="add-circle-outline" size={52} color={BLUE} />
                  <Text style={styles.emptyText}>{t('home.empty_admin')}</Text>
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => navigation.navigate('Admin')}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.emptyBtnText}>{t('home.create_habit')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="time-outline" size={52} color={GRAY} />
                  <Text style={styles.emptyText}>{t('home.empty_user')}</Text>
                  <Text style={styles.emptySubText}>{t('home.empty_user_sub')}</Text>
                </View>
              )
            ) : null
          }
        />
      </View>

      {/* Modal de detalle de validadores */}
      <Modal
        visible={!!detailHabit}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailHabit(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailHabit(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>{detailHabit?.title}</Text>
              <TouchableOpacity onPress={() => setDetailHabit(null)} style={styles.modalCloseBtn} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={TEXT} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              {modalSections?.approved.length > 0 ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{t('home.validators_approved')}</Text>
                  {modalSections.approved.map((v) => (
                    <ValidatorRow key={v.validatorId} profile={v.profile} status="validated" comment={v.comment} reaction={v.reaction} />
                  ))}
                </View>
              ) : null}

              {modalSections?.rejected.length > 0 ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{t('home.validators_rejected')}</Text>
                  {modalSections.rejected.map((v) => (
                    <ValidatorRow key={v.validatorId} profile={v.profile} status="rejected" comment={v.comment} reaction={v.reaction} />
                  ))}
                </View>
              ) : null}

              {modalSections?.pending.length > 0 ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{t('home.validators_pending')}</Text>
                  {modalSections.pending.map((v) => (
                    <ValidatorRow key={v.userId} profile={v.profile} status="pending" />
                  ))}
                </View>
              ) : null}
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
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    marginBottom: 16,
  },
  greeting: {
    color: GRAY,
    fontSize: 16,
    fontWeight: '500',
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
    overflow: 'hidden',
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
  habitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  habitTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    flex: 1,
  },
  catBadge: {
    width: 28,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitDescription: {
    marginTop: 6,
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  dueTimeText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: GRAY,
  },
  dueTimeUrgent: {
    color: ORANGE,
  },
  expiryText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: GRAY,
  },
  weeklyProgressText: {
    marginTop: 10,
    fontSize: 12,
    color: GRAY,
    fontWeight: '500',
    textAlign: 'center',
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
  // Validator avatar stack (completed card)
  validatorSection: {
    marginTop: 10,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  avatarItem: {
    // zIndex and marginLeft applied inline
  },
  avatarOverflow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverflowText: {
    fontSize: 10,
    fontWeight: '700',
    color: GRAY,
  },
  validatorCountText: {
    fontSize: 11,
    color: GRAY,
    fontWeight: '500',
  },
  // Detail modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: WHITE,
    borderRadius: 12,
    width: '100%',
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: TEXT,
  },
  modalCloseBtn: {
    padding: 2,
    marginLeft: 8,
  },
  modalScrollContent: {
    paddingBottom: 16,
  },
  modalSection: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  validatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  validatorRowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  validatorRowAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validatorRowInitial: {
    fontSize: 14,
    fontWeight: '700',
  },
  validatorRowInfo: {
    flex: 1,
  },
  validatorRowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  validatorRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    flexShrink: 1,
  },
  validatorReaction: {
    fontSize: 16,
  },
  validatorComment: {
    fontSize: 13,
    fontStyle: 'italic',
    color: GRAY,
    marginTop: 1,
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 13,
    color: GRAY,
    textAlign: 'center',
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  emptyBtn: {
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'center',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  emptyBtnText: {
    color: WHITE,
    fontWeight: '600',
    fontSize: 14,
  },
});
