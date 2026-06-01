import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
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

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const BLUE = '#0A66C2';
const GRAY = '#666666';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: ['home', 'home-outline'],
  ValidateHabit: ['checkmark-circle', 'checkmark-circle-outline'],
  Ranking: ['trophy', 'trophy-outline'],
  Profile: ['person', 'person-outline'],
};

function TabNavigator() {
  const { t } = useTranslation();
  const [pendingCount, setPendingCount] = useState(0);

  const fetchPendingCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (!profile?.company_id) return;

      const { data: companyHabits } = await supabase
        .from('habits')
        .select('id')
        .eq('company_id', profile.company_id);
      const companyHabitIds = (companyHabits ?? []).map((h) => h.id);
      if (!companyHabitIds.length) { setPendingCount(0); return; }

      const { data: pendingLogs } = await supabase
        .from('habit_logs')
        .select('id')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .in('habit_id', companyHabitIds);
      if (!pendingLogs?.length) { setPendingCount(0); return; }

      const logIds = pendingLogs.map((l) => l.id);
      const { data: myValidations } = await supabase
        .from('habit_validations')
        .select('habit_log_id')
        .eq('validator_id', user.id)
        .in('habit_log_id', logIds);

      const alreadyValidated = new Set((myValidations ?? []).map((v) => v.habit_log_id));
      setPendingCount(pendingLogs.filter((l) => !alreadyValidated.has(l.id)).length);
    } catch {
      // badge failure is non-critical
    }
  }, []);

  useEffect(() => {
    fetchPendingCount();
  }, [fetchPendingCount]);

  return (
    <Tab.Navigator
      screenListeners={{ focus: fetchPendingCount }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: WHITE, borderTopColor: '#E0E0E0' },
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: GRAY,
        tabBarIcon: ({ focused, color, size }) => {
          const [active, inactive] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('nav.home') }} />
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
      <Tab.Screen name="Ranking" component={RankingScreen} options={{ title: t('nav.ranking') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: t('nav.profile') }} />
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="HabitDetail" component={HabitDetailScreen} />
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
});
