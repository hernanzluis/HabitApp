import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const pickFromGallery = async () => {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t('common.error_gallery_permission'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0]);
    }
  };

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
      });

      if (logError) throw logError;

      setSuccess(t('habit_detail.success'));
      setTimeout(() => {
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

        <View style={styles.photoActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={takePhoto}
            disabled={uploading}
            activeOpacity={0.9}
          >
            <Text style={styles.actionBtnText}>{t('common.camera')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={pickFromGallery}
            disabled={uploading}
            activeOpacity={0.9}
          >
            <Text style={styles.actionBtnText}>{t('common.gallery')}</Text>
          </TouchableOpacity>
        </View>

        {photo?.uri ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
          </View>
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.previewPlaceholderText}>{t('habit_detail.no_photo')}</Text>
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {success ? <Text style={styles.successText}>{success}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, (uploading || !!success) && styles.submitBtnDisabled]}
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
  photoActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: {
    flex: 1,
    height: 42,
    borderRadius: 4,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { color: TEXT, fontWeight: '600', fontSize: 14 },
  previewContainer: {
    marginTop: 14,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  preview: { width: '100%', height: 350 },
  previewPlaceholder: {
    marginTop: 14,
    height: 350,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholderText: { color: GRAY, fontSize: 13, fontWeight: '600' },
  errorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  successText: { marginTop: 12, color: '#0f766e', fontSize: 13, fontWeight: '700' },
  submitBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 4,
    backgroundColor: BLUE,
    alignSelf: 'center',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: WHITE, fontWeight: '600', fontSize: 15 },
});
