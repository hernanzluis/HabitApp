import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const BG = '#F3F2EF';
const WHITE = '#ffffff';
const TEXT = '#1D2226';
const GRAY = '#666666';
const BLUE = '#0A66C2';

const CATEGORY_ICONS = [
  'fitness', 'medical', 'restaurant', 'book', 'moon', 'calendar',
  'water', 'home', 'heart', 'star', 'bicycle', 'walk', 'barbell',
  'pill', 'school', 'ellipsis-horizontal',
];

const CATEGORY_COLORS = [
  '#4CAF50', '#F44336', '#FF9800', '#2196F3',
  '#9C27B0', '#00BCD4', '#009688', '#9E9E9E',
];


function formatDate(dateString, locale) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDisplayTime(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDisplayDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function groupHabitsByCategory(habits, catMap) {
  const buckets = {};
  habits.forEach((h) => {
    const key = h.category_id ?? 'none';
    if (!buckets[key]) buckets[key] = { category: h.category_id ? catMap[h.category_id] ?? null : null, habits: [] };
    buckets[key].habits.push(h);
  });
  return Object.values(buckets).sort((a, b) => {
    if (!a.category && !b.category) return 0;
    if (!a.category) return 1;
    if (!b.category) return -1;
    return (a.category.name ?? '').localeCompare(b.category.name ?? '');
  });
}

function buildExpiresAt(dateObj, timeObj) {
  if (!dateObj) return null;
  const d = new Date(dateObj);
  if (timeObj) {
    d.setHours(timeObj.getHours(), timeObj.getMinutes(), 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

const memberAvatarStyle = { width: 40, height: 40, borderRadius: 20 };
const memberAvatarFallbackStyle = { width: 40, height: 40, borderRadius: 20, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' };
const memberAvatarInitialStyle = { color: WHITE, fontWeight: '700', fontSize: 16 };

// Componente auxiliar: muestra el avatar del miembro o la inicial si la imagen falla / no existe
function MemberAvatar({ avatarUrl, initial }) {
  const [imgError, setImgError] = useState(false);
  if (avatarUrl && !imgError) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={memberAvatarStyle}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <View style={memberAvatarFallbackStyle}>
      <Text style={memberAvatarInitialStyle}>{initial}</Text>
    </View>
  );
}

export default function AdminScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';

  // ── Data state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [habits, setHabits] = useState([]);
  const [members, setMembers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [pendingMembers, setPendingMembers] = useState([]);

  // ── Create-habit modal state ─────────────────────────────────────────────
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRecurrence, setNewRecurrence] = useState('daily');
  const [categoryId, setCategoryId] = useState(null);
  const [dueTime, setDueTime] = useState(null);        // Date|null para daily
  const [expiresDate, setExpiresDate] = useState(null); // Date|null para once
  const [expiresTime, setExpiresTime] = useState(null); // Date|null para once (opcional)
  const [showDuePicker, setShowDuePicker] = useState(false);
  const [showExpDatePicker, setShowExpDatePicker] = useState(false);
  const [showExpTimePicker, setShowExpTimePicker] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [validatorIds, setValidatorIds] = useState(new Set());
  const [weeklyTarget, setWeeklyTarget] = useState(3);
  const [monthlyTarget, setMonthlyTarget] = useState(5);
  const [photoRequired, setPhotoRequired] = useState(true);
  const [rewards, setRewards] = useState([]);
  const [newRewardDays, setNewRewardDays] = useState('7');
  const [newRewardDesc, setNewRewardDesc] = useState('');
  const [showAddRewardForm, setShowAddRewardForm] = useState(false);
  const [savingHabit, setSavingHabit] = useState(false);
  const [modalError, setModalError] = useState('');

  // ── New-category modal state ─────────────────────────────────────────────
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('ellipsis-horizontal');
  const [newCatColor, setNewCatColor] = useState('#4CAF50');
  const [savingCat, setSavingCat] = useState(false);

  // ── Edit-habit modal state ───────────────────────────────────────────────
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);

  // ── Tab + family state ───────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('habits');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [addMemberVisible, setAddMemberVisible] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);

  // ── Edit active member modal ─────────────────────────────────────────────
  const [editMemberVisible, setEditMemberVisible] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberEmail, setEditMemberEmail] = useState('');
  const [editMemberAvatarUrl, setEditMemberAvatarUrl] = useState(null);
  const [editMemberRole, setEditMemberRole] = useState('user');
  const [savingMember, setSavingMember] = useState(false);
  const [memberModalError, setMemberModalError] = useState('');

  // ── Edit pending member modal ────────────────────────────────────────────
  const [editPendingVisible, setEditPendingVisible] = useState(false);
  const [editingPending, setEditingPending] = useState(null);
  const [editPendingName, setEditPendingName] = useState('');
  const [editPendingEmail, setEditPendingEmail] = useState('');
  const [savingPending, setSavingPending] = useState(false);
  const [pendingModalError, setPendingModalError] = useState('');

  // Leer pestaña inicial del parámetro de navegación (p.ej. desde el flujo de nuevo admin)
  useEffect(() => {
    if (route.params?.initialTab) {
      setActiveTab(route.params.initialTab);
    }
  }, [route.params?.initialTab]);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('admin.header_title'),
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

  // ── Load data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.company_id) return;

      setCompanyId(profile.company_id);
      setCurrentUserId(user.id);

      const [
        { data: habitsData, error: habitsError },
        { data: membersData, error: membersError },
        { data: categoriesData, error: categoriesError },
        { data: pendingData, error: pendingError },
        { data: companyData },
      ] = await Promise.all([
        supabase
          .from('habits')
          .select('id, title, description, recurrence, is_active, expires_at, due_time, category_id, weekly_target, monthly_target, photo_required')
          .eq('company_id', profile.company_id)
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name, email, role, avatar_url')
          .eq('company_id', profile.company_id),
        supabase
          .from('categories')
          .select('id, name, icon, color, company_id')
          .or(`company_id.is.null,company_id.eq.${profile.company_id}`)
          .order('name'),
        supabase
          .from('activation_codes')
          .select('id, full_name, email, code, created_at')
          .eq('company_id', profile.company_id)
          .eq('used', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('companies')
          .select('name')
          .eq('id', profile.company_id)
          .single(),
      ]);
      if (companyData?.name) setCompanyName(companyData.name);
      if (habitsError) throw habitsError;
      if (membersError) throw membersError;
      if (categoriesError) throw categoriesError;

      setMembers(membersData ?? []);
      setPendingMembers(pendingData ?? []);
      setCategories(categoriesData ?? []);

      // Enrich habits with assignment and validator counts
      const habitIds = (habitsData ?? []).map((h) => h.id);
      if (habitIds.length > 0) {
        const [{ data: assignData }, { data: validatorData }] = await Promise.all([
          supabase.from('habit_assignments').select('habit_id, user_id').in('habit_id', habitIds),
          supabase.from('habit_validators').select('habit_id, user_id').in('habit_id', habitIds),
        ]);

        const countMap = {};
        const validMap = {};
        (assignData ?? []).forEach((a) => { countMap[a.habit_id] = (countMap[a.habit_id] || 0) + 1; });
        (validatorData ?? []).forEach((v) => { validMap[v.habit_id] = (validMap[v.habit_id] || 0) + 1; });
        setHabits((habitsData ?? []).map((h) => ({ ...h, assignedCount: countMap[h.id] || 0, validatorCount: validMap[h.id] || 0 })));
      } else {
        setHabits([]);
      }
    } catch (e) {
      setError(e?.message || t('admin.error_load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Habit toggle ─────────────────────────────────────────────────────────
  const handleToggle = async (habitId, currentValue) => {
    const newValue = !currentValue;
    setHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, is_active: newValue } : h)));
    try {
      const { error: updateError } = await supabase
        .from('habits')
        .update({ is_active: newValue })
        .eq('id', habitId);
      if (updateError) throw updateError;
    } catch {
      setHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, is_active: currentValue } : h)));
      setError(t('admin.error_toggle'));
    }
  };

  // ── Delete habit ─────────────────────────────────────────────────────────
  const handleDeleteHabit = (habit) => {
    Alert.alert(
      t('admin.delete_habit_title'),
      t('admin.delete_habit_message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete_habit_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { error: deleteError } = await supabase
                .from('habits')
                .delete()
                .eq('id', habit.id);
              if (deleteError) throw deleteError;
              setHabits((prev) => prev.filter((h) => h.id !== habit.id));
            } catch (e) {
              setError(e?.message || t('admin.error_load'));
            }
          },
        },
      ]
    );
  };

  // ── Category handlers ────────────────────────────────────────────────────
  const openCatModal = () => {
    setNewCatName('');
    setNewCatIcon('ellipsis-horizontal');
    setNewCatColor('#4CAF50');
    setModalError('');
    setCatModalVisible(true);
  };

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) { setModalError(t('admin.category_name')); return; }
    if (!companyId) return;
    setSavingCat(true);
    setModalError('');
    try {
      const { error: insertError } = await supabase
        .from('categories')
        .insert({ name: newCatName.trim(), icon: newCatIcon, color: newCatColor, company_id: companyId });
      if (insertError) throw insertError;
      setCatModalVisible(false);
      await loadData();
    } catch (e) {
      setModalError(e?.message || t('admin.error_create'));
    } finally {
      setSavingCat(false);
    }
  };

  const handleDeleteCategory = (cat) => {
    Alert.alert(
      t('admin.delete_habit_title'),
      t('admin.delete_habit_message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete_habit_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { error: deleteError } = await supabase.from('categories').delete().eq('id', cat.id);
              if (deleteError) throw deleteError;
              setCategories((prev) => prev.filter((c) => c.id !== cat.id));
            } catch (e) {
              setError(e?.message || t('admin.error_load'));
            }
          },
        },
      ]
    );
  };

  // ── Create habit ─────────────────────────────────────────────────────────
  const openCreateModal = () => {
    setNewTitle('');
    setNewDescription('');
    setNewRecurrence('daily');
    setCategoryId(null);
    setDueTime(null);
    setExpiresDate(null);
    setExpiresTime(null);
    setShowDuePicker(false);
    setShowExpDatePicker(false);
    setShowExpTimePicker(false);
    setSelectedMembers(new Set());
    setValidatorIds(new Set());
    setWeeklyTarget(3);
    setMonthlyTarget(5);
    setPhotoRequired(true);
    setRewards([]);
    setNewRewardDays('7');
    setNewRewardDesc('');
    setShowAddRewardForm(false);
    setModalError('');
    setCreateModalVisible(true);
  };

  const toggleMember = (userId) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const toggleValidator = (userId) => {
    setValidatorIds((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const handleCreateHabit = async () => {
    if (!newTitle.trim()) { setModalError(t('admin.error_title_required')); return; }
    if (!companyId) return;
    setSavingHabit(true);
    setModalError('');
    try {
      const { data: limitOk, error: limitErr } = await supabase.rpc('check_habit_limit', { p_company_id: companyId });
      if (limitErr) throw limitErr;
      if (limitOk === false) {
        Alert.alert(t('admin.limit_habits_reached'));
        setSavingHabit(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      const { data: newHabit, error: habitError } = await supabase
        .from('habits')
        .insert({
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          company_id: companyId,
          created_by: user.id,
          type: 'custom',
          recurrence: newRecurrence,
          is_active: true,
          category_id: categoryId || null,
          due_time: newRecurrence === 'daily' && dueTime ? `${formatDisplayTime(dueTime)}:00` : null,
          expires_at: newRecurrence === 'once' ? buildExpiresAt(expiresDate, expiresTime) : null,
          weekly_target: newRecurrence === 'weekly_x' ? weeklyTarget : null,
          monthly_target: newRecurrence === 'monthly_x' ? monthlyTarget : null,
          photo_required: photoRequired,
        })
        .select('id')
        .single();
      if (habitError) throw habitError;

      if (selectedMembers.size > 0) {
        const { error: assignError } = await supabase
          .from('habit_assignments')
          .insert([...selectedMembers].map((userId) => ({ habit_id: newHabit.id, user_id: userId })));
        if (assignError) throw assignError;
      }

      if (validatorIds.size > 0) {
        const { error: validError } = await supabase
          .from('habit_validators')
          .insert([...validatorIds].map((userId) => ({ habit_id: newHabit.id, user_id: userId })));
        if (validError) throw validError;
      }

      if (rewards.length > 0) {
        const { error: rewardError } = await supabase
          .from('habit_rewards')
          .insert(rewards.map((r) => ({ habit_id: newHabit.id, streak_target: r.streak_target, description: r.description })));
        if (rewardError) throw rewardError;
      }

      setCreateModalVisible(false);
      loadData();
    } catch (e) {
      setModalError(e?.message || t('admin.error_create'));
    } finally {
      setSavingHabit(false);
    }
  };

  // ── Edit habit ───────────────────────────────────────────────────────────
  const openEditModal = async (habit) => {
    setModalError('');
    let current, currentValidators;
    try {
      const [assignResult, validResult, rewardsResult] = await Promise.all([
        supabase.from('habit_assignments').select('user_id').eq('habit_id', habit.id),
        supabase.from('habit_validators').select('user_id').eq('habit_id', habit.id),
        supabase.from('habit_rewards').select('streak_target, description').eq('habit_id', habit.id).order('streak_target'),
      ]);
      if (assignResult.error) throw assignResult.error;
      if (validResult.error) throw validResult.error;
      current = assignResult.data;
      currentValidators = validResult.data;
      setRewards(rewardsResult.data ?? []);
      setNewRewardDays('7');
      setNewRewardDesc('');
      setShowAddRewardForm(false);
    } catch (e) {
      setError(e?.message || t('admin.error_load'));
      return;
    }

    setEditingHabit(habit);
    setNewTitle(habit.title);
    setNewDescription(habit.description || '');
    setNewRecurrence(habit.recurrence || 'daily');
    setCategoryId(habit.category_id || null);

    if (habit.due_time && habit.recurrence === 'daily') {
      const [hh, mm] = habit.due_time.split(':').map(Number);
      const d = new Date(); d.setHours(hh, mm, 0, 0);
      setDueTime(d);
    } else { setDueTime(null); }

    if (habit.expires_at && habit.recurrence === 'once') {
      const d = new Date(habit.expires_at);
      setExpiresDate(d);
      setExpiresTime(d.getHours() !== 0 || d.getMinutes() !== 0 ? d : null);
    } else { setExpiresDate(null); setExpiresTime(null); }

    setWeeklyTarget(habit.weekly_target ?? 3);
    setMonthlyTarget(habit.monthly_target ?? 5);
    setPhotoRequired(habit.photo_required !== false);
    setShowDuePicker(false);
    setShowExpDatePicker(false);
    setShowExpTimePicker(false);
    setSelectedMembers(new Set((current ?? []).map((a) => a.user_id)));
    setValidatorIds(new Set((currentValidators ?? []).map((v) => v.user_id)));
    setModalError('');
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!newTitle.trim()) { setModalError(t('admin.error_title_required')); return; }
    if (!editingHabit) return;
    setSavingHabit(true);
    setModalError('');
    try {
      const updatedFields = {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        recurrence: newRecurrence,
        category_id: categoryId || null,
        due_time: newRecurrence === 'daily' && dueTime ? `${formatDisplayTime(dueTime)}:00` : null,
        expires_at: newRecurrence === 'once' ? buildExpiresAt(expiresDate, expiresTime) : null,
        weekly_target: newRecurrence === 'weekly_x' ? weeklyTarget : null,
        monthly_target: newRecurrence === 'monthly_x' ? monthlyTarget : null,
        photo_required: photoRequired,
      };
      const { error: updateError } = await supabase
        .from('habits').update(updatedFields).eq('id', editingHabit.id);
      if (updateError) throw updateError;

      const { error: delAssignError } = await supabase.from('habit_assignments').delete().eq('habit_id', editingHabit.id);
      if (delAssignError) throw delAssignError;
      if (selectedMembers.size > 0) {
        const { error: assignError } = await supabase.from('habit_assignments').insert(
          [...selectedMembers].map((userId) => ({ habit_id: editingHabit.id, user_id: userId }))
        );
        if (assignError) throw assignError;
      }

      const { error: delValidError } = await supabase.from('habit_validators').delete().eq('habit_id', editingHabit.id);
      if (delValidError) throw delValidError;
      if (validatorIds.size > 0) {
        const { error: validError } = await supabase.from('habit_validators').insert(
          [...validatorIds].map((userId) => ({ habit_id: editingHabit.id, user_id: userId }))
        );
        if (validError) throw validError;
      }

      const { error: delRewardError } = await supabase.from('habit_rewards').delete().eq('habit_id', editingHabit.id);
      if (delRewardError) throw delRewardError;
      if (rewards.length > 0) {
        const { error: rewardError } = await supabase.from('habit_rewards').insert(
          rewards.map((r) => ({ habit_id: editingHabit.id, streak_target: r.streak_target, description: r.description }))
        );
        if (rewardError) throw rewardError;
      }

      setHabits((prev) => prev.map((h) =>
        h.id === editingHabit.id
          ? { ...h, ...updatedFields, assignedCount: selectedMembers.size, validatorCount: validatorIds.size }
          : h
      ));
      setEditModalVisible(false);
      setEditingHabit(null);
    } catch (e) {
      setModalError(e?.message || t('admin.error_create'));
    } finally {
      setSavingHabit(false);
    }
  };

  // ── Flat list data (sections + habits interleaved) ───────────────────────
  const flatListData = useMemo(() => {
    const catMap = {};
    categories.forEach((c) => { catMap[c.id] = c; });
    const sections = groupHabitsByCategory(habits, catMap);
    const flat = [];
    sections.forEach((section) => {
      flat.push({ type: 'section_header', id: `hdr-${section.category?.id ?? 'none'}`, section });
      section.habits.forEach((h) => flat.push({ type: 'habit', ...h }));
    });
    return flat;
  }, [habits, categories]);

  // ── Render helpers ───────────────────────────────────────────────────────
  const renderHabitRow = (item) => (
    <View style={styles.habitRow}>
      <TouchableOpacity onPress={() => openEditModal(item)} activeOpacity={0.7} style={styles.habitInfo}>
        <Text style={styles.habitTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.habitMeta}>
          {item.expires_at ? (
            <Text style={styles.habitExpires}>
              {t('admin.habit_expires', { date: formatDate(item.expires_at, locale) })}
            </Text>
          ) : null}
          {item.recurrence === 'weekly_x' && item.weekly_target ? (
            <Text style={styles.habitExpires}>{item.weekly_target}× {t('admin.recurrence_weekly')}</Text>
          ) : item.recurrence === 'monthly_x' && item.monthly_target ? (
            <Text style={styles.habitExpires}>{item.monthly_target}× {t('admin.recurrence_monthly')}</Text>
          ) : null}
          <Text style={styles.habitAssigned}>
            {t('admin.habit_assigned_count', { count: item.assignedCount })}
          </Text>
          <Text style={styles.habitValidators}>
            {t('admin.habit_validator_count', { count: item.validatorCount ?? 0 })}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.habitRowActions}>
        <Switch
          value={!!item.is_active}
          onValueChange={() => handleToggle(item.id, !!item.is_active)}
          trackColor={{ false: '#D0D0D0', true: '#BFDBFE' }}
          thumbColor={item.is_active ? BLUE : '#888'}
        />
        <TouchableOpacity
          onPress={() => handleDeleteHabit(item)}
          activeOpacity={0.7}
          style={styles.trashBtn}
        >
          <Ionicons name="trash-outline" size={20} color="#CC0000" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleGenerateCode = async () => {
    if (!memberName.trim() || !memberEmail.trim() || !companyId) return;
    setGeneratingCode(true);
    try {
      const { data: limitOk, error: limitErr } = await supabase.rpc('check_member_limit', { p_company_id: companyId });
      if (limitErr) throw limitErr;
      if (limitOk === false) {
        Alert.alert(t('admin.limit_members_reached'));
        setGeneratingCode(false);
        return;
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const { data: insertedCode, error: insertError } = await supabase.from('activation_codes').insert({
        code,
        full_name: memberName.trim(),
        email: memberEmail.trim(),
        company_id: companyId,
      }).select('id').single();
      if (insertError) throw insertError;
      setGeneratedCode(code);
      setPendingMembers((prev) => [
        { id: insertedCode.id, full_name: memberName.trim(), email: memberEmail.trim(), code, created_at: new Date().toISOString() },
        ...prev,
      ]);
      // Marcar setup de familia como completado para no redirigir de nuevo al admin
      await AsyncStorage.setItem('family_setup_done', '1');
    } catch (e) {
      setError(e?.message || t('admin.error_generate'));
    } finally {
      setGeneratingCode(false);
    }
  };

  // ── Edit active member ────────────────────────────────────────────────────
  const handleOpenEditMember = (member) => {
    setEditingMember(member);
    setEditMemberName(member.full_name || '');
    setEditMemberEmail(member.email || '');
    setEditMemberAvatarUrl(member.avatar_url || null);
    setEditMemberRole(member.role || 'user');
    setMemberModalError('');
    setEditMemberVisible(true);
  };

  const pickMemberImage = async (source) => {
    if (!editingMember) return;
    try {
      const options = { mediaTypes: 'Images', allowsEditing: true, aspect: [1, 1], quality: 0.7 };
      let result;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { Alert.alert(t('common.error_camera_permission')); return; }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert(t('common.error_gallery_permission')); return; }
        result = await ImagePicker.launchImageLibraryAsync(options);
      }
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const uri = result.assets[0].uri;
      const path = `${editingMember.id}/avatar.jpg`;
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, arrayBuffer, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatarWithBust = `${publicUrl}?t=${Date.now()}`;

      const { error: profileError } = await supabase.rpc('update_member_avatar', {
        member_id: editingMember.id,
        new_avatar_url: publicUrl,
      });
      if (profileError) throw profileError;

      setEditMemberAvatarUrl(avatarWithBust);
      setMembers((prev) => prev.map((m) => m.id === editingMember.id ? { ...m, avatar_url: avatarWithBust } : m));
    } catch (e) {
      Alert.alert('Error', e?.message || t('profile.error_avatar'));
    }
  };

  const handleMemberAvatarPress = () => {
    Alert.alert(t('profile.avatar_title'), t('profile.avatar_prompt'), [
      { text: t('common.camera'), onPress: () => pickMemberImage('camera') },
      { text: t('common.gallery'), onPress: () => pickMemberImage('gallery') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleDeleteMember = () => {
    if (!editingMember) return;
    Alert.alert(
      t('admin.delete_member_title'),
      t('admin.delete_member_message', { name: editingMember.full_name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete_member_title'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.rpc('delete_member', { member_id: editingMember.id });
              if (error) throw error;
              setMembers((prev) => prev.filter((m) => m.id !== editingMember.id));
              setEditMemberVisible(false);
              setEditingMember(null);
            } catch (e) {
              Alert.alert(t('common.error'), e?.message || t('admin.error_load'));
            }
          },
        },
      ]
    );
  };

  const handleSaveMember = async () => {
    if (!editingMember) return;
    setSavingMember(true);
    setMemberModalError('');
    try {
      // Verificar mínimo de admins si se baja de admin a user
      const roleChanged = editMemberRole !== editingMember.role;
      if (roleChanged && editingMember.role === 'admin' && editMemberRole !== 'admin') {
        const adminCount = members.filter((m) => m.role === 'admin').length;
        if (adminCount <= 1) {
          setMemberModalError(t('admin.role_min_admin_error'));
          setSavingMember(false);
          return;
        }
      }

      const updatePayload = {
        full_name: editMemberName.trim(),
        email: editMemberEmail.trim(),
      };
      if (roleChanged) updatePayload.role = editMemberRole;

      const { error: updateError } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', editingMember.id);
      if (updateError) throw updateError;

      setMembers((prev) => prev.map((m) =>
        m.id === editingMember.id
          ? { ...m, full_name: editMemberName.trim(), email: editMemberEmail.trim(), avatar_url: editMemberAvatarUrl, role: editMemberRole }
          : m
      ));
      setEditMemberVisible(false);
      setEditingMember(null);
    } catch (e) {
      setMemberModalError(e?.message || t('admin.error_load'));
    } finally {
      setSavingMember(false);
    }
  };

  // ── Edit pending member ───────────────────────────────────────────────────
  const handleOpenEditPending = (pending) => {
    setEditingPending(pending);
    setEditPendingName(pending.full_name || '');
    setEditPendingEmail(pending.email || '');
    setPendingModalError('');
    setEditPendingVisible(true);
  };

  const handleSavePending = async () => {
    if (!editingPending) return;
    setSavingPending(true);
    setPendingModalError('');
    try {
      const { error: updateError } = await supabase
        .from('activation_codes')
        .update({ full_name: editPendingName.trim(), email: editPendingEmail.trim() })
        .eq('id', editingPending.id);
      if (updateError) throw updateError;
      setPendingMembers((prev) => prev.map((p) =>
        p.id === editingPending.id
          ? { ...p, full_name: editPendingName.trim(), email: editPendingEmail.trim() }
          : p
      ));
      setEditPendingVisible(false);
      setEditingPending(null);
    } catch (e) {
      setPendingModalError(e?.message || t('admin.error_load'));
    } finally {
      setSavingPending(false);
    }
  };

  const handleCancelInvitation = () => {
    Alert.alert(
      t('admin.cancel_invitation'),
      t('admin.cancel_invitation_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete_habit_confirm'),
          style: 'destructive',
          onPress: async () => {
            const pending = editingPending; // captura el valor actual antes del await
            if (!pending) return;
            try {
              const { error: deleteError } = await supabase
                .from('activation_codes')
                .delete()
                .eq('id', pending.id);
              if (deleteError) throw deleteError;
              setPendingMembers((prev) => prev.filter((p) => p.id !== pending.id));
              setEditPendingVisible(false);
              setEditingPending(null);
            } catch (e) {
              setPendingModalError(e?.message || t('admin.error_load'));
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => {
    if (item.type === 'section_header') {
      const { category } = item.section;
      return (
        <View style={[styles.categoryHeader, { backgroundColor: category ? category.color + '1A' : BG }]}>
          <Ionicons
            name={category ? category.icon : 'help-circle-outline'}
            size={15}
            color={category ? category.color : GRAY}
          />
          <Text style={[styles.categoryHeaderText, { color: category ? category.color : GRAY }]}>
            {category ? category.name : t('admin.no_category')}
          </Text>
        </View>
      );
    }
    return renderHabitRow(item);
  };

  // ── Member / validator toggle rows ──────────────────────────────────────
  const renderMemberToggle = (member) => (
    <TouchableOpacity
      key={member.id}
      style={styles.memberRow}
      onPress={() => toggleMember(member.id)}
      activeOpacity={0.7}
    >
      <Text style={styles.memberName}>{member.full_name || '—'}</Text>
      <View style={[styles.checkbox, selectedMembers.has(member.id) && styles.checkboxActive]}>
        {selectedMembers.has(member.id) && (
          <Ionicons name="checkmark" size={14} color={WHITE} />
        )}
      </View>
    </TouchableOpacity>
  );

  const renderValidatorToggle = (member) => (
    <TouchableOpacity
      key={member.id}
      style={styles.memberRow}
      onPress={() => toggleValidator(member.id)}
      activeOpacity={0.7}
    >
      <Text style={styles.memberName}>{member.full_name || '—'}</Text>
      <View style={[styles.checkbox, validatorIds.has(member.id) && styles.checkboxActive]}>
        {validatorIds.has(member.id) && (
          <Ionicons name="checkmark" size={14} color={WHITE} />
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('admin.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.listContent}
        data={activeTab === 'habits' ? flatListData : []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={BLUE} />
        }
        ListHeaderComponent={
          <>
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Tab selector — estilo LinkedIn */}
            <View style={styles.tabUnderlineRow}>
              {(['habits', 'family']).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={styles.tabUnderlineItem}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabUnderlineText, activeTab === tab && styles.tabUnderlineTextActive]}>
                    {tab === 'habits' ? t('admin.tab_habits') : t('admin.tab_family')}
                  </Text>
                  {activeTab === tab ? <View style={styles.tabUnderlineIndicator} /> : null}
                </TouchableOpacity>
              ))}
            </View>

            {activeTab === 'habits' ? (
              <>
                {/* Habits section header */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{t('admin.habits_section')}</Text>
                  <TouchableOpacity style={styles.newHabitBtn} onPress={openCreateModal} activeOpacity={0.8}>
                    <Ionicons name="add" size={18} color={WHITE} />
                    <Text style={styles.newHabitBtnText}>{t('admin.habit_new')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* Family section header */
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('admin.tab_family')}</Text>
                <TouchableOpacity
                  style={styles.newHabitBtn}
                  onPress={() => { setMemberName(''); setMemberEmail(''); setGeneratedCode(''); setAddMemberVisible(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.newHabitBtnText}>{t('admin.add_member')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        }
        renderItem={renderItem}
        ItemSeparatorComponent={({ leadingItem, trailingItem }) =>
          leadingItem?.type === 'habit' && trailingItem?.type === 'habit'
            ? <View style={styles.separator} />
            : null
        }
        ListEmptyComponent={
          !error && activeTab === 'habits' ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>{t('admin.empty_habits')}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View>
            {/* ── Pestaña Familia ──────────────────────────────────────────── */}
            {activeTab === 'family' ? (
              <>
                {/* Miembros activos */}
                {members.map((m) => {
                    const initial = (m.full_name || '?').charAt(0).toUpperCase();
                    const isMe = m.id === currentUserId;
                    return (
                      <View key={m.id}>
                        <TouchableOpacity
                          style={styles.familyMemberRow}
                          onPress={() => handleOpenEditMember(m)}
                          activeOpacity={0.7}
                        >
                          <MemberAvatar key={m.avatar_url ?? 'fallback'} avatarUrl={m.avatar_url} initial={initial} />
                          <View style={styles.familyInfo}>
                            <Text style={styles.familyMemberName} numberOfLines={1}>{m.full_name || '—'}</Text>
                            <Text style={styles.familyMemberEmail} numberOfLines={1}>{m.email || '—'}</Text>
                          </View>
                          {isMe ? (
                            <View style={[styles.familyStatusActive, { backgroundColor: '#E8E8E8' }]}>
                              <Text style={[styles.familyStatusActiveText, { color: GRAY }]}>Tú</Text>
                            </View>
                          ) : (
                            <View style={styles.familyStatusActive}>
                              <Text style={styles.familyStatusActiveText}>{t('admin.member_status_active')}</Text>
                            </View>
                          )}
                          <Ionicons name="chevron-forward" size={16} color={GRAY} style={{ marginLeft: 4 }} />
                        </TouchableOpacity>
                        <View style={styles.separator} />
                      </View>
                    );
                  })
                }
                {/* Miembros pendientes (activation_codes sin usar) */}
                {pendingMembers.map((p) => {
                  const initial = (p.full_name || '?').charAt(0).toUpperCase();
                  return (
                    <View key={p.id}>
                      <TouchableOpacity
                        style={styles.familyMemberRow}
                        onPress={() => handleOpenEditPending(p)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.familyAvatarFallback, { backgroundColor: '#E0E0E0' }]}>
                          <Text style={[styles.familyAvatarInitial, { color: GRAY }]}>{initial}</Text>
                        </View>
                        <View style={styles.familyInfo}>
                          <Text style={styles.familyMemberName} numberOfLines={1}>{p.full_name || '—'}</Text>
                          <Text style={styles.familyMemberEmail} numberOfLines={1}>{p.email || '—'}</Text>
                        </View>
                        <View style={styles.familyStatusPending}>
                          <Text style={styles.familyStatusPendingText}>{t('admin.member_status_pending')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={GRAY} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                      <View style={styles.separator} />
                    </View>
                  );
                })}
                {members.filter((m) => m.id !== currentUserId).length === 0 && pendingMembers.length === 0 && members.length <= 1 ? (
                  <View style={styles.familyWelcomeBox}>
                    <Ionicons name="people-outline" size={40} color={BLUE} />
                    <Text style={styles.familyWelcomeText}>{t('admin.family_welcome')}</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {/* ── Pestaña Hábitos: categorías ──────────────────────────────── */}
            {activeTab === 'habits' ? (
              <>
            <View style={styles.sectionDivider} />
            {/* Categories section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('admin.categories_title')}</Text>
              <TouchableOpacity style={styles.newHabitBtn} onPress={openCatModal} activeOpacity={0.8}>
                <Ionicons name="add" size={18} color={WHITE} />
                <Text style={styles.newHabitBtnText}>{t('admin.new_category')}</Text>
              </TouchableOpacity>
            </View>
            {/* Predefined */}
            {categories.some((c) => !c.company_id) && (
              <View style={styles.catGroupHeader}>
                <Text style={styles.catGroupLabel}>{t('admin.predefined')}</Text>
              </View>
            )}
            {categories.filter((c) => !c.company_id).map((cat) => (
              <View key={cat.id} style={styles.categoryRow}>
                <View style={[styles.catIconBadge, { backgroundColor: cat.color + '26' }]}>
                  <Ionicons name={cat.icon} size={16} color={cat.color} />
                </View>
                <Text style={styles.catName}>{cat.name}</Text>
              </View>
            ))}
            {/* Custom */}
            {categories.some((c) => !!c.company_id) && (
              <View style={styles.catGroupHeader}>
                <Text style={styles.catGroupLabel}>{t('admin.custom')}</Text>
              </View>
            )}
            {categories.filter((c) => !!c.company_id).map((cat) => (
              <View key={cat.id} style={styles.categoryRow}>
                <View style={[styles.catIconBadge, { backgroundColor: cat.color + '26' }]}>
                  <Ionicons name={cat.icon} size={16} color={cat.color} />
                </View>
                <Text style={[styles.catName, { flex: 1 }]}>{cat.name}</Text>
                <TouchableOpacity onPress={() => handleDeleteCategory(cat)} style={styles.trashBtn} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={18} color="#CC0000" />
                </TouchableOpacity>
              </View>
            ))}
            {__DEV__ ? (
              <TouchableOpacity
                style={styles.devResetBtn}
                onPress={() => AsyncStorage.removeItem('onboarding_completed')}
                activeOpacity={0.7}
              >
                <Text style={styles.devResetText}>Reset onboarding (dev)</Text>
              </TouchableOpacity>
            ) : null}
              </>
            ) : null}
            <View style={{ height: 32 }} />
          </View>
        }
      />

      {/* ── Modal: añadir miembro ────────────────────────────────────────── */}
      <Modal
        visible={addMemberVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddMemberVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setAddMemberVisible(false)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t('admin.add_member')}</Text>
              <View style={styles.modalDivider} />
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {generatedCode ? (
                  <>
                    <Text style={styles.sectionHint}>{t('admin.activation_code_label')}</Text>
                    <View style={[styles.codeBox, { marginTop: 8 }]}>
                      <Text style={styles.codeText}>{generatedCode}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.saveBtn, { marginTop: 16 }]}
                      onPress={async () => {
                        try {
                          await Share.share({ message: t('admin.share_activation', { group: companyName, code: generatedCode }) });
                        } catch {}
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnPrimaryText}>{t('admin.invite_share')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnSecondary, { marginTop: 10 }]}
                      onPress={() => setAddMemberVisible(false)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.btnSecondaryText}>{t('common.close')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.inputLabel}>{t('admin.member_name')}</Text>
                    <TextInput
                      style={styles.input}
                      value={memberName}
                      onChangeText={setMemberName}
                      placeholder={t('admin.member_name')}
                      placeholderTextColor={GRAY}
                    />
                    <Text style={[styles.inputLabel, { marginTop: 12 }]}>{t('admin.member_email')}</Text>
                    <TextInput
                      style={styles.input}
                      value={memberEmail}
                      onChangeText={setMemberEmail}
                      placeholder={t('admin.member_email')}
                      placeholderTextColor={GRAY}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, (!memberName.trim() || !memberEmail.trim()) && styles.btnDisabled]}
                      onPress={handleGenerateCode}
                      disabled={generatingCode || !memberName.trim() || !memberEmail.trim()}
                      activeOpacity={0.85}
                    >
                      {generatingCode
                        ? <ActivityIndicator color={WHITE} />
                        : <Text style={styles.btnPrimaryText}>{t('admin.generate_code')}</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: crear hábito ───────────────────────────────────────────── */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateModalVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('admin.habit_new')}</Text>
            <View style={styles.modalDivider} />

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Título */}
              <TextInput
                style={styles.input}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder={t('admin.habit_title_placeholder')}
                placeholderTextColor={GRAY}
                maxLength={80}
                editable={!savingHabit}
              />

              {/* Descripción */}
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={newDescription}
                onChangeText={setNewDescription}
                placeholder={t('admin.habit_description_placeholder')}
                placeholderTextColor={GRAY}
                multiline
                maxLength={200}
                editable={!savingHabit}
              />

              {/* Recurrencia */}
              <Text style={styles.fieldLabel}>{t('admin.habit_recurrence_label')}</Text>
              <View style={styles.pillRow}>
                {[
                  { value: 'daily',     label: t('admin.habit_recurrence_daily') },
                  { value: 'once',      label: t('admin.habit_recurrence_once') },
                  { value: 'weekly_x',  label: t('admin.recurrence_weekly') },
                  { value: 'monthly_x', label: t('admin.recurrence_monthly') },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.pill, newRecurrence === opt.value && styles.pillActive]}
                    onPress={() => setNewRecurrence(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pillText, newRecurrence === opt.value && styles.pillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Veces por semana — solo para weekly_x */}
              {newRecurrence === 'weekly_x' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.weekly_target_label')}</Text>
                  <View style={styles.weeklyTargetSelector}>
                    <TouchableOpacity
                      onPress={() => setWeeklyTarget((p) => Math.max(1, p - 1))}
                      style={[styles.weeklyTargetBtn, weeklyTarget <= 1 && styles.btnDisabled]}
                      activeOpacity={0.7}
                      disabled={weeklyTarget <= 1}
                    >
                      <Text style={styles.weeklyTargetBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.weeklyTargetValue}>{weeklyTarget}</Text>
                    <TouchableOpacity
                      onPress={() => setWeeklyTarget((p) => Math.min(7, p + 1))}
                      style={[styles.weeklyTargetBtn, weeklyTarget >= 7 && styles.btnDisabled]}
                      activeOpacity={0.7}
                      disabled={weeklyTarget >= 7}
                    >
                      <Text style={styles.weeklyTargetBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Veces por mes — solo para monthly_x */}
              {newRecurrence === 'monthly_x' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.monthly_target_label')}</Text>
                  <View style={styles.weeklyTargetSelector}>
                    <TouchableOpacity
                      onPress={() => setMonthlyTarget((p) => Math.max(1, p - 1))}
                      style={[styles.weeklyTargetBtn, monthlyTarget <= 1 && styles.btnDisabled]}
                      activeOpacity={0.7}
                      disabled={monthlyTarget <= 1}
                    >
                      <Text style={styles.weeklyTargetBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.weeklyTargetValue}>{monthlyTarget}</Text>
                    <TouchableOpacity
                      onPress={() => setMonthlyTarget((p) => Math.min(28, p + 1))}
                      style={[styles.weeklyTargetBtn, monthlyTarget >= 28 && styles.btnDisabled]}
                      activeOpacity={0.7}
                      disabled={monthlyTarget >= 28}
                    >
                      <Text style={styles.weeklyTargetBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Hora límite — solo para daily */}
              {newRecurrence === 'daily' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.due_time_label')}</Text>
                  <View style={styles.timeRow}>
                    <TouchableOpacity
                      style={[styles.pickerBtn, { flex: 1 }]}
                      onPress={() => setShowDuePicker(true)}
                      activeOpacity={0.7}
                      disabled={savingHabit}
                    >
                      <Text style={dueTime ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                        {dueTime ? formatDisplayTime(dueTime) : t('admin.due_time_placeholder')}
                      </Text>
                    </TouchableOpacity>
                    {dueTime ? (
                      <TouchableOpacity
                        onPress={() => { setDueTime(null); setShowDuePicker(false); }}
                        style={styles.clearBtn}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.clearBtnText}>{t('admin.expires_at_clear')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {showDuePicker && (
                    <>
                      <DateTimePicker
                        value={dueTime || new Date()}
                        mode="time"
                        display="spinner"
                        onChange={(_, selected) => {
                          if (Platform.OS === 'android') setShowDuePicker(false);
                          if (selected) setDueTime(selected);
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity onPress={() => setShowDuePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}>
                          <Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Fecha y hora límite — solo para once */}
              {newRecurrence === 'once' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.expires_at_label')}</Text>
                  <View style={styles.timeRow}>
                    <TouchableOpacity
                      style={[styles.pickerBtn, { flex: 2 }]}
                      onPress={() => setShowExpDatePicker(true)}
                      activeOpacity={0.7}
                      disabled={savingHabit}
                    >
                      <Text style={expiresDate ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                        {expiresDate ? formatDisplayDate(expiresDate) : t('admin.expires_at_placeholder')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pickerBtn, { flex: 1, marginLeft: 8 }]}
                      onPress={() => setShowExpTimePicker(true)}
                      activeOpacity={0.7}
                      disabled={savingHabit || !expiresDate}
                    >
                      <Text style={expiresTime ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                        {expiresTime ? formatDisplayTime(expiresTime) : 'HH:MM'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {(expiresDate || expiresTime) ? (
                    <TouchableOpacity
                      onPress={() => { setExpiresDate(null); setExpiresTime(null); setShowExpDatePicker(false); setShowExpTimePicker(false); }}
                      style={[styles.clearBtn, { alignSelf: 'flex-start', marginBottom: 12 }]}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.clearBtnText}>{t('admin.expires_at_clear')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {showExpDatePicker && (
                    <>
                      <DateTimePicker
                        value={expiresDate || new Date()}
                        mode="date"
                        display="spinner"
                        minimumDate={new Date()}
                        onChange={(_, selected) => {
                          if (Platform.OS === 'android') setShowExpDatePicker(false);
                          if (selected) setExpiresDate(selected);
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity onPress={() => setShowExpDatePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}>
                          <Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                  {showExpTimePicker && (
                    <>
                      <DateTimePicker
                        value={expiresTime || new Date()}
                        mode="time"
                        display="spinner"
                        onChange={(_, selected) => {
                          if (Platform.OS === 'android') setShowExpTimePicker(false);
                          if (selected) setExpiresTime(selected);
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity onPress={() => setShowExpTimePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}>
                          <Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Categoría */}
              {categories.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.categories_title')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPillRow}>
                    <TouchableOpacity
                      style={[styles.catPill, categoryId === null && styles.catPillNoneActive]}
                      onPress={() => setCategoryId(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.catPillText, categoryId === null && styles.catPillTextActive]}>—</Text>
                    </TouchableOpacity>
                    {categories.map((cat) => (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.catPill, categoryId === cat.id && { borderColor: cat.color, backgroundColor: cat.color + '1A' }]}
                        onPress={() => setCategoryId(cat.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={cat.icon} size={14} color={categoryId === cat.id ? cat.color : GRAY} />
                        <Text style={[styles.catPillText, categoryId === cat.id && { color: cat.color }]}>{cat.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              {/* Foto obligatoria */}
              <View style={styles.photoRequiredRow}>
                <View style={styles.photoRequiredInfo}>
                  <Text style={styles.fieldLabel}>{t('admin.photo_required_label')}</Text>
                  <Text style={styles.photoRequiredDesc}>{t('admin.photo_required_desc')}</Text>
                </View>
                <Switch
                  value={photoRequired}
                  onValueChange={setPhotoRequired}
                  trackColor={{ false: '#D0D0D0', true: '#BFDBFE' }}
                  thumbColor={photoRequired ? BLUE : '#888'}
                  disabled={savingHabit}
                />
              </View>

              {/* Asignación */}
              <Text style={styles.fieldLabel}>{t('admin.habit_assign_label')}</Text>
              {members.map(renderMemberToggle)}

              {/* Validadores */}
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('admin.validators_label')}</Text>
              {members.map(renderValidatorToggle)}

              {/* Recompensas */}
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('admin.rewards_title')}</Text>
              {rewards.map((r, idx) => (
                <View key={idx} style={styles.rewardRow}>
                  <Text style={styles.rewardText}>🎯 {r.streak_target} {t('admin.reward_days')} → {r.description}</Text>
                  <TouchableOpacity onPress={() => setRewards((prev) => prev.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.rewardRemove}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {showAddRewardForm ? (
                <View style={styles.addRewardForm}>
                  <View style={styles.addRewardInputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      value={newRewardDays}
                      onChangeText={setNewRewardDays}
                      keyboardType="numeric"
                      placeholder="7"
                      placeholderTextColor={GRAY}
                      maxLength={3}
                    />
                    <Text style={styles.rewardDaysLabel}>{t('admin.reward_days')}</Text>
                  </View>
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={newRewardDesc}
                    onChangeText={setNewRewardDesc}
                    placeholder={t('admin.reward_placeholder')}
                    placeholderTextColor={GRAY}
                    maxLength={80}
                  />
                  <TouchableOpacity
                    style={styles.addRewardConfirmBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      const days = parseInt(newRewardDays, 10);
                      if (!days || days < 1 || !newRewardDesc.trim()) return;
                      setRewards((prev) => [...prev, { streak_target: days, description: newRewardDesc.trim() }].sort((a, b) => a.streak_target - b.streak_target));
                      setNewRewardDays('7');
                      setNewRewardDesc('');
                      setShowAddRewardForm(false);
                    }}
                  >
                    <Text style={styles.addRewardConfirmText}>{t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addRewardBtn} onPress={() => setShowAddRewardForm(true)} activeOpacity={0.8}>
                  <Text style={styles.addRewardBtnText}>{t('admin.add_reward')}</Text>
                </TouchableOpacity>
              )}

              {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}

              <TouchableOpacity
                style={[styles.saveBtn, savingHabit && styles.btnDisabled]}
                onPress={handleCreateHabit}
                disabled={savingHabit}
                activeOpacity={0.85}
              >
                {savingHabit ? (
                  <ActivityIndicator color={WHITE} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('admin.habit_save')}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modal: editar hábito ─────────────────────────────────────────── */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setEditModalVisible(false); setEditingHabit(null); }}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => { setEditModalVisible(false); setEditingHabit(null); }}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('admin.edit_habit_title')}</Text>
            <View style={styles.modalDivider} />

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
              <TextInput style={styles.input} value={newTitle} onChangeText={setNewTitle} placeholder={t('admin.habit_title_placeholder')} placeholderTextColor={GRAY} maxLength={80} editable={!savingHabit} />
              <TextInput style={[styles.input, styles.inputMultiline]} value={newDescription} onChangeText={setNewDescription} placeholder={t('admin.habit_description_placeholder')} placeholderTextColor={GRAY} multiline maxLength={200} editable={!savingHabit} />

              <Text style={styles.fieldLabel}>{t('admin.habit_recurrence_label')}</Text>
              <View style={styles.pillRow}>
                {[
                  { value: 'daily',     label: t('admin.habit_recurrence_daily') },
                  { value: 'once',      label: t('admin.habit_recurrence_once') },
                  { value: 'weekly_x',  label: t('admin.recurrence_weekly') },
                  { value: 'monthly_x', label: t('admin.recurrence_monthly') },
                ].map((opt) => (
                  <TouchableOpacity key={opt.value} style={[styles.pill, newRecurrence === opt.value && styles.pillActive]} onPress={() => { setNewRecurrence(opt.value); setDueTime(null); setExpiresDate(null); setExpiresTime(null); }} activeOpacity={0.8}>
                    <Text style={[styles.pillText, newRecurrence === opt.value && styles.pillTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {newRecurrence === 'weekly_x' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.weekly_target_label')}</Text>
                  <View style={styles.weeklyTargetSelector}>
                    <TouchableOpacity onPress={() => setWeeklyTarget((p) => Math.max(1, p - 1))} style={[styles.weeklyTargetBtn, weeklyTarget <= 1 && styles.btnDisabled]} activeOpacity={0.7} disabled={weeklyTarget <= 1}>
                      <Text style={styles.weeklyTargetBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.weeklyTargetValue}>{weeklyTarget}</Text>
                    <TouchableOpacity onPress={() => setWeeklyTarget((p) => Math.min(7, p + 1))} style={[styles.weeklyTargetBtn, weeklyTarget >= 7 && styles.btnDisabled]} activeOpacity={0.7} disabled={weeklyTarget >= 7}>
                      <Text style={styles.weeklyTargetBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {newRecurrence === 'monthly_x' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.monthly_target_label')}</Text>
                  <View style={styles.weeklyTargetSelector}>
                    <TouchableOpacity onPress={() => setMonthlyTarget((p) => Math.max(1, p - 1))} style={[styles.weeklyTargetBtn, monthlyTarget <= 1 && styles.btnDisabled]} activeOpacity={0.7} disabled={monthlyTarget <= 1}>
                      <Text style={styles.weeklyTargetBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.weeklyTargetValue}>{monthlyTarget}</Text>
                    <TouchableOpacity onPress={() => setMonthlyTarget((p) => Math.min(28, p + 1))} style={[styles.weeklyTargetBtn, monthlyTarget >= 28 && styles.btnDisabled]} activeOpacity={0.7} disabled={monthlyTarget >= 28}>
                      <Text style={styles.weeklyTargetBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {newRecurrence === 'daily' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.due_time_label')}</Text>
                  <View style={styles.timeRow}>
                    <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowDuePicker(true)} activeOpacity={0.7} disabled={savingHabit}>
                      <Text style={dueTime ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>{dueTime ? formatDisplayTime(dueTime) : t('admin.due_time_placeholder')}</Text>
                    </TouchableOpacity>
                    {dueTime ? <TouchableOpacity onPress={() => { setDueTime(null); setShowDuePicker(false); }} style={styles.clearBtn} activeOpacity={0.7}><Text style={styles.clearBtnText}>{t('admin.expires_at_clear')}</Text></TouchableOpacity> : null}
                  </View>
                  {showDuePicker && (<><DateTimePicker value={dueTime || new Date()} mode="time" display="spinner" onChange={(_, s) => { if (Platform.OS === 'android') setShowDuePicker(false); if (s) setDueTime(s); }} />{Platform.OS === 'ios' && <TouchableOpacity onPress={() => setShowDuePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}><Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text></TouchableOpacity>}</>)}
                </>
              )}

              {newRecurrence === 'once' && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.expires_at_label')}</Text>
                  <View style={styles.timeRow}>
                    <TouchableOpacity style={[styles.pickerBtn, { flex: 2 }]} onPress={() => setShowExpDatePicker(true)} activeOpacity={0.7} disabled={savingHabit}>
                      <Text style={expiresDate ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>{expiresDate ? formatDisplayDate(expiresDate) : t('admin.expires_at_placeholder')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.pickerBtn, { flex: 1, marginLeft: 8 }]} onPress={() => setShowExpTimePicker(true)} activeOpacity={0.7} disabled={savingHabit || !expiresDate}>
                      <Text style={expiresTime ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>{expiresTime ? formatDisplayTime(expiresTime) : 'HH:MM'}</Text>
                    </TouchableOpacity>
                  </View>
                  {(expiresDate || expiresTime) ? <TouchableOpacity onPress={() => { setExpiresDate(null); setExpiresTime(null); setShowExpDatePicker(false); setShowExpTimePicker(false); }} style={[styles.clearBtn, { alignSelf: 'flex-start', marginBottom: 12 }]} activeOpacity={0.7}><Text style={styles.clearBtnText}>{t('admin.expires_at_clear')}</Text></TouchableOpacity> : null}
                  {showExpDatePicker && (<><DateTimePicker value={expiresDate || new Date()} mode="date" display="spinner" minimumDate={new Date()} onChange={(_, s) => { if (Platform.OS === 'android') setShowExpDatePicker(false); if (s) setExpiresDate(s); }} />{Platform.OS === 'ios' && <TouchableOpacity onPress={() => setShowExpDatePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}><Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text></TouchableOpacity>}</>)}
                  {showExpTimePicker && (<><DateTimePicker value={expiresTime || new Date()} mode="time" display="spinner" onChange={(_, s) => { if (Platform.OS === 'android') setShowExpTimePicker(false); if (s) setExpiresTime(s); }} />{Platform.OS === 'ios' && <TouchableOpacity onPress={() => setShowExpTimePicker(false)} style={styles.pickerDoneBtn} activeOpacity={0.8}><Text style={styles.pickerDoneBtnText}>{t('common.save')}</Text></TouchableOpacity>}</>)}
                </>
              )}

              {categories.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>{t('admin.categories_title')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPillRow}>
                    <TouchableOpacity style={[styles.catPill, categoryId === null && styles.catPillNoneActive]} onPress={() => setCategoryId(null)} activeOpacity={0.7}>
                      <Text style={[styles.catPillText, categoryId === null && styles.catPillTextActive]}>—</Text>
                    </TouchableOpacity>
                    {categories.map((cat) => (
                      <TouchableOpacity key={cat.id} style={[styles.catPill, categoryId === cat.id && { borderColor: cat.color, backgroundColor: cat.color + '1A' }]} onPress={() => setCategoryId(cat.id)} activeOpacity={0.7}>
                        <Ionicons name={cat.icon} size={14} color={categoryId === cat.id ? cat.color : GRAY} />
                        <Text style={[styles.catPillText, categoryId === cat.id && { color: cat.color }]}>{cat.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              {/* Foto obligatoria */}
              <View style={styles.photoRequiredRow}>
                <View style={styles.photoRequiredInfo}>
                  <Text style={styles.fieldLabel}>{t('admin.photo_required_label')}</Text>
                  <Text style={styles.photoRequiredDesc}>{t('admin.photo_required_desc')}</Text>
                </View>
                <Switch
                  value={photoRequired}
                  onValueChange={setPhotoRequired}
                  trackColor={{ false: '#D0D0D0', true: '#BFDBFE' }}
                  thumbColor={photoRequired ? BLUE : '#888'}
                  disabled={savingHabit}
                />
              </View>

              <Text style={styles.fieldLabel}>{t('admin.habit_assign_label')}</Text>
              {members.map(renderMemberToggle)}

              {/* Validadores */}
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('admin.validators_label')}</Text>
              {members.map(renderValidatorToggle)}

              {/* Recompensas */}
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('admin.rewards_title')}</Text>
              {rewards.map((r, idx) => (
                <View key={idx} style={styles.rewardRow}>
                  <Text style={styles.rewardText}>🎯 {r.streak_target} {t('admin.reward_days')} → {r.description}</Text>
                  <TouchableOpacity onPress={() => setRewards((prev) => prev.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.rewardRemove}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {showAddRewardForm ? (
                <View style={styles.addRewardForm}>
                  <View style={styles.addRewardInputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      value={newRewardDays}
                      onChangeText={setNewRewardDays}
                      keyboardType="numeric"
                      placeholder="7"
                      placeholderTextColor={GRAY}
                      maxLength={3}
                    />
                    <Text style={styles.rewardDaysLabel}>{t('admin.reward_days')}</Text>
                  </View>
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={newRewardDesc}
                    onChangeText={setNewRewardDesc}
                    placeholder={t('admin.reward_placeholder')}
                    placeholderTextColor={GRAY}
                    maxLength={80}
                  />
                  <TouchableOpacity
                    style={styles.addRewardConfirmBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      const days = parseInt(newRewardDays, 10);
                      if (!days || days < 1 || !newRewardDesc.trim()) return;
                      setRewards((prev) => [...prev, { streak_target: days, description: newRewardDesc.trim() }].sort((a, b) => a.streak_target - b.streak_target));
                      setNewRewardDays('7');
                      setNewRewardDesc('');
                      setShowAddRewardForm(false);
                    }}
                  >
                    <Text style={styles.addRewardConfirmText}>{t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addRewardBtn} onPress={() => setShowAddRewardForm(true)} activeOpacity={0.8}>
                  <Text style={styles.addRewardBtnText}>{t('admin.add_reward')}</Text>
                </TouchableOpacity>
              )}

              {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}

              <TouchableOpacity style={[styles.saveBtn, savingHabit && styles.btnDisabled]} onPress={handleSaveEdit} disabled={savingHabit} activeOpacity={0.85}>
                {savingHabit ? <ActivityIndicator color={WHITE} /> : <Text style={styles.saveBtnText}>{t('admin.save_changes')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modal: editar miembro activo ────────────────────────────────── */}
      <Modal
        visible={editMemberVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setEditMemberVisible(false); setEditingMember(null); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.modalBackdrop} onPress={() => { setEditMemberVisible(false); setEditingMember(null); }}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t('admin.edit_member')}</Text>
              <View style={styles.modalDivider} />
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
                {/* Avatar editable */}
                <TouchableOpacity style={styles.memberAvatarContainer} onPress={handleMemberAvatarPress} activeOpacity={0.8}>
                  {editMemberAvatarUrl ? (
                    <Image source={{ uri: editMemberAvatarUrl }} style={styles.memberAvatarLarge} />
                  ) : (
                    <View style={[styles.memberAvatarLarge, styles.memberAvatarFallback]}>
                      <Text style={styles.memberAvatarInitialLarge}>
                        {(editMemberName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.memberAvatarCameraOverlay}>
                    <Ionicons name="camera" size={16} color={WHITE} />
                  </View>
                </TouchableOpacity>

                <Text style={styles.inputLabel}>{t('admin.member_name')}</Text>
                <TextInput
                  style={styles.input}
                  value={editMemberName}
                  onChangeText={setEditMemberName}
                  placeholder={t('admin.member_name')}
                  placeholderTextColor={GRAY}
                  autoCapitalize="words"
                  editable={!savingMember}
                />
                <Text style={styles.inputLabel}>{t('admin.member_email')}</Text>
                <TextInput
                  style={styles.input}
                  value={editMemberEmail}
                  onChangeText={setEditMemberEmail}
                  placeholder={t('admin.member_email')}
                  placeholderTextColor={GRAY}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!savingMember}
                />

                {/* Toggle de rol — solo si no es el usuario actual */}
                {editingMember && editingMember.id !== currentUserId ? (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.inputLabel}>{t('admin.role_label')}</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        onPress={() => setEditMemberRole('user')}
                        activeOpacity={0.8}
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 8,
                          alignItems: 'center',
                          backgroundColor: editMemberRole === 'user' ? BLUE : '#F0F0F0',
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: editMemberRole === 'user' ? WHITE : GRAY }}>
                          {t('admin.role_member')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setEditMemberRole('admin')}
                        activeOpacity={0.8}
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 8,
                          alignItems: 'center',
                          backgroundColor: editMemberRole === 'admin' ? BLUE : '#F0F0F0',
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: editMemberRole === 'admin' ? WHITE : GRAY }}>
                          {t('admin.role_admin')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {memberModalError ? <Text style={styles.modalErrorText}>{memberModalError}</Text> : null}

                <TouchableOpacity
                  style={[styles.saveBtn, savingMember && styles.btnDisabled]}
                  onPress={handleSaveMember}
                  disabled={savingMember}
                  activeOpacity={0.85}
                >
                  {savingMember ? <ActivityIndicator color={WHITE} /> : <Text style={styles.saveBtnText}>{t('common.save')}</Text>}
                </TouchableOpacity>

                {editingMember && editingMember.id !== currentUserId ? (
                  <>
                    <View style={{ height: 1, backgroundColor: '#F0F0F0', marginVertical: 16 }} />
                    <TouchableOpacity
                      onPress={handleDeleteMember}
                      activeOpacity={0.7}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <Text style={{ fontSize: 14, color: '#CC0000', fontWeight: '600' }}>
                        {t('admin.delete_member_title')}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: editar miembro pendiente ─────────────────────────────── */}
      <Modal
        visible={editPendingVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setEditPendingVisible(false); setEditingPending(null); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.modalBackdrop} onPress={() => { setEditPendingVisible(false); setEditingPending(null); }}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t('admin.pending_code_title')}</Text>
              <View style={styles.modalDivider} />
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
                {/* Código en grande */}
                <View style={[styles.codeBox, { marginBottom: 20 }]}>
                  <Text style={styles.codeText}>{editingPending?.code}</Text>
                </View>

                <Text style={styles.inputLabel}>{t('admin.member_name')}</Text>
                <TextInput
                  style={styles.input}
                  value={editPendingName}
                  onChangeText={setEditPendingName}
                  placeholder={t('admin.member_name')}
                  placeholderTextColor={GRAY}
                  autoCapitalize="words"
                  editable={!savingPending}
                />
                <Text style={styles.inputLabel}>{t('admin.member_email')}</Text>
                <TextInput
                  style={styles.input}
                  value={editPendingEmail}
                  onChangeText={setEditPendingEmail}
                  placeholder={t('admin.member_email')}
                  placeholderTextColor={GRAY}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!savingPending}
                />

                {pendingModalError ? <Text style={styles.modalErrorText}>{pendingModalError}</Text> : null}

                <TouchableOpacity
                  style={[styles.saveBtn, savingPending && styles.btnDisabled]}
                  onPress={handleSavePending}
                  disabled={savingPending}
                  activeOpacity={0.85}
                >
                  {savingPending ? <ActivityIndicator color={WHITE} /> : <Text style={styles.saveBtnText}>{t('admin.save_changes')}</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnSecondary, { marginTop: 10 }]}
                  onPress={async () => {
                    try {
                      await Share.share({ message: t('admin.share_activation', { group: companyName, code: editingPending?.code }) });
                    } catch {}
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnSecondaryText}>{t('admin.invite_share')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelInvitationBtn}
                  onPress={handleCancelInvitation}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelInvitationText}>{t('admin.cancel_invitation')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: nueva categoría ───────────────────────────────────────── */}
      <Modal
        visible={catModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCatModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCatModalVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('admin.new_category')}</Text>
            <View style={styles.modalDivider} />
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder={t('admin.category_name_placeholder')}
                placeholderTextColor={GRAY}
                maxLength={40}
                editable={!savingCat}
              />

              <Text style={styles.fieldLabel}>{t('admin.category_icon')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.iconPickerRow}>
                {CATEGORY_ICONS.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    style={[styles.iconOption, newCatIcon === icon && styles.iconOptionActive]}
                    onPress={() => setNewCatIcon(icon)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={icon} size={22} color={newCatIcon === icon ? BLUE : GRAY} />
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>{t('admin.category_color')}</Text>
              <View style={styles.colorPickerRow}>
                {CATEGORY_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[styles.colorOption, { backgroundColor: color }, newCatColor === color && styles.colorOptionActive]}
                    onPress={() => setNewCatColor(color)}
                    activeOpacity={0.7}
                  >
                    {newCatColor === color && <Ionicons name="checkmark" size={16} color={WHITE} />}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Preview */}
              <View style={styles.catPreviewRow}>
                <View style={[styles.catIconBadge, { backgroundColor: newCatColor + '26' }]}>
                  <Ionicons name={newCatIcon} size={16} color={newCatColor} />
                </View>
                <Text style={styles.catName}>{newCatName || '…'}</Text>
              </View>

              {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}

              <TouchableOpacity
                style={[styles.saveBtn, savingCat && styles.btnDisabled]}
                onPress={handleCreateCategory}
                disabled={savingCat}
                activeOpacity={0.85}
              >
                {savingCat ? <ActivityIndicator color={WHITE} /> : <Text style={styles.saveBtnText}>{t('admin.habit_save')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  listContent: { flexGrow: 1, paddingBottom: 32 },
  centered: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: TEXT, marginTop: 14, fontSize: 14 },
  errorBanner: { backgroundColor: '#fee2e2', paddingHorizontal: 16, paddingVertical: 12 },
  errorText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  section: { backgroundColor: WHITE, paddingHorizontal: 16, paddingVertical: 20 },
  sectionDivider: { height: 8, backgroundColor: BG },
  sectionHeader: {
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 4 },
  sectionHint: { fontSize: 13, color: GRAY, marginBottom: 16 },
  newHabitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BLUE,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 4,
  },
  newHabitBtnText: { color: WHITE, fontSize: 13, fontWeight: '700' },
  codeBox: { backgroundColor: BG, borderRadius: 8, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  codeText: { fontSize: 24, fontWeight: '700', color: TEXT, letterSpacing: 4 },
  inviteActions: { flexDirection: 'row', gap: 10 },
  btnPrimary: { flex: 1, backgroundColor: BLUE, borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  btnPrimaryText: { color: WHITE, fontSize: 14, fontWeight: '600' },
  btnSecondary: { flex: 1, backgroundColor: WHITE, borderRadius: 6, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: BLUE },
  btnDisabled: { opacity: 0.5 },
  btnSecondaryText: { color: BLUE, fontSize: 14, fontWeight: '600' },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16 },
  categoryHeaderText: { fontSize: 13, fontWeight: '700' },
  habitRow: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  habitRowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trashBtn: { padding: 4 },
  habitInfo: { flex: 1, gap: 3 },
  habitTitle: { fontSize: 14, fontWeight: '600', color: TEXT },
  habitMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  habitExpires: { fontSize: 12, color: GRAY },
  habitAssigned: { fontSize: 12, color: BLUE, fontWeight: '600' },
  habitValidators: { fontSize: 12, color: GRAY, fontWeight: '500' },
  separator: { height: 1, backgroundColor: '#E0E0E0', marginLeft: 16 },
  emptyRow: { backgroundColor: WHITE, padding: 20, alignItems: 'center' },
  emptyText: { color: GRAY, fontSize: 14, fontWeight: '600' },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: WHITE, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: TEXT, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  modalSubtitle: { fontSize: 13, color: GRAY, paddingHorizontal: 16, paddingBottom: 10 },
  modalDivider: { height: 1, backgroundColor: '#F0F0F0', marginHorizontal: 16 },
  modalScroll: { flexShrink: 1 },
  modalScrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: TEXT,
    backgroundColor: WHITE,
    marginBottom: 12,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pickerBtn: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: WHITE,
    justifyContent: 'center',
  },
  pickerBtnText: { fontSize: 14, color: TEXT },
  pickerBtnPlaceholder: { fontSize: 14, color: GRAY },
  pickerDoneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 4,
  },
  pickerDoneBtnText: { fontSize: 14, fontWeight: '700', color: BLUE },
  clearBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  clearBtnText: { fontSize: 12, color: GRAY, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: GRAY, marginBottom: 8, marginTop: 4 },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  weeklyTargetSelector: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 16 },
  weeklyTargetBtn: { width: 40, height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  weeklyTargetBtnText: { fontSize: 22, color: BLUE, fontWeight: '600', lineHeight: 26 },
  weeklyTargetValue: { fontSize: 28, fontWeight: '700', color: TEXT, minWidth: 32, textAlign: 'center' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: BG },
  pillActive: { backgroundColor: BLUE },
  pillText: { fontSize: 13, fontWeight: '600', color: TEXT },
  pillTextActive: { color: WHITE },
  memberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  memberName: { fontSize: 15, fontWeight: '500', color: TEXT },
  checkbox: { width: 24, height: 24, borderRadius: 4, borderWidth: 1.5, borderColor: '#D0D0D0', alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: BLUE, borderColor: BLUE },
  saveBtn: { marginTop: 20, minHeight: 48, borderRadius: 6, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: WHITE, fontSize: 15, fontWeight: '700' },
  modalErrorText: { marginTop: 12, color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  // Categories
  catGroupHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: WHITE },
  catGroupLabel: { fontSize: 11, fontWeight: '700', color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5 },
  categoryRow: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  catIconBadge: { width: 30, height: 30, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 14, fontWeight: '500', color: TEXT },
  catPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, marginVertical: 4 },
  catPillRow: { paddingVertical: 4, gap: 8, flexDirection: 'row', marginBottom: 12 },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#E0E0E0', backgroundColor: WHITE },
  catPillNoneActive: { borderColor: BLUE, backgroundColor: BLUE + '1A' },
  catPillText: { fontSize: 13, fontWeight: '600', color: GRAY },
  catPillTextActive: { color: BLUE },
  iconPickerRow: { gap: 6, paddingVertical: 4, marginBottom: 12 },
  iconOption: { width: 44, height: 44, borderRadius: 8, borderWidth: 1.5, borderColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' },
  iconOptionActive: { borderColor: BLUE, backgroundColor: BLUE + '1A' },
  colorPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  colorOption: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  colorOptionActive: { borderWidth: 3, borderColor: WHITE, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },
  photoRequiredRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 8 },
  photoRequiredInfo: { flex: 1, marginRight: 16 },
  photoRequiredDesc: { fontSize: 12, color: GRAY, marginTop: 2 },
  devResetBtn: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginTop: 8 },
  devResetText: { fontSize: 12, color: GRAY, fontWeight: '500' },
  // Member edit modal
  inputLabel: { fontSize: 13, fontWeight: '600', color: TEXT, marginBottom: 6 },
  memberAvatarContainer: { alignSelf: 'center', marginBottom: 20, position: 'relative' },
  memberAvatarLarge: { width: 80, height: 80, borderRadius: 40 },
  memberAvatarFallback: { backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  memberAvatarInitialLarge: { color: WHITE, fontWeight: '700', fontSize: 32 },
  memberAvatarCameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: BLUE,
    borderWidth: 2,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelInvitationBtn: { alignSelf: 'center', paddingVertical: 12, marginTop: 8 },
  cancelInvitationText: { color: '#CC0000', fontSize: 14, fontWeight: '600' },
  // Tab selector — estilo LinkedIn
  tabUnderlineRow: { flexDirection: 'row', backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  tabUnderlineItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabUnderlineText: { fontSize: 14, fontWeight: '500', color: GRAY },
  tabUnderlineTextActive: { color: TEXT, fontWeight: '700' },
  tabUnderlineIndicator: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: BLUE },
  // Family tab
  familyMemberRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, gap: 12 },
  familyAvatar: { width: 40, height: 40, borderRadius: 20 },
  familyAvatarFallback: { width: 40, height: 40, borderRadius: 20, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  familyAvatarInitial: { color: WHITE, fontWeight: '700', fontSize: 16 },
  familyInfo: { flex: 1 },
  familyMemberName: { fontSize: 14, fontWeight: '700', color: TEXT },
  familyMemberEmail: { fontSize: 12, color: GRAY, marginTop: 2 },
  familyRoleBadge: { backgroundColor: '#E8E8E8', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  familyRoleBadgeAdmin: { backgroundColor: BLUE + '1A' },
  familyRoleText: { fontSize: 11, fontWeight: '700', color: GRAY },
  familyRoleTextAdmin: { color: BLUE },
  familyStatusActive: { backgroundColor: '#F0FAF0', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  familyStatusActiveText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  familyStatusPending: { backgroundColor: '#FFF7ED', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  familyStatusPendingText: { fontSize: 11, fontWeight: '700', color: '#F97316' },
  familyWelcomeBox: { alignItems: 'center', padding: 32, gap: 12, backgroundColor: WHITE },
  familyWelcomeText: { fontSize: 15, color: GRAY, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
  // Rewards section
  rewardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#F9F9F9', borderRadius: 6, marginBottom: 6 },
  rewardText: { flex: 1, fontSize: 13, color: TEXT },
  rewardRemove: { fontSize: 20, color: GRAY, fontWeight: '600', paddingLeft: 12 },
  addRewardBtn: { paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 6, marginTop: 4 },
  addRewardBtnText: { fontSize: 13, color: BLUE, fontWeight: '600' },
  addRewardForm: { backgroundColor: '#F9F9F9', borderRadius: 6, padding: 12, marginTop: 4 },
  addRewardInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rewardDaysLabel: { fontSize: 13, color: GRAY },
  addRewardConfirmBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: BLUE, borderRadius: 6 },
  addRewardConfirmText: { color: WHITE, fontWeight: '600', fontSize: 13 },
});
