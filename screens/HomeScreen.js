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
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const ORANGE = '#f97316';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatExpiry(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(dateStr);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp - now) / MS_PER_DAY);
}

function getFirstName(fullName) {
  if (!fullName?.trim()) return 'Usuario';
  return fullName.trim().split(/\s+/)[0];
}

function getTodayLabel() {
  return new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function HomeScreen() {
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [habits, setHabits] = useState([]);

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
        .select('id, full_name, company_id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      if (!profileData?.company_id) {
        setProfile(profileData);
        setHabits([]);
        setError('Tu perfil no tiene una empresa asignada.');
        return;
      }

      setProfile(profileData);

      const { data: habitsData, error: habitsError } = await supabase
        .from('habits')
        .select('id, title, description, company_id, type, recurrence, is_active, created_at, expires_at')
        .eq('company_id', profileData.company_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (habitsError) throw habitsError;

      const now = new Date();
      const active = (habitsData ?? []).filter(
        (h) => !h.expires_at || new Date(h.expires_at) > now
      );

      const habitIds = active.map((h) => h.id);

      let logsData = [];
      if (habitIds.length > 0) {
        const { data: logs, error: logsError } = await supabase
          .from('habit_logs')
          .select('habit_id, created_at')
          .eq('user_id', user.id)
          .in('habit_id', habitIds);
        if (logsError) throw logsError;
        logsData = logs ?? [];
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const doneEver = new Set(logsData.map((l) => l.habit_id));
      const doneToday = new Set(
        logsData
          .filter((l) => new Date(l.created_at) >= todayStart)
          .map((l) => l.habit_id)
      );

      const processed = active
        .filter((h) => h.recurrence !== 'once' || !doneEver.has(h.id))
        .map((h) => ({ ...h, completedToday: h.recurrence === 'daily' && doneToday.has(h.id) }));

      setHabits(processed);
    } catch (e) {
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return loadHomeData(isRefresh, 2);
      }
      const message = e?.message || 'No se pudieron cargar los datos. Revisa tu conexión.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

  const onCompleteHabit = (habit) => {
    navigation.navigate('HabitDetail', { habit });
  };

  const renderHabit = ({ item }) => {
    const urgent = item.expires_at && daysUntil(item.expires_at) <= 3;
    return (
    <View style={[styles.habitCard, item.completedToday && styles.habitCardCompleted]}>
      <Text style={styles.habitTitle}>{item.title}</Text>
      {item.description ? <Text style={styles.habitDescription}>{item.description}</Text> : null}
      {item.expires_at ? (
        <Text style={[styles.expiryText, urgent && styles.expiryUrgent]}>
          Expira el {formatExpiry(item.expires_at)}
        </Text>
      ) : null}
      {item.completedToday ? (
        <View style={styles.completedRow}>
          <Ionicons name="checkmark-circle" size={16} color="#2E7D32" />
          <Text style={styles.completedText}>Completado hoy</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.completeBtn}
          onPress={() => onCompleteHabit(item)}
          activeOpacity={0.9}
        >
          <Text style={styles.completeBtnText}>Completar</Text>
        </TouchableOpacity>
      )}
    </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>Cargando tus hábitos...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola, {getFirstName(profile?.full_name)}</Text>
        <Text style={styles.date}>{getTodayLabel()}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={habits}
        keyExtractor={(item) => item.id}
        renderItem={renderHabit}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadHomeData(true)} tintColor={BLUE} />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No hay hábitos asignados hoy</Text>
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
    marginBottom: 16,
  },
  greeting: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '800',
  },
  date: {
    color: GRAY,
    fontSize: 14,
    marginTop: 4,
    textTransform: 'capitalize',
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
    paddingBottom: 16,
    flexGrow: 1,
  },
  habitCard: {
    backgroundColor: WHITE,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  habitCardCompleted: {
    backgroundColor: '#F0FAF0',
    borderLeftWidth: 3,
    borderLeftColor: '#2E7D32',
  },
  habitTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
  },
  habitDescription: {
    marginTop: 6,
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  expiryText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: GRAY,
  },
  expiryUrgent: {
    color: ORANGE,
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
    gap: 6,
    marginTop: 14,
  },
  completedText: {
    fontSize: 13,
    color: GRAY,
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
