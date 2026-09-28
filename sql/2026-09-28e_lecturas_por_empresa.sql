-- =============================================================================
-- PROPUESTA — NO EJECUTADO. Policies SELECT por empresa.
-- Fecha: 2026-09-28. Informe: docs/security-inventory-2026-09-28.md (sección B).
--
-- Hoy se leen SIN SESIÓN (demostrado con datos zztest-): habits, habit_logs
-- (con photo_url y notes), habit_assignments, habit_validators, habit_rewards,
-- categories e invitations. Cualquier autenticado lee además habit_validations
-- y team_members de todas las empresas.
--
-- Revisadas todas las consultas de la app y de habitteam-web: ninguna necesita
-- filas de otra empresa (todas filtran por company_id propio o por ids que ya
-- salen de la propia empresa). Ver informe, sección B3.
--
-- Cambia a propósito un comportamiento cubierto por tests: Fase 4, test 5
-- ("un admin de A SÍ lee los habits de B") pasará a fallar → invertirlo en la
-- tarea de tests posterior (junto con la fase 9).
-- =============================================================================

begin;

-- Helpers SECURITY DEFINER: evitan RLS anidado (y su coste) en las tablas
-- hijas, y no exponen nada — solo responden true/false sobre la empresa propia.
create or replace function public.is_my_company_habit(p_habit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from habits h where h.id = p_habit_id and h.company_id = my_company_id());
$$;

create or replace function public.is_my_company_log(p_log_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from habit_logs hl join habits h on h.id = hl.habit_id
     where hl.id = p_log_id and h.company_id = my_company_id()
  );
$$;

revoke execute on function public.is_my_company_habit(uuid) from public, anon;
revoke execute on function public.is_my_company_log(uuid) from public, anon;
grant execute on function public.is_my_company_habit(uuid) to authenticated;
grant execute on function public.is_my_company_log(uuid) to authenticated;

-- habits
drop policy if exists "users can read company habits" on public.habits;
create policy "members read own company habits" on public.habits
  for select to authenticated using (company_id = my_company_id());

-- habit_logs
drop policy if exists "users can read habit logs" on public.habit_logs;
create policy "members read own company habit logs" on public.habit_logs
  for select to authenticated using (is_my_company_habit(habit_id));

-- habit_assignments
drop policy if exists "Select open" on public.habit_assignments;
create policy "members read own company assignments" on public.habit_assignments
  for select to authenticated using (is_my_company_habit(habit_id));

-- habit_validators
drop policy if exists "Select open" on public.habit_validators;
create policy "members read own company validators" on public.habit_validators
  for select to authenticated using (is_my_company_habit(habit_id));

-- habit_rewards
drop policy if exists "Select open" on public.habit_rewards;
create policy "members read own company rewards" on public.habit_rewards
  for select to authenticated using (is_my_company_habit(habit_id));

-- habit_validations
drop policy if exists "users can read validations" on public.habit_validations;
create policy "members read own company validations" on public.habit_validations
  for select to authenticated using (is_my_company_log(habit_log_id));

-- categories: predefinidas (company_id null) + las de la empresa propia
drop policy if exists "Select open" on public.categories;
create policy "members read system and own company categories" on public.categories
  for select to authenticated using (company_id is null or company_id = my_company_id());

-- invitations (tabla sin uso; su RPC se elimina en el fichero c)
drop policy if exists "anyone can read invitations" on public.invitations;
create policy "admins read own company invitations" on public.invitations
  for select to authenticated using (is_admin() and company_id = my_company_id());

-- team_members (sin uso activo)
drop policy if exists "users can read team members" on public.team_members;
create policy "members read own company team members" on public.team_members
  for select to authenticated using (
    exists (select 1 from teams tm where tm.id = team_members.team_id and tm.company_id = my_company_id())
  );

-- Policies SELECT ya acotadas por empresa, pero declaradas "to public":
-- se pasan a authenticated para que anon nunca llegue a evaluarlas.
alter policy "users can read own or company profiles" on public.profiles to authenticated;
alter policy "users can read own company" on public.companies to authenticated;
alter policy "admins can read own company activation codes" on public.activation_codes to authenticated;

-- plan_limits: sin cambios. RLS activado sin policies → solo legible vía
-- get_company_plan_info/check_* (SECURITY DEFINER). Ningún cliente la lee directo.

commit;

-- Comprobación (solo lectura): ninguna policy SELECT con qual = 'true' ni para anon.
select tablename, policyname, roles, qual
  from pg_policies
 where schemaname = 'public' and cmd = 'SELECT'
 order by tablename;
