import React, { useState } from 'react';
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
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';
const GRAY = '#64748b';

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
  const habit = route.params?.habit;

  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const pickFromGallery = async () => {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Necesitamos permiso para acceder a tu galería.');
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
      setError('Necesitamos permiso para usar la cámara.');
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
      setError('No se encontró el hábito. Vuelve e inténtalo de nuevo.');
      return;
    }

    if (!photo?.uri) {
      setError('Selecciona o toma una foto antes de enviar.');
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
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
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

      setSuccess('¡Prueba enviada! Un compañero la validará pronto.');
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        });
      }, 1500);
    } catch (e) {
      setError(e?.message || 'No se pudo enviar la prueba. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setUploading(false);
    }
  };

  if (!habit) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.errorText}>No se encontró el hábito.</Text>
        </View>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.9}>
          <Text style={styles.secondaryBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>{habit.title}</Text>
        {habit.description ? <Text style={styles.description}>{habit.description}</Text> : null}

        <Text style={styles.sectionLabel}>Prueba del hábito</Text>
        <Text style={styles.sectionHint}>Toma una foto o selecciónala de tu galería.</Text>

        <View style={styles.photoActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={takePhoto}
            disabled={uploading}
            activeOpacity={0.9}
          >
            <Text style={styles.actionBtnText}>Cámara</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={pickFromGallery}
            disabled={uploading}
            activeOpacity={0.9}
          >
            <Text style={styles.actionBtnText}>Galería</Text>
          </TouchableOpacity>
        </View>

        {photo?.uri ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
          </View>
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.previewPlaceholderText}>Sin foto seleccionada</Text>
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
            <Text style={styles.submitBtnText}>Enviar</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => navigation.goBack()}
        disabled={uploading}
        activeOpacity={0.9}
      >
        <Text style={styles.secondaryBtnText}>Volver</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 64,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  description: {
    marginTop: 10,
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  sectionLabel: {
    marginTop: 20,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionHint: {
    marginTop: 4,
    fontSize: 13,
    color: GRAY,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: NAVY,
    fontWeight: '800',
    fontSize: 14,
  },
  previewContainer: {
    marginTop: 14,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  preview: {
    width: '100%',
    height: 220,
  },
  previewPlaceholder: {
    marginTop: 14,
    height: 220,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholderText: {
    color: GRAY,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 12,
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  successText: {
    marginTop: 12,
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '700',
  },
  submitBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: WHITE,
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 10,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: NAVY,
    fontWeight: '800',
  },
});
