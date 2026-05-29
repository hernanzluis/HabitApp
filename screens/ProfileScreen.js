import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';

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

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

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
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, email, company_id, role, avatar_url')
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
        userId: user.id,
        fullName: profile.full_name,
        email: profile.email ?? user.email,
        companyName,
        role: profile.role === 'admin' ? 'Administrador' : 'Usuario',
        avatarUrl: profile.avatar_url ?? null,
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

  const uploadAvatar = async (asset) => {
    setAvatarUploading(true);
    setError('');
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();

      const filePath = `${user.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const cleanUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: cleanUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;

      // Cache-bust in current session so the new photo shows immediately
      setData((prev) => ({ ...prev, avatarUrl: `${cleanUrl}?t=${Date.now()}` }));
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar la foto de perfil.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const pickAvatar = () => {
    Alert.alert('Foto de perfil', '¿Cómo quieres actualizar tu foto?', [
      {
        text: 'Cámara',
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            setError('Necesitamos permiso para usar la cámara.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && result.assets[0]) uploadAvatar(result.assets[0]);
        },
      },
      {
        text: 'Galería',
        onPress: async () => {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            setError('Necesitamos permiso para acceder a tu galería.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && result.assets[0]) uploadAvatar(result.assets[0]);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const saveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setNameSaving(true);
    setError('');
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ full_name: trimmed })
        .eq('id', user.id);
      if (updateError) throw updateError;

      setData((prev) => ({ ...prev, fullName: trimmed }));
      setEditingName(false);
    } catch (e) {
      setError(e?.message || 'No se pudo guardar el nombre.');
    } finally {
      setNameSaving(false);
    }
  };

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
        <ActivityIndicator size="large" color={BLUE} />
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
          <RefreshControl refreshing={refreshing} onRefresh={() => loadProfile(true)} tintColor={BLUE} />
        }
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {data ? (
          <>
            {/* Avatar */}
            <TouchableOpacity
              onPress={pickAvatar}
              disabled={avatarUploading}
              activeOpacity={0.85}
              style={styles.avatarWrapper}
            >
              {data.avatarUrl ? (
                <Image source={{ uri: data.avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarInitial}>
                    {data.fullName?.trim()?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
              <View style={styles.cameraBadge}>
                {avatarUploading ? (
                  <ActivityIndicator size="small" color={WHITE} />
                ) : (
                  <Ionicons name="camera" size={13} color={WHITE} />
                )}
              </View>
            </TouchableOpacity>

            {/* Nombre */}
            {editingName ? (
              <View style={styles.nameEditBlock}>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  style={styles.nameInput}
                  autoFocus
                  editable={!nameSaving}
                  returnKeyType="done"
                  onSubmitEditing={saveName}
                />
                <View style={styles.nameEditActions}>
                  <TouchableOpacity
                    onPress={saveName}
                    disabled={nameSaving}
                    activeOpacity={0.8}
                  >
                    {nameSaving ? (
                      <ActivityIndicator size="small" color={BLUE} />
                    ) : (
                      <Text style={styles.nameSaveText}>Guardar</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingName(false)}
                    disabled={nameSaving}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.nameCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.fullName}>{data.fullName || 'Usuario'}</Text>
                <TouchableOpacity
                  onPress={() => { setNameInput(data.fullName || ''); setEditingName(true); }}
                  activeOpacity={0.7}
                  style={styles.editNameBtn}
                >
                  <Ionicons name="create-outline" size={18} color={BLUE} />
                </TouchableOpacity>
              </View>
            )}

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
            <ActivityIndicator color="#CC0000" />
          ) : (
            <Text style={styles.logoutBtnText}>→ Cerrar sesión</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
    marginBottom: 20,
  },
  title: {
    color: TEXT,
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
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  // Avatar
  avatarWrapper: {
    position: 'relative',
    marginBottom: 14,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: '900',
    color: WHITE,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BG,
  },
  // Nombre
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fullName: {
    color: TEXT,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  editNameBtn: {
    padding: 4,
  },
  nameEditBlock: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 2,
  },
  nameInput: {
    width: '100%',
    fontSize: 20,
    fontWeight: '700',
    color: TEXT,
    textAlign: 'center',
    borderBottomWidth: 1.5,
    borderColor: BLUE,
    paddingVertical: 4,
    marginBottom: 10,
  },
  nameEditActions: {
    flexDirection: 'row',
    gap: 20,
  },
  nameSaveText: {
    color: BLUE,
    fontWeight: '600',
    fontSize: 14,
  },
  nameCancelText: {
    color: GRAY,
    fontWeight: '600',
    fontSize: 14,
  },
  // Role tag
  roleTag: {
    marginTop: 6,
    marginBottom: 20,
    backgroundColor: '#E8E8E8',
    color: GRAY,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  // Info card
  card: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
    color: TEXT,
    fontWeight: '700',
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  // Stats
  sectionTitle: {
    alignSelf: 'flex-start',
    color: TEXT,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
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
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    color: TEXT,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: GRAY,
    marginTop: 4,
    textAlign: 'center',
  },
  // Logout
  logoutBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  logoutBtnDisabled: {
    opacity: 0.4,
  },
  logoutBtnText: {
    color: '#CC0000',
    fontWeight: '600',
    fontSize: 14,
  },
});
