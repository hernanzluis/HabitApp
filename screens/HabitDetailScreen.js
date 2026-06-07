import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';
const GREEN = '#4CAF50';

// ── Utilidades de racha ───────────────────────────────────────────────────
function toDateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Misma lógica que calculateStreak en RankingScreen.
// Dado que acabamos de insertar el log de hoy, today siempre está en el Set.
function calculateStreak(logs) {
  const logDays = new Set(logs.map((l) => toDateKey(new Date(l.created_at))));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = new Date(today);
  if (!logDays.has(toDateKey(today))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (logDays.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function getFileExtension(mimeType, uri) {
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return 'jpg';
  if (mimeType?.includes('webp')) return 'webp';
  const ext = uri.split('.').pop()?.split('?')[0];
  return ext && ext.length <= 4 ? ext : 'jpg';
}

function getContentType(mimeType) {
  if (mimeType) return mimeType;
  return 'image/jpeg';
}

export default function HabitDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useTranslation();
  const habit = route.params?.habit;

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('habit_detail.header_title'),
      headerBackTitle: '',
      headerStyle: {
        backgroundColor: WHITE,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
      },
      headerTitleStyle: {
        fontSize: 17,
        fontWeight: '600',
        color: TEXT,
      },
      headerTitleAlign: 'center',
    });
  }, [navigation, t]);

  const [photo, setPhoto] = useState(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [streak, setStreak] = useState(0);

  const celebrateOpacity = useRef(new Animated.Value(0)).current;
  const flameScale = useRef(new Animated.Value(1)).current;
  const navTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  const takePhoto = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t('common.error_camera_permission'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0]);
    }
  };

  const onSubmit = async () => {
    if (uploading || showCelebration) return;
    setError('');

    if (!habit?.id) {
      setError(t('habit_detail.error_not_found_retry'));
      return;
    }

    if (!photo?.uri) {
      setError(t('habit_detail.error_no_photo'));
      return;
    }

    setUploading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) return;

      const extension = getFileExtension(photo.mimeType, photo.uri);
      const contentType = getContentType(photo.mimeType);
      const filePath = `${user.id}/${habit.id}/${Date.now()}.${extension}`;

      const response = await fetch(photo.uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('habit-photos')
        .upload(filePath, arrayBuffer, { contentType, upsert: false });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('habit-photos').getPublicUrl(filePath);
      const photoUrl = publicUrlData.publicUrl;

      const { error: logError } = await supabase.from('habit_logs').insert({
        habit_id: habit.id,
        user_id: user.id,
        photo_url: photoUrl,
        status: 'pending',
        notes: notes.trim() || null,
      });

      if (logError) throw logError;

      // ── Calcular racha ────────────────────────────────────────────────
      const { data: recentLogs } = await supabase
        .from('habit_logs')
        .select('created_at')
        .eq('habit_id', habit.id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      const calculatedStreak = calculateStreak(recentLogs ?? []);
      setStreak(calculatedStreak);

      // ── Mostrar celebración ───────────────────────────────────────────
      setShowCelebration(true);
      celebrateOpacity.setValue(0);
      flameScale.setValue(1);

      Animated.sequence([
        Animated.timing(celebrateOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(flameScale, { toValue: 1.3, duration: 300, useNativeDriver: true }),
        Animated.timing(flameScale, { toValue: 1.0, duration: 300, useNativeDriver: true }),
      ]).start();

      navTimeoutRef.current = setTimeout(() => {
        Animated.timing(celebrateOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          navigation.navigate('Tabs', {
            screen: 'Home',
            params: { justCompletedHabitId: habit.id },
          });
        });
      }, 1600);

    } catch (e) {
      setError(e?.message || t('habit_detail.error_upload'));
    } finally {
      setUploading(false);
    }
  };

  if (!habit) {
    return (
      <View style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.errorText}>{t('habit_detail.error_not_found')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.title}>{habit.title}</Text>
          {habit.description ? <Text style={styles.description}>{habit.description}</Text> : null}

          <Text style={styles.sectionLabel}>{t('habit_detail.proof_label')}</Text>
          <Text style={styles.sectionHint}>{t('habit_detail.proof_hint')}</Text>

          <TouchableOpacity
            style={[styles.cameraBtn, uploading && styles.btnDisabled]}
            onPress={takePhoto}
            disabled={uploading}
            activeOpacity={0.85}
          >
            <Ionicons name="camera-outline" size={22} color={WHITE} style={styles.cameraBtnIcon} />
            <Text style={styles.cameraBtnText}>{t('common.camera')}</Text>
          </TouchableOpacity>

          {photo?.uri ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
            </View>
          ) : (
            <View style={styles.previewPlaceholder}>
              <Ionicons name="image-outline" size={28} color="#C0C0C0" />
              <Text style={styles.previewPlaceholderText}>{t('habit_detail.no_photo')}</Text>
            </View>
          )}

          <Text style={styles.noteLabel}>{t('habit_detail.note_label')}</Text>
          <TextInput
            style={styles.noteInput}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('habit_detail.note_placeholder')}
            placeholderTextColor={GRAY}
            multiline
            maxLength={150}
            editable={!uploading}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.submitBtn, (uploading || showCelebration) && styles.btnDisabled]}
            onPress={onSubmit}
            disabled={uploading || showCelebration}
            activeOpacity={0.9}
          >
            {uploading ? (
              <ActivityIndicator color={WHITE} />
            ) : (
              <Text style={styles.submitBtnText}>{t('habit_detail.submit')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Overlay de celebración ──────────────────────────────────────── */}
      {showCelebration ? (
        <Animated.View style={[styles.celebrationOverlay, { opacity: celebrateOpacity }]}>
          <Animated.View style={{ transform: [{ scale: flameScale }] }}>
            <Ionicons name="flame" size={80} color={GREEN} />
          </Animated.View>

          {streak === 1 ? (
            <Text style={styles.celebrationFirstDay}>{t('habit_detail.streak_first')}</Text>
          ) : (
            <>
              <Text style={styles.celebrationNumber}>{streak}</Text>
              <Text style={styles.celebrationDays}>{t('habit_detail.streak_days')}</Text>
            </>
          )}

          <Text style={styles.celebrationHabitName} numberOfLines={2}>{habit.title}</Text>
          <Text style={styles.celebrationWellDone}>{t('habit_detail.streak_well_done')}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: BG },
  container: { flex: 1, backgroundColor: BG },
  content: { paddingBottom: 28 },
  section: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '600', color: TEXT },
  description: { marginTop: 8, fontSize: 14, color: GRAY, lineHeight: 20 },
  sectionLabel: { marginTop: 20, fontSize: 14, fontWeight: '800', color: TEXT },
  sectionHint: { marginTop: 4, fontSize: 13, color: GRAY },
  cameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 56,
    borderRadius: 4,
    backgroundColor: BLUE,
    gap: 8,
  },
  cameraBtnIcon: { marginRight: 2 },
  cameraBtnText: { color: WHITE, fontWeight: '700', fontSize: 16 },
  previewContainer: {
    marginTop: 16,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  preview: { width: '100%', height: 220 },
  previewPlaceholder: {
    marginTop: 16,
    height: 120,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  previewPlaceholderText: { color: '#C0C0C0', fontSize: 12, fontWeight: '600' },
  noteLabel: { marginTop: 20, fontSize: 13, fontWeight: '600', color: GRAY },
  noteInput: {
    marginTop: 6,
    minHeight: 80,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: WHITE,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: TEXT,
    textAlignVertical: 'top',
  },
  errorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  submitBtn: {
    marginTop: 16,
    minHeight: 56,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '700', fontSize: 16 },
  // Celebración
  celebrationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  celebrationNumber: {
    fontSize: 72,
    fontWeight: '800',
    color: GREEN,
    lineHeight: 80,
    marginTop: 12,
  },
  celebrationDays: {
    fontSize: 18,
    color: WHITE,
    marginTop: 4,
  },
  celebrationFirstDay: {
    fontSize: 36,
    fontWeight: '800',
    color: GREEN,
    textAlign: 'center',
    marginTop: 12,
  },
  celebrationHabitName: {
    fontSize: 16,
    color: '#A0A0A0',
    marginTop: 20,
    textAlign: 'center',
  },
  celebrationWellDone: {
    fontSize: 15,
    color: WHITE,
    marginTop: 8,
    fontWeight: '600',
  },
});
