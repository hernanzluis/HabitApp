import React, { useCallback, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANG_STORAGE_KEY } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import usePlanInfo from '../lib/usePlanInfo';

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

function ManualTabBar({ navigation, t, pendingCount }) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { key: 'Home',          icon: 'home-outline',             label: t('nav.home') },
    { key: 'ValidateHabit', icon: 'checkmark-circle-outline', label: t('nav.validate') },
    { key: 'Ranking',       icon: 'people-outline',           label: t('nav.ranking') },
  ];
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((tab) => {
        const isValidate = tab.key === 'ValidateHabit';
        const disabled = isValidate && pendingCount === 0;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, disabled && { opacity: 0.35 }]}
            onPress={() => navigation.navigate('Tabs', { screen: tab.key })}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <View style={styles.tabIconWrapper}>
              <Ionicons name={tab.icon} size={24} color={GRAY} />
              {isValidate && pendingCount > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{pendingCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.tabLabel}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
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
      <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="tail">{value || '—'}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupNameSaving, setGroupNameSaving] = useState(false);

  const { historyDays } = usePlanInfo(data?.companyId);

  const [historyLogs, setHistoryLogs] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

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

      const [
        { data: allLogs, error: allLogsError },
        { data: companyRow },
      ] = await Promise.all([
        supabase
          .from('habit_logs')
          .select('id, habit_id, photo_url, notes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        profile.company_id
          ? supabase.from('companies').select('name').eq('id', profile.company_id).single()
          : Promise.resolve({ data: null }),
      ]);
      if (allLogsError) throw allLogsError;
      const companyName = companyRow?.name ?? null;

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
          ? supabase.from('habits').select('id, title, company_id').in('id', habitIds)
          : Promise.resolve({ data: [], error: null }),
        myLogIds.length > 0
          ? supabase.from('habit_validations').select('habit_log_id, status').in('habit_log_id', myLogIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (validatedForOthersError) throw validatedForOthersError;
      if (habitsError) throw habitsError;
      if (validationsError) throw validationsError;

      const totalValidated = (validationsData ?? []).filter((v) => v.status === 'validated').length;

      const validHabits = (habitsData ?? []).filter((h) => h.company_id === profile.company_id);
      const validHabitIds = new Set(validHabits.map((h) => h.id));
      const habitsMap = new Map(validHabits.map((h) => [h.id, h.title]));
      const valCounts = {};
      (validationsData ?? []).forEach((v) => {
        if (!valCounts[v.habit_log_id]) valCounts[v.habit_log_id] = { validated: 0, rejected: 0 };
        if (v.status === 'validated') valCounts[v.habit_log_id].validated++;
        if (v.status === 'rejected') valCounts[v.habit_log_id].rejected++;
      });

      setHistoryLogs((allLogs ?? []).filter((log) => validHabitIds.has(log.habit_id)).map((log) => {
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
        companyId: profile.company_id ?? null,
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

  const saveGroupName = async () => {
    const trimmed = groupNameInput.trim();
    if (!trimmed) return;
    setGroupNameSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('companies')
        .update({ name: trimmed })
        .eq('id', data.companyId);
      if (updateError) throw updateError;
      setData((prev) => ({ ...prev, companyName: trimmed }));
      setEditingGroupName(false);
    } catch (e) {
      setError(e?.message || t('profile.error_name'));
    } finally {
      setGroupNameSaving(false);
    }
  };

  const fetchPendingCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: validatorHabits } = await supabase
        .from('habit_validators').select('habit_id').eq('user_id', user.id);
      const validatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);
      if (!validatorHabitIds.length) { setPendingCount(0); return; }
      const { data: pendingLogs } = await supabase
        .from('habit_logs').select('id')
        .eq('status', 'pending').neq('user_id', user.id).in('habit_id', validatorHabitIds);
      if (!pendingLogs?.length) { setPendingCount(0); return; }
      const logIds = pendingLogs.map((l) => l.id);
      const { data: myValidations } = await supabase
        .from('habit_validations').select('habit_log_id')
        .eq('validator_id', user.id).in('habit_log_id', logIds);
      const alreadyVoted = new Set((myValidations ?? []).map((v) => v.habit_log_id));
      setPendingCount(pendingLogs.filter((l) => !alreadyVoted.has(l.id)).length);
    } catch {
      // non-critical
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
      fetchPendingCount();
    }, [loadProfile, fetchPendingCount])
  );

  const filteredLogs = useMemo(() => {
    const cutoff = historyDays != null ? new Date(Date.now() - historyDays * 86400000) : null;
    return historyLogs.filter((log) => {
      if (cutoff && new Date(log.createdAt) < cutoff) return false;
      if (filterStatus !== 'all' && log.status !== filterStatus) return false;
      if (filterPeriod === 'week' && new Date(log.createdAt) < getWeekStart()) return false;
      if (filterPeriod === 'month') {
        const now = new Date();
        if (new Date(log.createdAt) < new Date(now.getFullYear(), now.getMonth(), 1)) return false;
      }
      return true;
    });
  }, [historyLogs, filterStatus, filterPeriod, historyDays]);

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
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
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

              {/* Nombre del grupo — editable para admin */}
              {editingGroupName ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('profile.company_label')}</Text>
                  <View style={styles.inlineEditRight}>
                    <TextInput
                      value={groupNameInput}
                      onChangeText={setGroupNameInput}
                      style={styles.inlineInput}
                      autoFocus
                      editable={!groupNameSaving}
                      returnKeyType="done"
                      onSubmitEditing={saveGroupName}
                    />
                    <View style={styles.nameEditActions}>
                      <TouchableOpacity onPress={saveGroupName} disabled={groupNameSaving} activeOpacity={0.8}>
                        {groupNameSaving ? (
                          <ActivityIndicator size="small" color={BLUE} />
                        ) : (
                          <Text style={styles.nameSaveText}>{t('common.save')}</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingGroupName(false)} disabled={groupNameSaving} activeOpacity={0.8}>
                        <Text style={styles.nameCancelText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('profile.company_label')}</Text>
                  <View style={styles.infoValueRow}>
                    <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="tail">{data.companyName || '—'}</Text>
                    {data.role === 'admin' ? (
                      <TouchableOpacity
                        onPress={() => { setGroupNameInput(data.companyName || ''); setEditingGroupName(true); }}
                        activeOpacity={0.7}
                        style={styles.editNameBtn}
                      >
                        <Ionicons name="create-outline" size={16} color={BLUE} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              )}

              <View style={styles.divider} />

              {/* Idioma */}
              <TouchableOpacity style={styles.infoRow} onPress={showLanguagePicker} activeOpacity={0.7}>
                <Text style={styles.infoLabel}>{t('profile.language')}</Text>
                <View style={styles.infoValueRow}>
                  <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="tail">{i18n.language === 'es' ? 'Español' : 'English'}</Text>
                  <Ionicons name="chevron-forward" size={16} color={GRAY} />
                </View>
              </TouchableOpacity>
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

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={onLogout}
          disabled={logoutLoading}
          activeOpacity={0.7}
        >
          {logoutLoading ? (
            <ActivityIndicator color="#CC0000" />
          ) : (
            <Text style={styles.logoutText}>{t('profile.logout')}</Text>
          )}
        </TouchableOpacity>

      </ScrollView>

      <ManualTabBar navigation={navigation} t={t} pendingCount={pendingCount} />

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
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: {
    fontSize: 14,
    color: GRAY,
    fontWeight: '600',
    flexShrink: 0,
    marginRight: 12,
  },
  infoValue: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '700',
    flex: 1,
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
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    justifyContent: 'flex-end',
  },
  inlineEditRight: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 6,
  },
  inlineInput: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
    borderBottomWidth: 1.5,
    borderColor: BLUE,
    paddingVertical: 2,
    minWidth: 100,
    textAlign: 'right',
  },
  logoutBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  logoutText: {
    color: '#CC0000',
    fontSize: 15,
    fontWeight: '600',
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
  // Barra de tabs manual
  tabBar: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
  },
  tabIconWrapper: {
    position: 'relative',
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: '700',
  },
  tabLabel: {
    fontSize: 10,
    color: GRAY,
    fontWeight: '500',
  },
});
