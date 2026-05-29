import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';
const GRAY = '#64748b';
const LIGHT = '#f1f5f9';

function StatCard({ label, value }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const loadProfile = useCallback(async (isRefresh = false) => {
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
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, email, company_id, role')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;

      let companyName = null;
      if (profile.company_id) {
        const { data: company, error: companyError } = await supabase
          .from('companies')
          .select('name')
          .eq('id', profile.company_id)
          .single();
        if (!companyError) companyName = company?.name ?? null;
      }

      const { data: allLogs, error: allLogsError } = await supabase
        .from('habit_logs')
        .select('id, status, validated_by')
        .eq('user_id', user.id);
      if (allLogsError) throw allLogsError;

      const totalCompleted = (allLogs ?? []).length;
      const totalValidated = (allLogs ?? []).filter((l) => l.status === 'validated').length;

      const { count: totalValidatedForOthers, error: validatedForOthersError } = await supabase
        .from('habit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('validated_by', user.id);
      if (validatedForOthersError) throw validatedForOthersError;

      setData({
        fullName: profile.full_name,
        email: profile.email ?? user.email,
        companyName,
        role: profile.role === 'admin' ? 'Administrador' : 'Usuario',
        totalCompleted,
        totalValidated,
        totalValidatedForOthers: totalValidatedForOthers ?? 0,
      });
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el perfil. Revisa tu conexión.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const onLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      setError(e?.message || 'No se pudo cerrar sesión.');
      setLogoutLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={WHITE} />
        <Text style={styles.loadingText}>Cargando perfil...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mi perfil</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadProfile(true)}
            tintColor={WHITE}
          />
        }
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {data.fullName?.trim()?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
            <Text style={styles.fullName}>{data.fullName || 'Usuario'}</Text>
            <Text style={styles.roleTag}>{data.role}</Text>

            <View style={styles.card}>
              <InfoRow label="Email" value={data.email} />
              <View style={styles.divider} />
              <InfoRow label="Empresa" value={data.companyName} />
            </View>

            <Text style={styles.sectionTitle}>Actividad</Text>
            <View style={styles.statsRow}>
              <StatCard label="Completados" value={data.totalCompleted} />
              <StatCard label="Validados" value={data.totalValidated} />
              <StatCard label="Validados a otros" value={data.totalValidatedForOthers} />
            </View>
          </>
        ) : null}

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
      </ScrollView>
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
  title: {
    color: WHITE,
    fontSize: 24,
    fontWeight: '800',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 40,
    alignItems: 'center',
  },
  errorBanner: {
    width: '100%',
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
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '900',
    color: NAVY,
  },
  fullName: {
    color: WHITE,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  roleTag: {
    marginTop: 6,
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: WHITE,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  card: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: {
    fontSize: 14,
    color: GRAY,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '700',
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: LIGHT,
  },
  sectionTitle: {
    alignSelf: 'flex-start',
    color: WHITE,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
    opacity: 0.9,
  },
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 32,
  },
  statCard: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    color: NAVY,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: GRAY,
    marginTop: 4,
    textAlign: 'center',
  },
  logoutBtn: {
    width: '100%',
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
