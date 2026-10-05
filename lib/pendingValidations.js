// Pendientes de validar del usuario con sesión: UNA sola regla para la lista
// de la pestaña Validar (ValidateHabitScreen) y para el número de su pestaña
// (RootNavigator, fetchPendingCount). Antes el contador no incluía el caso
// del admin con hábitos sin validadores ni filtraba por empresa, y podía no
// coincidir con la lista.
//
// Devuelve null si no hay sesión, o
//   { user, profile, explicitValidatorHabitIds, logs }
// donde logs son los habit_logs 'pending' de OTROS usuarios:
//   - de hábitos en los que el usuario es validador o, si es admin, de
//     hábitos de su empresa sin NINGÚN validador (regla de consulta: no se
//     inserta nada en habit_validators);
//   - de hábitos de su misma empresa;
//   - que el usuario aún no ha votado;
// cada uno con `habit` (id, title, description, company_id) y los recuentos
// validatedCount / rejectedCount / userValidated / userVote.
// explicitValidatorHabitIds: solo los de habit_validators (sin el caso admin),
// para el contador de caducados. Los errores de Supabase se lanzan.
import { supabase } from './supabase';

export async function fetchPendingValidations() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;

  const { data: validatorHabits, error: validatorError } = await supabase
    .from('habit_validators')
    .select('habit_id')
    .eq('user_id', user.id);
  if (validatorError) throw validatorError;
  const explicitValidatorHabitIds = (validatorHabits ?? []).map((v) => v.habit_id);
  const empty = { user, profile, explicitValidatorHabitIds, logs: [] };
  if (!profile?.company_id) return empty;

  let validatorHabitIds = explicitValidatorHabitIds;
  if (profile.role === 'admin') {
    const { data: companyHabits, error: companyHabitsError } = await supabase
      .from('habits')
      .select('id')
      .eq('company_id', profile.company_id);
    if (companyHabitsError) throw companyHabitsError;
    const companyHabitIds = (companyHabits ?? []).map((h) => h.id);

    if (companyHabitIds.length) {
      const { data: validatorsForCompanyHabits, error: validatorsForCompanyHabitsError } = await supabase
        .from('habit_validators')
        .select('habit_id')
        .in('habit_id', companyHabitIds);
      if (validatorsForCompanyHabitsError) throw validatorsForCompanyHabitsError;
      const habitsWithValidator = new Set((validatorsForCompanyHabits ?? []).map((v) => v.habit_id));
      const habitsWithoutValidator = companyHabitIds.filter((id) => !habitsWithValidator.has(id));
      validatorHabitIds = [...new Set([...validatorHabitIds, ...habitsWithoutValidator])];
    }
  }
  if (!validatorHabitIds.length) return empty;

  const { data: logsData, error: logsError } = await supabase
    .from('habit_logs')
    .select('id, habit_id, user_id, photo_url, status, notes, created_at')
    .eq('status', 'pending')
    .neq('user_id', user.id)
    .in('habit_id', validatorHabitIds)
    .order('created_at', { ascending: false });
  if (logsError) throw logsError;
  if (!logsData?.length) return empty;

  const habitIds = [...new Set(logsData.map((row) => row.habit_id).filter(Boolean))];
  const logIds = logsData.map((l) => l.id);
  const [
    { data: habitsData, error: habitsError },
    { data: validationsData, error: validationsError },
  ] = await Promise.all([
    supabase.from('habits').select('id, title, description, company_id').in('id', habitIds),
    supabase.from('habit_validations').select('habit_log_id, validator_id, status').in('habit_log_id', logIds),
  ]);
  if (habitsError) throw habitsError;
  if (validationsError) throw validationsError;

  const habitsMap = new Map((habitsData || []).map((h) => [h.id, h]));
  const validationsMap = {};
  (validationsData || []).forEach((v) => {
    if (!validationsMap[v.habit_log_id]) {
      validationsMap[v.habit_log_id] = { validatedCount: 0, rejectedCount: 0, userValidated: false, userVote: null };
    }
    if (v.status === 'validated') validationsMap[v.habit_log_id].validatedCount++;
    if (v.status === 'rejected') validationsMap[v.habit_log_id].rejectedCount++;
    if (v.validator_id === user.id) {
      validationsMap[v.habit_log_id].userValidated = true;
      validationsMap[v.habit_log_id].userVote = v.status;
    }
  });

  const logs = logsData
    .map((log) => ({
      ...log,
      habit: habitsMap.get(log.habit_id) || null,
      ...(validationsMap[log.id] || { validatedCount: 0, rejectedCount: 0, userValidated: false, userVote: null }),
    }))
    .filter((row) => row.habit && row.habit.company_id === profile.company_id)
    .filter((row) => !row.userValidated);

  return { user, profile, explicitValidatorHabitIds, logs };
}
