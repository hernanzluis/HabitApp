import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

const NAVY = '#001f3f';
const WHITE = '#ffffff';

export default function HabitDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const habit = route.params?.habit;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{habit?.title ?? 'Hábito'}</Text>
        <Text style={styles.subtitle}>Pantalla en construcción</Text>
        {habit?.description ? <Text style={styles.description}>{habit.description}</Text> : null}
      </View>

      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.9}>
        <Text style={styles.backBtnText}>Volver</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
    paddingHorizontal: 18,
    paddingTop: 64,
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
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#64748b',
  },
  description: {
    marginTop: 12,
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  backBtn: {
    marginTop: 20,
    height: 46,
    borderRadius: 10,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    color: NAVY,
    fontWeight: '800',
  },
});
