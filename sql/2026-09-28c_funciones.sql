-- =============================================================================
-- APLICADO el 2026-09-28 con aprobación expresa de Luis (verificado en el catálogo). Funciones expuestas por la API.
-- Fecha: 2026-09-28. Informe: docs/security-inventory-2026-09-28.md (sección A).
-- Aplicado en su propia transacción, tras copia de seguridad y ensayo con ROLLBACK.
--
-- Orden recomendado de aplicación: este fichero (c) → d → e → f → g.
-- Todo en una transacción: si algo falla, no se aplica nada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A1. handle_invited_user_registration: discontinuada, sin llamadas en la app
--     ni en la web, sin ninguna comprobación (ni auth.uid() ni email) y
--     ejecutable por anon. Con una fila en invitations (legible por anon) crea
--     un profile en cualquier empresa. Se elimina.
-- -----------------------------------------------------------------------------
drop function if exists public.handle_invited_user_registration(uuid, text, text, text);

-- -----------------------------------------------------------------------------
-- A2. Consultas de plan: solo sobre la empresa propia.
--     check_member_limit se llama también desde handle_activation_registration
--     cuando el usuario aún NO tiene profile (my_company_id() es null): en ese
--     caso se permite, para no romper la activación.
-- -----------------------------------------------------------------------------
create or replace function public.check_habit_limit(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_count int;
begin
  if p_company_id is distinct from my_company_id() then
    raise exception 'forbidden';
  end if;

  select pl.max_active_habits into v_max
    from companies c join plan_limits pl on pl.plan = c.plan
   where c.id = p_company_id;
  if v_max is null then
    return true;
  end if;

  select count(*) into v_count from habits where company_id = p_company_id and is_active = true;
  return v_count < v_max;
end;
$$;

create or replace function public.check_member_limit(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_count int;
  v_mine uuid := my_company_id();
begin
  if v_mine is not null and p_company_id is distinct from v_mine then
    raise exception 'forbidden';
  end if;

  select pl.max_members into v_max
    from companies c join plan_limits pl on pl.plan = c.plan
   where c.id = p_company_id;
  if v_max is null then
    return true;
  end if;

  select count(*) into v_count from profiles where company_id = p_company_id;
  return v_count < v_max;
end;
$$;

create or replace function public.get_company_plan_info(p_company_id uuid)
returns table(plan text, history_days integer, advanced_stats boolean, max_members integer, max_active_habits integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.plan, pl.history_days, pl.advanced_stats, pl.max_members, pl.max_active_habits
    from companies c join plan_limits pl on pl.plan = c.plan
   where c.id = p_company_id
     and c.id = my_company_id();
$$;

-- -----------------------------------------------------------------------------
-- A3. delete_member: un admin no puede borrarse a sí mismo por este camino
--     (se saltaría la regla de "único admin" de delete_own_account).
--     Resto del cuerpo idéntico al actual.
-- -----------------------------------------------------------------------------
create or replace function public.delete_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if member_id = auth.uid() then
    raise exception 'use_delete_own_account';
  end if;

  select company_id into v_company_id from profiles where id = auth.uid();

  if not exists (
    select 1 from profiles
     where id = auth.uid() and role = 'admin' and company_id = v_company_id
  ) then
    raise exception 'No tienes permisos para eliminar este miembro';
  end if;

  if not exists (
    select 1 from profiles where id = member_id and company_id = v_company_id
  ) then
    raise exception 'El miembro no pertenece a tu grupo';
  end if;

  delete from profiles where id = member_id;
  delete from auth.users where id = member_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- A4. update_member_profile (hoy SIN llamadas en app ni web: AdminScreen y
--     Members.jsx hacen UPDATE directo sobre profiles). Se endurece igualmente:
--     new_role validado; el email ya no se acepta del cliente — lo fija el
--     trigger de sincronización con Auth (A6). El parámetro new_email se
--     mantiene por compatibilidad de firma y se ignora.
-- -----------------------------------------------------------------------------
create or replace function public.update_member_profile(member_id uuid, new_full_name text, new_email text, new_role text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from profiles admin_p
      join profiles member_p on member_p.id = update_member_profile.member_id
     where admin_p.id = auth.uid()
       and admin_p.role = 'admin'
       and admin_p.company_id = member_p.company_id
  ) then
    raise exception 'No tienes permisos para actualizar este perfil';
  end if;

  if new_role is not null and new_role not in ('admin', 'usuario') then
    raise exception 'invalid_role';
  end if;
  if btrim(coalesce(new_full_name, '')) = '' or length(btrim(new_full_name)) > 100 then
    raise exception 'invalid_full_name';
  end if;

  update profiles
     set full_name = btrim(new_full_name),
         role = coalesce(new_role, role)
   where id = update_member_profile.member_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- A5. update_member_avatar: solo URLs del bucket avatars y de la carpeta del
--     propio miembro (la que genera AdminScreen: <member_id>/avatar.jpg).
--     Además, el CHECK de A6 cubre también el UPDATE directo del propio
--     usuario ("users can update own profile").
-- -----------------------------------------------------------------------------
create or replace function public.update_member_avatar(member_id uuid, new_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from profiles admin_p
      join profiles member_p on member_p.id = update_member_avatar.member_id
     where admin_p.id = auth.uid()
       and admin_p.role = 'admin'
       and admin_p.company_id = member_p.company_id
  ) then
    raise exception 'No tienes permisos para actualizar este perfil';
  end if;

  if new_avatar_url is not null and new_avatar_url !~ (
       '^https://uvsngemnftpysjvxslhu\.supabase\.co/storage/v1/object/public/avatars/'
       || update_member_avatar.member_id::text || '/[^/?#]+(\?[^#]*)?$') then
    raise exception 'invalid_avatar_url';
  end if;

  update profiles set avatar_url = new_avatar_url where id = update_member_avatar.member_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- A6. Integridad de profiles, válida para TODOS los caminos (RPC y UPDATE
--     directo desde AdminScreen/Members.jsx):
--     - role solo 'admin' | 'usuario' (datos actuales: 1 fila, 'admin').
--     - avatar_url null o dentro de avatars/<id>/ (datos actuales: 1 fila, null).
--     - email siempre = email de auth.users (datos actuales: 0 desincronizados).
--       Consecuencia: el campo "email" del modal de editar miembro en
--       AdminScreen.js (updatePayload.email) deja de tener efecto → hay que
--       quitarlo de la UI (ver informe, sección B3).
-- -----------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'usuario'));

alter table public.profiles
  add constraint profiles_avatar_url_check check (
    avatar_url is null
    or avatar_url ~ ('^https://uvsngemnftpysjvxslhu\.supabase\.co/storage/v1/object/public/avatars/' || id::text || '/[^/?#]+(\?[^#]*)?$')
  );

create or replace function public.profiles_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.id;
  if v_email is not null then
    new.email := v_email;
  end if;
  return new;
end;
$$;

create trigger profiles_email_from_auth
  before insert or update of email on public.profiles
  for each row execute function public.profiles_email_from_auth();

-- Sentido contrario: si el email cambia en Auth (updateUser), se refleja en profiles.
create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email_from_auth();

-- -----------------------------------------------------------------------------
-- A7. search_path en las funciones que no lo tenían y no se han redefinido
--     arriba (delete_expired_habit), y endurecido con pg_temp en el resto.
-- -----------------------------------------------------------------------------
alter function public.delete_expired_habit(uuid) set search_path = public, pg_temp;
alter function public.check_activation_code(text) set search_path = public, pg_temp;
alter function public.delete_own_account() set search_path = public, pg_temp;
alter function public.is_admin() set search_path = public, pg_temp;
alter function public.my_company_id() set search_path = public, pg_temp;
alter function public.prevent_self_role_company_escalation() set search_path = public, pg_temp;

-- -----------------------------------------------------------------------------
-- A8. EXECUTE: nadie sin sesión, salvo check_activation_code (paso 1 del alta
--     con código, antes de signUp). is_admin()/my_company_id() se usan en
--     policies; tras el fichero e todas las SELECT son "to authenticated", así que anon
--     no las evalúa al leer. En escrituras anon recibirá "permission denied"
--     en vez de un rechazo de RLS — mismo resultado.
--     Las funciones de trigger no necesitan EXECUTE para dispararse.
-- -----------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname <> 'check_activation_code'
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke execute on function public.check_activation_code(text) from public;
grant execute on function public.check_activation_code(text) to anon, authenticated;

-- Funciones internas que ningún cliente debe llamar directamente.
revoke execute on function public.profiles_email_from_auth() from authenticated;
revoke execute on function public.sync_profile_email_from_auth() from authenticated;
revoke execute on function public.prevent_self_role_company_escalation() from authenticated;

-- Funciones futuras: sin EXECUTE para anon por defecto.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

commit;

-- Comprobación (solo lectura): solo check_activation_code con anon_exec = true.
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
 order by anon_exec desc, p.proname;
