import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
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

function formatDate(dateString, locale) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const REACTIONS = ['👏', '❤️', '💪', '😊', '🌟'];
const REACTION_BLUE_BG = '#EEF3FB';

function ValidateCard({ item, onVote, t, locale }) {
  const [comment, setComment] = useState('');
  const [reaction, setReaction] = useState(null);
  const { companion, habit } = item;
  const name = companion?.full_name || t('common.colleague');
  const title = habit?.title || t('validate.habit_fallback');
  const { userValidated, userVote, validatedCount, rejectedCount } = item;

  const handleVote = (status) => {
    onVote(item.id, status, comment.trim() || null, reaction);
    setComment('');
    setReaction(null);
  };

  const toggleReaction = (emoji) => {
    setReaction((prev) => (prev === emoji ? null : emoji));
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.avatarWrapper}>
          {companion?.avatar_url ? (
            <Image source={{ uri: companion.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.habitTitle}>{title}</Text>
          <Text style={styles.date}>{formatDate(item.created_at, locale)}</Text>
        </View>
      </View>

      {item.photo_url ? (
        <View style={styles.photoWrapper}>
          <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="contain" />
        </View>
      ) : (
        <View style={styles.noPhotoContainer}>
          <Ionicons name="checkmark-circle-outline" size={48} color="#C0C0C0" />
          <Text style={styles.noPhotoText}>{t('validate.no_photo')}</Text>
        </View>
      )}

      {item.notes ? (
        <View style={styles.notesBox}>
          <Text style={styles.notesText}>{item.notes}</Text>
        </View>
      ) : null}

      <View style={styles.countsRow}>
        <Text style={styles.countApprove}>✓ {validatedCount}</Text>
        <Text style={styles.countReject}>✗ {rejectedCount}</Text>
        {userValidated ? (
          <Text style={styles.votedLabel}>
            {userVote === 'validated' ? t('validate.approved') : t('validate.rejected_label')}
          </Text>
        ) : null}
      </View>

      <Text style={styles.reactionLabel}>{t('validate.reaction_label')}</Text>
      <View style={styles.reactionsRow}>
        {REACTIONS.map((emoji) => {
          const selected = reaction === emoji;
          return (
            <TouchableOpacity
              key={emoji}
              style={[styles.reactionBtn, selected && styles.reactionBtnSelected]}
              onPress={() => toggleReaction(emoji)}
              activeOpacity={0.8}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.commentLabel}>{t('validate.comment_label')}</Text>
      <TextInput
        style={styles.commentInput}
        value={comment}
        onChangeText={setComment}
        placeholder={t('validate.comment_placeholder')}
        placeholderTextColor={GRAY}
        multiline
        maxLength={150}
      />

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn, userValidated && styles.actionBtnDisabled]}
          onPress={() => !userValidated && handleVote('rejected')}
          activeOpacity={userValidated ? 1 : 0.9}
        >
          <Text style={[styles.rejectText, userValidated && styles.actionTextDisabled]}>{t('validate.reject')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn, userValidated && styles.actionBtnDisabled]}
          onPress={() => !userValidated && handleVote('validated')}
          activeOpacity={userValidated ? 1 : 0.9}
        >
          <Text style={[styles.approveText, userValidated && styles.actionTextDisabled]}>{t('validate.approve')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ValidateHabitScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';
  const [activeTab, setActiveTab] = useState('validate');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [allDone, setAllDone] = useState(false);
  const navTimeoutRef = useRef(null);

  // ── Expired tab state ──────────────────────────────────────────────────
  const [expiredLoading, setExpiredLoading] = useState(false);
  const [expiredItems, setExpiredItems] = useState([]);
  const [expiredError, setExpiredError] = useState('');

  useEffect(() => {
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
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
        setError(t('validate.error_no_session'));
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, company_id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      if (!profile?.company_id) {
        setError(t('errors.no_company'));
        setItems([]);
        return;
      }

      const { data: validatorHabits, error: validatorError } = await supabase
        .from('habit_validators')
        .select('habit_id')
        .eq('user_id', user.id);
      if (validatorError) throw validatorError;
      const validatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);
      if (!validatorHabitIds.length) {
        setItems([]);
        return;
      }

      const { data: logsData, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, habit_id, user_id, photo_url, status, notes, created_at')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .in('habit_id', validatorHabitIds)
        .order('created_at', { ascending: false });

      if (logsError) throw logsError;
      if (!logsData?.length) {
        setItems([]);
        return;
      }

      const userIds = [...new Set(logsData.map((row) => row.user_id).filter(Boolean))];
      const habitIds = [...new Set(logsData.map((row) => row.habit_id).filter(Boolean))];

      const logIds = logsData.map((l) => l.id);

      const [
        { data: profilesData, error: profilesError },
        { data: habitsData, error: habitsError },
        { data: validationsData, error: validationsError },
      ] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
        habitIds.length
          ? supabase.from('habits').select('id, title, description, company_id').in('id', habitIds)
          : Promise.resolve({ data: [], error: null }),
        logIds.length
          ? supabase.from('habit_validations').select('habit_log_id, validator_id, status').in('habit_log_id', logIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesError) throw profilesError;
      if (habitsError) throw habitsError;
      if (validationsError) throw validationsError;

      const profilesMap = new Map((profilesData || []).map((p) => [p.id, p]));
      const habitsMap = new Map((habitsData || []).map((h) => [h.id, h]));

      const validationsMap = {};
      (validationsData || []).forEach((v) => {
        if (!validationsMap[v.habit_log_id]) {
          validationsMap[v.habit_log_id] = { validatedCount: 0, rejectedCount: 0, userValidated: false, userVote: null };
        }
        if (v.status === 'validated') validationsMap[v.habit_log_id].validatedCount++;
        if (v.status === 'rejected') validationsMap[v.habit_log_id].rejectedCount++;
        if (v.validator_id === user.id) {
          validationsMap[v.habit_log_id].userValidated = true;
          validationsMap[v.habit_log_id].userVote = v.status;
        }
      });

      const normalized = logsData
        .map((log) => ({
          ...log,
          companion: profilesMap.get(log.user_id) || null,
          habit: habitsMap.get(log.habit_id) || null,
          ...(validationsMap[log.id] || { validatedCount: 0, rejectedCount: 0, userValidated: false, userVote: null }),
        }))
        .filter((row) => row.habit && row.habit.company_id === profile.company_id)
        .filter((row) => !row.userValidated);

      setItems(normalized);
    } catch (e) {
      setError(e?.message || t('validate.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadExpired = useCallback(async () => {
    setExpiredLoading(true);
    setExpiredError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, company_id, role')
        .eq('id', user.id)
        .single();
      if (!profile?.company_id) { setExpiredItems([]); return; }

      // Hábitos que el usuario valida
      const { data: validatorRows } = await supabase
        .from('habit_validators')
        .select('habit_id')
        .eq('user_id', user.id);
      const validatorHabitIds = (validatorRows ?? []).map((v) => v.habit_id);
      if (!validatorHabitIds.length) { setExpiredItems([]); return; }

      const now = new Date().toISOString();

      // Hábitos caducados (expires_at en el pasado, activos, que el usuario valida)
      const { data: expiredHabits } = await supabase
        .from('habits')
        .select('id, title, expires_at, category_id, company_id')
        .in('id', validatorHabitIds)
        .eq('is_active', true)
        .not('expires_at', 'is', null)
        .lt('expires_at', now);

      const filtered = (expiredHabits ?? []).filter((h) => h.company_id === profile.company_id);
      if (!filtered.length) { setExpiredItems([]); return; }

      const expiredHabitIds = filtered.map((h) => h.id);

      // Miembros asignados + logs + categorías en paralelo
      const [assignmentsRes, logsRes, catsRes] = await Promise.all([
        supabase.from('habit_assignments').select('habit_id, user_id').in('habit_id', expiredHabitIds),
        supabase.from('habit_logs')
          .select('id, habit_id, user_id, status')
          .in('habit_id', expiredHabitIds),
        supabase.from('categories').select('id, name, color, icon').or(`company_id.is.null,company_id.eq.${profile.company_id}`),
      ]);

      const assignments = assignmentsRes.data ?? [];
      const logs = logsRes.data ?? [];
      const catsMap = new Map((catsRes.data ?? []).map((c) => [c.id, c]));

      // Profiles de miembros asignados
      const assignedUserIds = [...new Set(assignments.map((a) => a.user_id))];
      const { data: profilesData } = assignedUserIds.length
        ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', assignedUserIds)
        : Promise.resolve({ data: [] });
      const profilesMap = new Map((profilesData ?? []).map((p) => [p.id, p]));

      // Build rows: habit × assigned member
      const rows = [];
      for (const habit of filtered) {
        const category = habit.category_id ? (catsMap.get(habit.category_id) ?? null) : null;
        const assigned = assignments.filter((a) => a.habit_id === habit.id);
        for (const a of assigned) {
          const memberLogs = logs.filter((l) => l.habit_id === habit.id && l.user_id === a.user_id);
          const hasValidated = memberLogs.some((l) => l.status === 'validated');
          if (hasValidated) continue; // correcto, no mostrar
          const hasLog = memberLogs.length > 0;
          rows.push({
            key: `${habit.id}-${a.user_id}`,
            habit: { ...habit, category },
            member: profilesMap.get(a.user_id) ?? { id: a.user_id, full_name: null, avatar_url: null },
            hasLog,
          });
        }
      }

      setExpiredItems(rows);
    } catch (e) {
      setExpiredError(e?.message || t('validate.error_load'));
    } finally {
      setExpiredLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      loadExpired();
    }, [loadData, loadExpired])
  );

  const submitValidation = async (logId, voteStatus, comment, reaction) => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setError(t('validate.error_no_session'));
        return;
      }

      const { error: insertError } = await supabase
        .from('habit_validations')
        .insert({ habit_log_id: logId, validator_id: user.id, status: voteStatus, comment, reaction: reaction ?? null });

      if (insertError) throw insertError;

      setItems((prev) => {
        const updated = prev.filter((item) => item.id !== logId);
        if (updated.length === 0) {
          setAllDone(true);
          navTimeoutRef.current = setTimeout(() => navigation.navigate('Home'), 1000);
        }
        return updated;
      });
    } catch (e) {
      setError(e?.message || t('validate.error_submit'));
    }
  };

  const renderItem = ({ item }) => (
    <ValidateCard item={item} onVote={submitValidation} t={t} locale={locale} />
  );

  if (loading && activeTab === 'validate') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('validate.loading')}</Text>
      </View>
    );
  }

  if (allDone && activeTab === 'validate') {
    return (
      <View style={styles.centered}>
        <Text style={styles.allDoneText}>{t('validate.all_done')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Tab selector ─────────────────────────────────────────────────── */}
      <View style={styles.tabUnderlineRow}>
        {['validate', 'expired'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={styles.tabUnderlineItem}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabUnderlineText, activeTab === tab && styles.tabUnderlineTextActive]}>
              {tab === 'validate' ? t('validate.tab_validate') : t('validate.tab_expired')}
            </Text>
            {activeTab === tab ? <View style={styles.tabUnderlineIndicator} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Pestaña Validar ───────────────────────────────────────────────── */}
      {activeTab === 'validate' ? (
        <>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={BLUE} />
            }
            ListEmptyComponent={
              !error ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>{t('validate.empty')}</Text>
                </View>
              ) : null
            }
          />
        </>
      ) : (
        /* ── Pestaña Caducados ─────────────────────────────────────────── */
        <>
          {expiredError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{expiredError}</Text>
            </View>
          ) : null}
          {expiredLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={BLUE} />
            </View>
          ) : (
            <FlatList
              data={expiredItems}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => loadExpired()} tintColor={BLUE} />
              }
              ListEmptyComponent={
                !expiredError ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyText}>{t('validate.expired_empty')}</Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                const name = item.member?.full_name || t('common.colleague');
                const expiredDate = item.habit.expires_at
                  ? new Date(item.habit.expires_at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '';
                return (
                  <View style={styles.expiredCard}>
                    <View style={styles.row}>
                      <View style={styles.avatarWrapper}>
                        {item.member?.avatar_url ? (
                          <Image source={{ uri: item.member.avatar_url }} style={styles.avatar} />
                        ) : (
                          <View style={styles.avatarFallback}>
                            <Text style={styles.avatarFallbackText}>{name.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.info}>
                        <Text style={styles.name}>{name}</Text>
                        <View style={styles.expiredHabitRow}>
                          {item.habit.category ? (
                            <View style={[styles.expiredCatDot, { backgroundColor: item.habit.category.color }]} />
                          ) : null}
                          <Text style={styles.habitTitle}>{item.habit.title}</Text>
                        </View>
                        <Text style={styles.expiredDate}>{t('validate.expired_on', { date: expiredDate })}</Text>
                      </View>
                      <View style={[styles.expiredBadge, item.hasLog ? styles.expiredBadgeOrange : styles.expiredBadgeRed]}>
                        <Text style={[styles.expiredBadgeText, item.hasLog ? styles.expiredBadgeTextOrange : styles.expiredBadgeTextRed]}>
                          {item.hasLog ? t('validate.not_validated_short') : t('validate.not_completed')}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
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
  allDoneText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#166534',
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
    paddingBottom: 18,
  },
  card: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
  },
  avatarWrapper: {
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: BLUE,
    fontWeight: '800',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  habitTitle: {
    marginTop: 2,
    fontSize: 13,
    color: GRAY,
  },
  date: {
    marginTop: 2,
    fontSize: 12,
    color: GRAY,
  },
  photoWrapper: {
    marginTop: 10,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  photo: {
    width: '100%',
    height: 250,
  },
  noPhotoContainer: {
    marginTop: 10,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  noPhotoText: {
    fontSize: 13,
    color: '#C0C0C0',
    fontWeight: '500',
  },
  countsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  countApprove: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  countReject: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b91c1c',
  },
  votedLabel: {
    fontSize: 12,
    color: GRAY,
    fontWeight: '600',
    marginLeft: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionTextDisabled: {
    opacity: 0.6,
  },
  rejectBtn: {
    marginRight: 8,
    backgroundColor: '#fee2e2',
  },
  approveBtn: {
    marginLeft: 8,
    backgroundColor: '#bbf7d0',
  },
  rejectText: {
    color: '#b91c1c',
    fontWeight: '800',
  },
  approveText: {
    color: '#166534',
    fontWeight: '800',
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
  },
  notesBox: {
    marginTop: 8,
    backgroundColor: '#F9F9F9',
    borderRadius: 4,
    padding: 8,
  },
  notesText: {
    color: GRAY,
    fontSize: 13,
  },
  reactionLabel: {
    marginTop: 10,
    fontSize: 12,
    color: GRAY,
    marginBottom: 6,
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  reactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
  },
  reactionBtnSelected: {
    backgroundColor: REACTION_BLUE_BG,
    borderColor: BLUE,
  },
  reactionEmoji: {
    fontSize: 22,
  },
  commentLabel: {
    marginTop: 0,
    fontSize: 12,
    color: GRAY,
    marginBottom: 4,
  },
  commentInput: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 4,
    padding: 12,
    minHeight: 80,
    fontSize: 14,
    color: TEXT,
    textAlignVertical: 'top',
  },
  // Tab selector (same pattern as AdminScreen)
  tabUnderlineRow: { flexDirection: 'row', backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  tabUnderlineItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabUnderlineText: { fontSize: 14, fontWeight: '500', color: GRAY },
  tabUnderlineTextActive: { color: TEXT, fontWeight: '700' },
  tabUnderlineIndicator: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: BLUE },
  // Expired tab
  expiredCard: { backgroundColor: WHITE, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8 },
  expiredHabitRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  expiredCatDot: { width: 8, height: 8, borderRadius: 4 },
  expiredDate: { marginTop: 2, fontSize: 12, color: GRAY },
  expiredBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, alignSelf: 'center', marginLeft: 8 },
  expiredBadgeRed: { backgroundColor: '#fee2e2' },
  expiredBadgeOrange: { backgroundColor: '#FEF3C7' },
  expiredBadgeText: { fontSize: 11, fontWeight: '700' },
  expiredBadgeTextRed: { color: '#b91c1c' },
  expiredBadgeTextOrange: { color: '#92400E' },
});

