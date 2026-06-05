import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANG_STORAGE_KEY } from '../lib/i18n';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';

const STATUS_CONFIG = {
  validated: { textKey: 'home.status_validated', color: '#2E7D32', bg: '#F0FAF0' },
  rejected:  { textKey: 'home.status_rejected',  color: '#DC2626', bg: '#FEF2F2' },
  pending:   { textKey: 'home.status_pending',   color: '#F59E0B', bg: '#FFFBEB' },
};

function deriveStatus(validated, rejected) {
  if (validated > 0) return 'validated';
  if (rejected > 0) return 'rejected';
  return 'pending';
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDateTime(dateString, locale) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function FilterPill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.filterPill, active && styles.filterPillActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

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
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  const [historyLogs, setHistoryLogs] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setSettingsVisible(true)}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={24} color={TEXT} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
        .select('id, habit_id, photo_url, notes, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (allLogsError) throw allLogsError;

      const totalCompleted = (allLogs ?? []).length;
      const myLogIds = (allLogs ?? []).map((l) => l.id);
      const habitIds = [...new Set((allLogs ?? []).map((l) => l.habit_id).filter(Boolean))];

      const [
        { count: totalValidatedForOthers, error: validatedForOthersError },
        { data: habitsData, error: habitsError },
        { data: validationsData, error: validationsError },
      ] = await Promise.all([
        supabase.from('habit_validations').select('id', { count: 'exact', head: true }).eq('validator_id', user.id),
        habitIds.length > 0
          ? supabase.from('habits').select('id, title').in('id', habitIds)
          : Promise.resolve({ data: [], error: null }),
        myLogIds.length > 0
          ? supabase.from('habit_validations').select('habit_log_id, status').in('habit_log_id', myLogIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (validatedForOthersError) throw validatedForOthersError;
      if (habitsError) throw habitsError;
      if (validationsError) throw validationsError;

      const totalValidated = (validationsData ?? []).filter((v) => v.status === 'validated').length;

      const habitsMap = new Map((habitsData ?? []).map((h) => [h.id, h.title]));
      const valCounts = {};
      (validationsData ?? []).forEach((v) => {
        if (!valCounts[v.habit_log_id]) valCounts[v.habit_log_id] = { validated: 0, rejected: 0 };
        if (v.status === 'validated') valCounts[v.habit_log_id].validated++;
        if (v.status === 'rejected') valCounts[v.habit_log_id].rejected++;
      });

      setHistoryLogs((allLogs ?? []).map((log) => {
        const counts = valCounts[log.id] ?? { validated: 0, rejected: 0 };
        return {
          id: log.id,
          habitTitle: habitsMap.get(log.habit_id) ?? '—',
          photoUrl: log.photo_url,
          notes: log.notes ?? null,
          createdAt: log.created_at,
          status: deriveStatus(counts.validated, counts.rejected),
        };
      }));

      setData({
        userId: user.id,
        fullName: profile.full_name,
        email: profile.email ?? user.email,
        companyName,
        role: profile.role ?? 'user',
        avatarUrl: profile.avatar_url ?? null,
        totalCompleted,
        totalValidated,
        totalValidatedForOthers: totalValidatedForOthers ?? 0,
      });
    } catch (e) {
      setError(e?.message || t('profile.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const filteredLogs = useMemo(() => {
    return historyLogs.filter((log) => {
      if (filterStatus !== 'all' && log.status !== filterStatus) return false;
      if (filterPeriod === 'week' && new Date(log.createdAt) < getWeekStart()) return false;
      if (filterPeriod === 'month') {
        const now = new Date();
        if (new Date(log.createdAt) < new Date(now.getFullYear(), now.getMonth(), 1)) return false;
      }
      return true;
    });
  }, [historyLogs, filterStatus, filterPeriod]);

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
      setError(e?.message || t('profile.error_avatar'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const pickAvatar = () => {
    Alert.alert(t('profile.avatar_title'), t('profile.avatar_prompt'), [
      {
        text: t('common.camera'),
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            setError(t('common.error_camera_permission'));
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
        text: t('common.gallery'),
        onPress: async () => {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            setError(t('common.error_gallery_permission'));
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
      { text: t('common.cancel'), style: 'cancel' },
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
      setError(e?.message || t('profile.error_name'));
    } finally {
      setNameSaving(false);
    }
  };

  const showLanguagePicker = () => {
    Alert.alert(t('profile.language'), undefined, [
      { text: 'Español', onPress: () => { i18n.changeLanguage('es'); AsyncStorage.setItem(LANG_STORAGE_KEY, 'es').catch(() => {}); } },
      { text: 'English', onPress: () => { i18n.changeLanguage('en'); AsyncStorage.setItem(LANG_STORAGE_KEY, 'en').catch(() => {}); } },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const onLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      setError(e?.message || t('profile.error_logout'));
      setLogoutLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('profile.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
            {/* Sección identidad */}
            <View style={styles.identitySection}>
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
                    <TouchableOpacity onPress={saveName} disabled={nameSaving} activeOpacity={0.8}>
                      {nameSaving ? (
                        <ActivityIndicator size="small" color={BLUE} />
                      ) : (
                        <Text style={styles.nameSaveText}>{t('common.save')}</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingName(false)} disabled={nameSaving} activeOpacity={0.8}>
                      <Text style={styles.nameCancelText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text style={styles.fullName}>{data.fullName || t('profile.role_user')}</Text>
                  <TouchableOpacity
                    onPress={() => { setNameInput(data.fullName || ''); setEditingName(true); }}
                    activeOpacity={0.7}
                    style={styles.editNameBtn}
                  >
                    <Ionicons name="create-outline" size={18} color={BLUE} />
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.roleTag}>{data.role === 'admin' ? t('profile.role_admin') : t('profile.role_user')}</Text>
            </View>

            {/* Sección info */}
            <View style={styles.infoSection}>
              <InfoRow label={t('common.email')} value={data.email} />
              <View style={styles.divider} />
              <InfoRow label={t('profile.company_label')} value={data.companyName} />
            </View>

            {/* Sección actividad */}
            <View style={styles.activitySection}>
              <Text style={styles.sectionTitle}>{t('profile.activity')}</Text>
              <View style={styles.statsRow}>
                <StatCard label={t('profile.completed')} value={data.totalCompleted} />
                <StatCard label={t('profile.validated')} value={data.totalValidated} />
                <StatCard label={t('profile.validated_others')} value={data.totalValidatedForOthers} />
              </View>
            </View>

            {/* Sección historial */}
            {historyLogs.length > 0 ? (
              <View style={styles.historySection}>
                <Text style={styles.sectionTitle}>{t('profile.history_title')}</Text>

                {/* Filtro estado */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {[
                    { key: 'all',       label: t('profile.filter_all') },
                    { key: 'validated', label: t('profile.filter_validated') },
                    { key: 'pending',   label: t('profile.filter_pending') },
                    { key: 'rejected',  label: t('profile.filter_rejected') },
                  ].map(({ key, label }) => (
                    <FilterPill key={key} label={label} active={filterStatus === key} onPress={() => setFilterStatus(key)} />
                  ))}
                </ScrollView>

                {/* Filtro período */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {[
                    { key: 'all',   label: t('profile.filter_all_time') },
                    { key: 'week',  label: t('profile.filter_week') },
                    { key: 'month', label: t('profile.filter_month') },
                  ].map(({ key, label }) => (
                    <FilterPill key={key} label={label} active={filterPeriod === key} onPress={() => setFilterPeriod(key)} />
                  ))}
                </ScrollView>

                {/* Items */}
                {filteredLogs.length > 0 ? filteredLogs.map((log) => {
                  const cfg = STATUS_CONFIG[log.status];
                  return (
                    <TouchableOpacity
                      key={log.id}
                      style={styles.logCard}
                      onPress={() => log.photoUrl && setSelectedPhoto(log.photoUrl)}
                      activeOpacity={log.photoUrl ? 0.7 : 1}
                    >
                      {log.photoUrl ? (
                        <Image source={{ uri: log.photoUrl }} style={styles.logThumbnail} resizeMode="cover" />
                      ) : (
                        <View style={styles.logThumbnailFallback} />
                      )}
                      <View style={styles.logInfo}>
                        <Text style={styles.logHabitTitle} numberOfLines={2}>{log.habitTitle}</Text>
                        <Text style={styles.logDate}>{formatDateTime(log.createdAt, locale)}</Text>
                        <View style={[styles.logStatusBadge, { backgroundColor: cfg.bg }]}>
                          <Text style={[styles.logStatusText, { color: cfg.color }]}>{t(cfg.textKey)}</Text>
                        </View>
                        {log.notes ? (
                          <View style={styles.logNotesBox}>
                            <Text style={styles.logNotesText}>{log.notes}</Text>
                          </View>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                }) : (
                  <View style={styles.historyEmpty}>
                    <Text style={styles.historyEmptyText}>{t('profile.history_empty')}</Text>
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : null}

      </ScrollView>

      {/* Modal de ajustes */}
      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('profile.settings_title')}</Text>
            <View style={styles.modalDivider} />

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => { setSettingsVisible(false); setTimeout(showLanguagePicker, 300); }}
              activeOpacity={0.7}
            >
              <Text style={styles.modalOptionText}>{t('profile.language')}</Text>
              <Ionicons name="chevron-forward" size={16} color={GRAY} />
            </TouchableOpacity>

            <View style={styles.modalDivider} />

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => { setSettingsVisible(false); onLogout(); }}
              activeOpacity={0.7}
              disabled={logoutLoading}
            >
              {logoutLoading ? (
                <ActivityIndicator color="#CC0000" />
              ) : (
                <Text style={[styles.modalOptionText, styles.modalOptionLogout]}>{t('profile.logout')}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.modalSectionGap} />

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => setSettingsVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalOptionCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal foto completa */}
      <Modal
        visible={!!selectedPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <Pressable style={styles.photoModalBackdrop} onPress={() => setSelectedPhoto(null)}>
          <Image source={{ uri: selectedPhoto ?? '' }} style={styles.photoModalImage} resizeMode="contain" />
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
  scrollContent: {
    paddingBottom: 8,
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
    marginBottom: 0,
    backgroundColor: '#E8E8E8',
    color: GRAY,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  identitySection: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 24,
    marginBottom: 8,
    alignItems: 'center',
  },
  infoSection: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  activitySection: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 8,
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
    color: TEXT,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
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
  headerBtn: {
    paddingHorizontal: 16,
  },
  // Modal de ajustes
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
    paddingVertical: 16,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  modalOptionLogout: {
    color: '#CC0000',
  },
  modalOptionCancel: {
    fontSize: 15,
    fontWeight: '600',
    color: GRAY,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 16,
  },
  modalSectionGap: {
    height: 8,
    backgroundColor: BG,
  },
  // Historial
  historySection: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: WHITE,
  },
  filterPillActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY,
  },
  filterPillTextActive: {
    color: WHITE,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  logThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 4,
    flexShrink: 0,
  },
  logThumbnailFallback: {
    width: 64,
    height: 64,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
    flexShrink: 0,
  },
  logInfo: {
    flex: 1,
    gap: 4,
  },
  logHabitTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  logDate: {
    fontSize: 12,
    color: GRAY,
  },
  logStatusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  logStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  logNotesBox: {
    marginTop: 6,
    backgroundColor: '#F9F9F9',
    borderRadius: 4,
    padding: 8,
  },
  logNotesText: {
    color: GRAY,
    fontSize: 13,
  },
  historyEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  historyEmptyText: {
    color: GRAY,
    fontSize: 13,
    fontWeight: '600',
  },
  // Modal foto
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalImage: {
    width: '100%',
    height: '100%',
  },
});
