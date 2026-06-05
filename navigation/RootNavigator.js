import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import SignUpScreen from '../screens/SignUpScreen';
import HomeScreen from '../screens/HomeScreen';
import HabitDetailScreen from '../screens/HabitDetailScreen';
import ValidateHabitScreen from '../screens/ValidateHabitScreen';
import RankingScreen from '../screens/RankingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AdminScreen from '../screens/AdminScreen';

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
  Profile: ['person', 'person-outline'],
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

  const fetchCompanyName = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id, role')
        .eq('id', user.id)
        .single();
      if (!profile?.company_id) return;
      if (profile.role === 'admin') setIsAdmin(true);
      const { data: company } = await supabase
        .from('companies')
        .select('name')
        .eq('id', profile.company_id)
        .single();
      if (company?.name) setCompanyName(company.name);
    } catch {
      // non-critical
    }
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. habit_ids donde el usuario es validador explícito
      const { data: validatorHabits } = await supabase
        .from('habit_validators')
        .select('habit_id')
        .eq('user_id', user.id);
      const validatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);
      if (!validatorHabitIds.length) { setPendingCount(0); return; }

      // 2. logs pendientes de esos hábitos, no propios
      const { data: pendingLogs } = await supabase
        .from('habit_logs')
        .select('id')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .in('habit_id', validatorHabitIds);
      if (!pendingLogs?.length) { setPendingCount(0); return; }

      // 3. excluir los que el usuario ya votó
      const logIds = pendingLogs.map((l) => l.id);
      const { data: myValidations } = await supabase
        .from('habit_validations')
        .select('habit_log_id')
        .eq('validator_id', user.id)
        .in('habit_log_id', logIds);

      // 4. badge = pendientes no votados aún
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
      screenListeners={{ focus: fetchPendingCount }}
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
          headerRight: () => (
            <View style={styles.headerBtns}>
              {isAdmin ? (
                <TouchableOpacity
                  onPress={() => nav.navigate('Admin')}
                  style={styles.headerBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="shield-outline" size={24} color={TEXT} />
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
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: t('nav.profile') }}
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
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitializing(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  headerBtn: {
    paddingHorizontal: 12,
  },
});
