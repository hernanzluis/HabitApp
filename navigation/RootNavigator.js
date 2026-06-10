import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { authFlags, registerSetSession } from '../lib/authFlags';

import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import SignUpScreen from '../screens/SignUpScreen';
import HomeScreen from '../screens/HomeScreen';
import HabitDetailScreen from '../screens/HabitDetailScreen';
import ValidateHabitScreen from '../screens/ValidateHabitScreen';
import RankingScreen from '../screens/RankingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AdminScreen from '../screens/AdminScreen';
import HabitStatsScreen from '../screens/HabitStatsScreen';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const TEXT = '#1D2226';
const GRAY = '#666666';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: ['home', 'home-outline'],
  ValidateHabit: ['checkmark-circle', 'checkmark-circle-outline'],
  Ranking: ['people', 'people-outline'],
};

const HEADER_OPTIONS = {
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
};

function TabNavigator() {
  const { t } = useTranslation();
  const [pendingCount, setPendingCount] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAvatarUrl, setUserAvatarUrl] = useState(null);
  const [userFullName, setUserFullName] = useState('');
  const [hasNoHabits, setHasNoHabits] = useState(false);

  const fetchCompanyName = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id, role, avatar_url, full_name')
        .eq('id', user.id)
        .single();
      if (!profile?.company_id) return;
      if (profile.role === 'admin') setIsAdmin(true);
      setUserAvatarUrl(profile.avatar_url ?? null);
      setUserFullName(profile.full_name ?? '');
      const { data: company } = await supabase
        .from('companies')
        .select('name')
        .eq('id', profile.company_id)
        .single();
      if (company?.name) setCompanyName(company.name);
      const { count } = await supabase
        .from('habits').select('id', { count: 'exact', head: true })
        .eq('company_id', profile.company_id).eq('is_active', true);
      setHasNoHabits((count ?? 0) === 0);
    } catch {
      // non-critical
    }
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: validatorHabits } = await supabase
        .from('habit_validators')
        .select('habit_id')
        .eq('user_id', user.id);
      const validatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);
      if (!validatorHabitIds.length) { setPendingCount(0); return; }

      const { data: pendingLogs } = await supabase
        .from('habit_logs')
        .select('id')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .in('habit_id', validatorHabitIds);
      if (!pendingLogs?.length) { setPendingCount(0); return; }

      const logIds = pendingLogs.map((l) => l.id);
      const { data: myValidations } = await supabase
        .from('habit_validations')
        .select('habit_log_id')
        .eq('validator_id', user.id)
        .in('habit_log_id', logIds);

      const alreadyVoted = new Set((myValidations ?? []).map((v) => v.habit_log_id));
      setPendingCount(pendingLogs.filter((l) => !alreadyVoted.has(l.id)).length);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchCompanyName();
    fetchPendingCount();
  }, [fetchCompanyName, fetchPendingCount]);

  return (
    <Tab.Navigator
      screenListeners={{
        focus: () => {
          fetchPendingCount();
          fetchCompanyName();
        },
      }}
      screenOptions={({ route }) => ({
        ...HEADER_OPTIONS,
        tabBarStyle: { backgroundColor: WHITE, borderTopColor: '#E0E0E0' },
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: GRAY,
        tabBarIcon: ({ focused, color, size }) => {
          const [active, inactive] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={({ navigation: nav }) => ({
          title: companyName || t('nav.home'),
          tabBarLabel: t('nav.home'),
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => nav.navigate('Profile')}
              style={styles.headerAvatarBtn}
              activeOpacity={0.7}
            >
              {userAvatarUrl ? (
                <Image source={{ uri: userAvatarUrl }} style={styles.headerAvatar} />
              ) : (
                <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
                  <Text style={styles.headerAvatarInitial}>
                    {(userFullName || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={styles.headerBtns}>
              {isAdmin ? (
                <TouchableOpacity
                  onPress={() => nav.navigate('Admin')}
                  style={styles.headerBtn}
                  activeOpacity={0.7}
                >
                  <View style={styles.shieldWrapper}>
                    <Ionicons name="shield-outline" size={24} color={TEXT} />
                    {hasNoHabits ? <View style={styles.shieldBadge} /> : null}
                  </View>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => Alert.alert(t('common.coming_soon'))}
                style={styles.headerBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="notifications-outline" size={24} color={TEXT} />
              </TouchableOpacity>
            </View>
          ),
        })}
      />
      <Tab.Screen
        name="ValidateHabit"
        component={ValidateHabitScreen}
        options={{
          title: t('nav.validate'),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarButton: pendingCount === 0
            ? (props) => (
                <TouchableOpacity
                  {...props}
                  disabled
                  activeOpacity={1}
                  style={[props.style, { opacity: 0.35 }]}
                />
              )
            : undefined,
        }}
      />
      <Tab.Screen
        name="Ranking"
        component={RankingScreen}
        options={{ title: t('activity.header_title'), tabBarLabel: t('nav.ranking') }}
      />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, headerBackTitle: '' }}>
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerBackTitle: '' }} />
      <Stack.Screen name="HabitDetail" component={HabitDetailScreen} options={{ headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="Admin" component={AdminScreen} options={{ headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="HabitStats" component={HabitStatsScreen} options={{ headerShown: true, headerBackButtonDisplayMode: 'minimal' }} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    // Exponer setSession al singleton para que SignUpScreen (modo activate)
    // pueda navegar al AppStack manualmente tras completar el registro.
    registerSetSession(setSession);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitializing(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Si el flujo de activación está en marcha, bloqueamos el redirect automático.
      // SignUpScreen reseteará el flag y llamará a activateSession() cuando termine.
      if (session && authFlags.skipNextRedirect) {
        authFlags.skipNextRedirect = false;
        return;
      }
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (initializing) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {session ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarBtn: {
    paddingLeft: 16,
    paddingRight: 4,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerAvatarFallback: {
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    color: WHITE,
    fontWeight: '700',
    fontSize: 18,
  },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  headerBtn: {
    paddingHorizontal: 12,
  },
  shieldWrapper: {
    position: 'relative',
  },
  shieldBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
});
