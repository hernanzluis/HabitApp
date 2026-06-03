import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  const [success, setSuccess] = useState('');
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
    if (uploading) return;
    setError('');
    setSuccess('');

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
      if (!user) {
        return;
      }

      const extension = getFileExtension(photo.mimeType, photo.uri);
      const contentType = getContentType(photo.mimeType);
      const filePath = `${user.id}/${habit.id}/${Date.now()}.${extension}`;

      const response = await fetch(photo.uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('habit-photos')
        .upload(filePath, arrayBuffer, {
          contentType,
          upsert: false,
        });

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

      setSuccess(t('habit_detail.success'));
      navTimeoutRef.current = setTimeout(() => {
        navigation.goBack();
      }, 1500);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>{habit.title}</Text>
        {habit.description ? <Text style={styles.description}>{habit.description}</Text> : null}

        <Text style={styles.sectionLabel}>{t('habit_detail.proof_label')}</Text>
        <Text style={styles.sectionHint}>{t('habit_detail.proof_hint')}</Text>

        {/* Botón principal: cámara */}
        <TouchableOpacity
          style={[styles.cameraBtn, uploading && styles.btnDisabled]}
          onPress={takePhoto}
          disabled={uploading}
          activeOpacity={0.85}
        >
          <Ionicons name="camera-outline" size={22} color={WHITE} style={styles.cameraBtnIcon} />
          <Text style={styles.cameraBtnText}>{t('common.camera')}</Text>
        </TouchableOpacity>

        {/* Área de previsualización */}
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

        {/* Campo de nota opcional */}
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
        {success ? <Text style={styles.successText}>{success}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, (uploading || !!success) && styles.btnDisabled]}
          onPress={onSubmit}
          disabled={uploading || !!success}
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
  );
}

const styles = StyleSheet.create({
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
  successText: { marginTop: 12, color: '#0f766e', fontSize: 13, fontWeight: '700' },
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
});
