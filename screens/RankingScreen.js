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
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';
const GRAY = '#64748b';
const GOLD = '#f59e0b';
const SILVER = '#94a3b8';
const BRONZE = '#b45309';
const HIGHLIGHT = '#e0f2fe';

const MEDALS = ['🥇', '🥈', '🥉'];

function ordinal(n) {
  return `${n}º`;
}

export default function RankingScreen() {
  const navigation = useNavigation();
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
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }

      setCurrentUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error('Tu perfil no tiene una empresa asignada.');

      const { data: companyProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('company_id', profile.company_id);
      if (profilesError) throw profilesError;

      const userIds = (companyProfiles ?? []).map((p) => p.id);

      const { data: logs, error: logsError } = await supabase
        .from('habit_logs')
        .select('user_id')
        .eq('status', 'validated')
        .in('user_id', userIds);
      if (logsError) throw logsError;

      const counts = {};
      (logs ?? []).forEach((log) => {
        counts[log.user_id] = (counts[log.user_id] || 0) + 1;
      });

      const sorted = (companyProfiles ?? [])
        .map((p) => ({ id: p.id, full_name: p.full_name, count: counts[p.id] || 0 }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count);

      setRanking(sorted);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el ranking. Revisa tu conexión.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

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
              {ordinal(index + 1)}
            </Text>
          )}
        </View>
        <View style={styles.nameBox}>
          <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
            {item.full_name || 'Usuario'}
          </Text>
          {isCurrentUser && <Text style={styles.youTag}>Tú</Text>}
        </View>
        <View style={styles.countBox}>
          <Text style={[styles.count, isCurrentUser && styles.countHighlight]}>{item.count}</Text>
          <Text style={[styles.countLabel, isCurrentUser && styles.countLabelHighlight]}>
            hábito{item.count !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={WHITE} />
        <Text style={styles.loadingText}>Cargando ranking...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ranking del equipo</Text>
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
            tintColor={WHITE}
          />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Aún no hay hábitos validados en tu empresa
              </Text>
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
    backgroundColor: NAVY,
    paddingTop: 56,
  },
  centered: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  loadingText: {
    color: WHITE,
    marginTop: 14,
    fontSize: 14,
    opacity: 0.9,
  },
  header: {
    paddingHorizontal: 18,
    marginBottom: 20,
  },
  backBtn: {
    marginBottom: 10,
  },
  backText: {
    color: WHITE,
    opacity: 0.8,
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: WHITE,
    fontSize: 24,
    fontWeight: '800',
  },
  errorBanner: {
    marginHorizontal: 18,
    marginBottom: 12,
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 28,
    flexGrow: 1,
  },
  row: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHighlight: {
    backgroundColor: HIGHLIGHT,
    borderWidth: 2,
    borderColor: '#0ea5e9',
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
    color: '#0284c7',
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
    color: '#0f172a',
    flexShrink: 1,
  },
  nameHighlight: {
    color: '#0284c7',
  },
  youTag: {
    backgroundColor: '#0284c7',
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
    color: NAVY,
  },
  countHighlight: {
    color: '#0284c7',
  },
  countLabel: {
    fontSize: 11,
    color: GRAY,
    fontWeight: '600',
  },
  countLabelHighlight: {
    color: '#0284c7',
  },
  emptyCard: {
    backgroundColor: WHITE,
    borderRadius: 12,
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
