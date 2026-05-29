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
import { useFocusEffect } from '@react-navigation/native';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);

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
        setError('Debes iniciar sesión para validar hábitos.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, company_id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      if (!profile?.company_id) {
        setError('Tu perfil no tiene una empresa asignada.');
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

      const [{ data: profilesData, error: profilesError }, { data: habitsData, error: habitsError }] =
        await Promise.all([
          userIds.length
            ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds)
            : Promise.resolve({ data: [], error: null }),
          habitIds.length
            ? supabase.from('habits').select('id, title, description, company_id').in('id', habitIds)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (profilesError) throw profilesError;
      if (habitsError) throw habitsError;
      console.log('Compañeros:', profilesData);
      console.log('Hábitos:', habitsData);

      const profilesMap = new Map((profilesData || []).map((p) => [p.id, p]));
      const habitsMap = new Map((habitsData || []).map((h) => [h.id, h]));
      console.log('Hábitos:', habitsMap);

      const normalized = logsData
        .map((log) => ({
          ...log,
          companion: profilesMap.get(log.user_id) || null,
          habit: habitsMap.get(log.habit_id) || null,
        }))
        .filter((row) => row.habit && row.habit.company_id === profile.company_id);

      setItems(normalized);
      console.log('Items finales:', normalized);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar los hábitos pendientes.');
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

  const updateStatus = async (logId, newStatus) => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setError('Debes iniciar sesión para validar hábitos.');
        return;
      }

      const { error: updateError } = await supabase
        .from('habit_logs')
        .update({
          status: newStatus,
          validated_by: user.id,
          validated_at: new Date().toISOString(),
        })
        .eq('id', logId);

      if (updateError) throw updateError;

      setItems((prev) => prev.filter((item) => item.id !== logId));
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar el estado del hábito.');
    }
  };

  const renderItem = ({ item }) => {
    const { companion, habit } = item;
    const name = companion?.full_name || 'Compañero';
    const title = habit?.title || 'Hábito';

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
            <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => updateStatus(item.id, 'rejected')}
            activeOpacity={0.9}
          >
            <Text style={styles.rejectText}>Rechazar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => updateStatus(item.id, 'validated')}
            activeOpacity={0.9}
          >
            <Text style={styles.approveText}>Aprobar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>Cargando hábitos pendientes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Validar hábitos</Text>

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
              <Text style={styles.emptyText}>No hay hábitos pendientes de validación</Text>
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
  headerTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 18,
    marginBottom: 12,
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
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  photo: {
    width: '100%',
    height: 200,
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
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

