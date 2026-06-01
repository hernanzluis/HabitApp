import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';

function formatDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ValidateHabitScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [allDone, setAllDone] = useState(false);

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
      console.log('Profile:', profile);

      const { data: logsData, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, habit_id, user_id, photo_url, status, created_at')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (logsError) throw logsError;
      console.log('Logs pendientes:', logsData);
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
      console.log('Items finales:', normalized);
    } catch (e) {
      setError(e?.message || t('validate.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const submitValidation = async (logId, voteStatus) => {
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
        .insert({ habit_log_id: logId, validator_id: user.id, status: voteStatus });

      if (insertError) throw insertError;

      setItems((prev) => {
        const updated = prev.filter((item) => item.id !== logId);
        if (updated.length === 0) {
          setAllDone(true);
          setTimeout(() => navigation.navigate('Home'), 1000);
        }
        return updated;
      });
    } catch (e) {
      console.log('Error al validar:', JSON.stringify(e));
      setError(e?.message || t('validate.error_submit'));
    }
  };

  const renderItem = ({ item }) => {
    const { companion, habit } = item;
    const name = companion?.full_name || t('common.colleague');
    const title = habit?.title || t('validate.habit_fallback');
    const { userValidated, userVote, validatedCount, rejectedCount } = item;

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
            <Text style={styles.date}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        {item.photo_url ? (
          <View style={styles.photoWrapper}>
            <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="contain" />
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

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn, userValidated && styles.actionBtnDisabled]}
            onPress={() => !userValidated && submitValidation(item.id, 'rejected')}
            activeOpacity={userValidated ? 1 : 0.9}
          >
            <Text style={[styles.rejectText, userValidated && styles.actionTextDisabled]}>{t('validate.reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn, userValidated && styles.actionBtnDisabled]}
            onPress={() => !userValidated && submitValidation(item.id, 'validated')}
            activeOpacity={userValidated ? 1 : 0.9}
          >
            <Text style={[styles.approveText, userValidated && styles.actionTextDisabled]}>{t('validate.approve')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('validate.loading')}</Text>
      </View>
    );
  }

  if (allDone) {
    return (
      <View style={styles.centered}>
        <Text style={styles.allDoneText}>{t('validate.all_done')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
});

