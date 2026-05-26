import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const NAVY = '#001f3f';
const WHITE = '#ffffff';

export default function HomeScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);

  const onLogout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await supabase.auth.signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a HabitApp</Text>
      <Text style={styles.subtitle}>Login correcto. Esta es tu pantalla inicial.</Text>

      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} disabled={loading} activeOpacity={0.9}>
        {loading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.logoutBtnText}>Cerrar sesión</Text>}
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
    alignItems: 'center',
  },
  title: {
    color: WHITE,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: WHITE,
    opacity: 0.85,
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  logoutBtn: {
    marginTop: 28,
    width: '100%',
    height: 46,
    borderRadius: 10,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: {
    color: NAVY,
    fontWeight: '800',
  },
});

