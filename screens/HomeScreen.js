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
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [habits, setHabits] = useState([]);

  const loadHomeData = useCallback(async (isRefresh = false) => {
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
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
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
        .select('id, title, description, company_id, type, is_active, created_at')
        .eq('company_id', profileData.company_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (habitsError) throw habitsError;
      setHabits(habitsData ?? []);
    } catch (e) {
      const message = e?.message || 'No se pudieron cargar los datos. Revisa tu conexión.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

  const onLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await supabase.auth.signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } catch (e) {
      setError(e?.message || 'No se pudo cerrar sesión.');
    } finally {
      setLogoutLoading(false);
    }
  };

  const onCompleteHabit = (habit) => {
    navigation.navigate('HabitDetail', { habit });
  };

  const renderHabit = ({ item }) => (
    <View style={styles.habitCard}>
      <Text style={styles.habitTitle}>{item.title}</Text>
      {item.description ? <Text style={styles.habitDescription}>{item.description}</Text> : null}
      <TouchableOpacity
        style={styles.completeBtn}
        onPress={() => onCompleteHabit(item)}
        activeOpacity={0.9}
      >
        <Text style={styles.completeBtnText}>Completar</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={WHITE} />
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
          <RefreshControl refreshing={refreshing} onRefresh={() => loadHomeData(true)} tintColor={WHITE} />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No hay hábitos asignados hoy</Text>
            </View>
          ) : null
        }
      />

      <TouchableOpacity
        style={[styles.logoutBtn, logoutLoading && styles.logoutBtnDisabled]}
        onPress={onLogout}
        disabled={logoutLoading}
        activeOpacity={0.9}
      >
        {logoutLoading ? (
          <ActivityIndicator color={NAVY} />
        ) : (
          <Text style={styles.logoutBtnText}>Cerrar sesión</Text>
        )}
      </TouchableOpacity>
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
    marginBottom: 16,
  },
  greeting: {
    color: WHITE,
    fontSize: 24,
    fontWeight: '800',
  },
  date: {
    color: WHITE,
    opacity: 0.85,
    fontSize: 14,
    marginTop: 4,
    textTransform: 'capitalize',
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
    paddingBottom: 16,
    flexGrow: 1,
  },
  habitCard: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  habitTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  habitDescription: {
    marginTop: 6,
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  completeBtn: {
    marginTop: 14,
    height: 42,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtnText: {
    color: WHITE,
    fontWeight: '800',
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  logoutBtn: {
    marginHorizontal: 18,
    marginBottom: 28,
    height: 46,
    borderRadius: 10,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnDisabled: {
    opacity: 0.7,
  },
  logoutBtnText: {
    color: NAVY,
    fontWeight: '800',
  },
});
