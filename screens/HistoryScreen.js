import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const TEXT = '#1D2226';
const GRAY = '#666666';

const STATUS_CONFIG = {
  validated: { textKey: 'home.status_validated', color: '#2E7D32', bg: '#F0FAF0' },
  rejected:  { textKey: 'home.status_rejected',  color: '#DC2626', bg: '#FEF2F2' },
  pending:   { textKey: 'home.status_pending',   color: '#F59E0B', bg: '#FFFBEB' },
};

function deriveStatus(validatedCount, rejectedCount) {
  if (validatedCount > 0) return 'validated';
  if (rejectedCount > 0) return 'rejected';
  return 'pending';
}

function formatDateTime(dateString, locale) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('history.header_title'),
      headerBackTitle: '',
      headerBackButtonDisplayMode: 'minimal',
      headerStyle: {
        backgroundColor: WHITE,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
      },
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: TEXT },
      headerTitleAlign: 'center',
    });
  }, [navigation, t]);

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      const { data: logs, error: logsError } = await supabase
        .from('habit_logs')
        .select('id, habit_id, photo_url, notes, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (logsError) throw logsError;
      if (!logs?.length) { setItems([]); return; }

      const habitIds = [...new Set(logs.map((l) => l.habit_id).filter(Boolean))];
      const logIds = logs.map((l) => l.id);

      const [
        { data: habitsData, error: habitsError },
        { data: validationsData, error: validationsError },
      ] = await Promise.all([
        habitIds.length
          ? supabase.from('habits').select('id, title').in('id', habitIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('habit_validations')
          .select('habit_log_id, status')
          .in('habit_log_id', logIds),
      ]);
      if (habitsError) throw habitsError;
      if (validationsError) throw validationsError;

      const habitsMap = new Map((habitsData ?? []).map((h) => [h.id, h.title]));

      const valCounts = {};
      (validationsData ?? []).forEach((v) => {
        if (!valCounts[v.habit_log_id]) valCounts[v.habit_log_id] = { validated: 0, rejected: 0 };
        if (v.status === 'validated') valCounts[v.habit_log_id].validated++;
        if (v.status === 'rejected') valCounts[v.habit_log_id].rejected++;
      });

      setItems(logs.map((log) => {
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
    } catch (e) {
      setError(e?.message || t('history.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  const renderItem = ({ item }) => {
    const cfg = STATUS_CONFIG[item.status];
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => item.photoUrl && setSelectedPhoto(item.photoUrl)}
        activeOpacity={item.photoUrl ? 0.7 : 1}
      >
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={styles.thumbnailFallback} />
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.habitTitle} numberOfLines={2}>{item.habitTitle}</Text>
          <Text style={styles.dateText}>{formatDateTime(item.createdAt, locale)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{t(cfg.textKey)}</Text>
          </View>
          {item.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{item.notes}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0A66C2" />
        <Text style={styles.loadingText}>{t('history.loading')}</Text>
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadHistory(true)} tintColor="#0A66C2" />
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('history.empty')}</Text>
            </View>
          ) : null
        }
      />

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
  },
  loadingText: {
    color: TEXT,
    marginTop: 14,
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },
  separator: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  card: {
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 4,
    flexShrink: 0,
  },
  thumbnailFallback: {
    width: 64,
    height: 64,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  habitTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  dateText: {
    fontSize: 12,
    color: GRAY,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
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
  emptyCard: {
    backgroundColor: WHITE,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyText: {
    color: GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
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
