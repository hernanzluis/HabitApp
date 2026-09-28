-- =============================================================================
-- Registro seguro: handle_new_user_registration + handle_activation_registration
-- Fecha: 2026-09-28 — ver tests/README.md (hallazgo "RPCs de alta ejecutables
-- sin sesión") y tests/test-08-registro-seguro.js.
--
-- PRECONDICIÓN: "Confirm email" DESACTIVADO en Authentication → Providers →
-- Email. Con la confirmación activada, auth.signUp no devuelve sesión y la
-- app llamaría a estas RPCs sin auth.uid() → todas las altas fallarían con
-- 'not_authenticated'.
--
-- Todo va en una única transacción: si cualquier sentencia falla, no se
-- aplica nada. El bloque final (sección 5) es solo lectura.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Borrar TODAS las sobrecargas existentes de las dos funciones.
--    Se hace DROP + CREATE (no CREATE OR REPLACE) porque el tipo de retorno
--    de handle_activation_registration cambia a text (ver sección 2), y
--    porque así no puede quedar una sobrecarga antigua viva si el orden de
--    parámetros real no coincidiera con el documentado.
-- -----------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('handle_new_user_registration', 'handle_activation_registration')
  loop
    raise notice 'drop function %', f;
    execute format('drop function %s', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. handle_new_user_registration
--    Mismos parámetros que antes (la app no cambia su llamada).
--    - user_id debe ser el usuario autenticado.
--    - user_email se mantiene por compatibilidad, pero la fuente de verdad es
--      auth.users; si no coincide, se rechaza.
-- -----------------------------------------------------------------------------
create function public.handle_new_user_registration(
  user_id uuid,
  user_email text,
  user_full_name text,
  company_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text := btrim(coalesce(user_full_name, ''));
  v_company_name text := btrim(coalesce(company_name, ''));
  v_company_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if user_id is distinct from v_uid then
    raise exception 'user_id_mismatch';
  end if;
  if exists (select 1 from profiles p where p.id = v_uid) then
    raise exception 'profile_already_exists';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'auth_user_not_found';
  end if;
  if user_email is not null and lower(btrim(user_email)) <> lower(btrim(v_email)) then
    raise exception 'email_mismatch';
  end if;

  if v_full_name = '' or length(v_full_name) > 100 then
    raise exception 'invalid_full_name';
  end if;
  if v_company_name = '' or length(v_company_name) > 100 then
    raise exception 'invalid_company_name';
  end if;

  insert into companies (name, admin_id) values (v_company_name, v_uid) returning id into v_company_id;

  insert into profiles (id, email, full_name, company_id, role)
  values (v_uid, v_email, v_full_name, v_company_id, 'admin');
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. handle_activation_registration
--    Devuelve text: 'ok' o 'invalid_code'.
--
--    Por qué un código inválido DEVUELVE en vez de lanzar excepción: un
--    RAISE deshace toda la transacción, incluido el INSERT en
--    activation_attempts y el failed_attempts += 1. Si se lanzara, las
--    llamadas fallidas no contarían nunca para el rate limiting, que es
--    justo el agujero que se quiere cerrar. check_activation_code hace lo
--    mismo por la misma razón: devuelve vacío en vez de lanzar.
--
--    Rate limiting — las mismas dos capas que check_activation_code
--    (docs/database.md), compartiendo la tabla activation_attempts:
--    - Capa IP: cuenta SOLO los intentos fallidos de esta RPC (una
--      activación legítima no gasta cupo aquí; check_activation_code ya
--      gasta uno en el paso previo). ≥5 en 15 min → bloqueo.
--    - Capa por código: un código existente pero usado/expirado suma
--      failed_attempts; a los 5 se bloquea 15 min. Un código válido con un
--      email que no coincide NO suma aquí (si no, cualquiera podría bloquear
--      el código vigente de otra familia), solo en la capa IP.
--
--    Además, el código queda ligado al email: solo lo puede canjear el
--    usuario autenticado cuyo email en auth.users coincide con el que puso
--    el admin al generarlo (sin distinguir mayúsculas ni espacios de los
--    extremos: el admin puede haberlo tecleado como "Ana@Gmail.com ").
-- -----------------------------------------------------------------------------
create function public.handle_activation_registration(
  user_id uuid,
  user_email text,
  user_full_name text,
  activation_code text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_ip text;
  v_recent int;
  v_code activation_codes%rowtype;
  v_exists boolean;
  v_dead boolean;
  v_lock_msg constant text := 'Código bloqueado temporalmente, inténtalo de nuevo en unos minutos';
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if user_id is distinct from v_uid then
    raise exception 'user_id_mismatch';
  end if;
  if exists (select 1 from profiles p where p.id = v_uid) then
    raise exception 'profile_already_exists';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'auth_user_not_found';
  end if;
  if user_email is not null and lower(btrim(user_email)) <> lower(btrim(v_email)) then
    raise exception 'email_mismatch';
  end if;

  -- Capa IP (mismo origen de IP que check_activation_code).
  v_ip := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  delete from activation_attempts
   where ip_address = v_ip and attempted_at < now() - interval '1 hour';
  select count(*) into v_recent
    from activation_attempts
   where ip_address = v_ip and attempted_at > now() - interval '15 minutes';
  if v_recent >= 5 then
    raise exception '%', v_lock_msg;
  end if;

  select * into v_code
    from activation_codes c
   where c.code = handle_activation_registration.activation_code
   for update;
  v_exists := found;
  v_dead := v_exists and (v_code.used or (v_code.expires_at is not null and v_code.expires_at <= now()));

  if v_exists and v_code.locked_until is not null and v_code.locked_until > now() then
    raise exception '%', v_lock_msg;
  end if;

  if not v_exists or v_dead or lower(btrim(v_code.email)) <> lower(btrim(v_email)) then

    insert into activation_attempts (ip_address) values (v_ip);

    if v_dead then
      update activation_codes
         set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 5
                                 then now() + interval '15 minutes'
                                 else locked_until end
       where id = v_code.id;
    end if;

    return 'invalid_code';
  end if;

  -- Backstop server-side del límite de miembros (lanza → se deshace todo,
  -- el código sigue sin usar, que es lo correcto).
  if not check_member_limit(v_code.company_id) then
    raise exception 'limit_members_reached';
  end if;

  -- Marcado atómico: la fila está bloqueada (FOR UPDATE) desde el SELECT,
  -- así que dos canjes simultáneos del mismo código se serializan y el
  -- segundo ve used = true.
  update activation_codes
     set used = true, failed_attempts = 0, locked_until = null
   where id = v_code.id and used = false;
  if not found then
    raise exception 'code_already_used';
  end if;

  -- full_name sale del código (lo fijó el admin), no del parámetro del
  -- cliente; el parámetro se mantiene solo por compatibilidad de firma.
  insert into profiles (id, email, full_name, company_id, role)
  values (v_uid, v_email, v_code.full_name, v_code.company_id, 'usuario');

  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Permisos. En Supabase las funciones nuevas de public reciben EXECUTE
--    explícito para anon/authenticated/service_role por default privileges,
--    así que no basta con revocar de PUBLIC.
-- -----------------------------------------------------------------------------
revoke execute on function public.handle_new_user_registration(uuid, text, text, text) from public, anon;
revoke execute on function public.handle_activation_registration(uuid, text, text, text) from public, anon;
grant execute on function public.handle_new_user_registration(uuid, text, text, text) to authenticated;
grant execute on function public.handle_activation_registration(uuid, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Policy UPDATE de activation_codes para "el usuario recién registrado
--    marca su código como usado" (USING auth.uid() IS NOT NULL AND
--    used = false, WITH CHECK used = true). Ya no hace falta: el marcado se
--    hace dentro de la RPC. Y es un agujero en sí misma: cualquier
--    autenticado puede quemar los códigos pendientes de CUALQUIER empresa.
--    Se localiza por su contenido (no se conoce el nombre exacto) y se exige
--    que haya exactamente una; si no, se aborta toda la transacción.
-- -----------------------------------------------------------------------------
do $$
declare
  v_names text[];
begin
  select array_agg(policyname) into v_names
    from pg_policies
   where schemaname = 'public'
     and tablename = 'activation_codes'
     and cmd = 'UPDATE'
     and qual not ilike '%is_admin%';

  if coalesce(array_length(v_names, 1), 0) <> 1 then
    raise exception 'Se esperaba exactamente 1 policy UPDATE no-admin en activation_codes, hay: %', v_names;
  end if;

  raise notice 'drop policy "%" on activation_codes', v_names[1];
  execute format('drop policy %I on public.activation_codes', v_names[1]);
end;
$$;

commit;

-- -----------------------------------------------------------------------------
-- 5. SOLO LECTURA — pegar el resultado a Code.
--    Todas las funciones de public con su modo de seguridad, search_path y
--    quién puede ejecutarlas. No modifica nada.
-- -----------------------------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.prosecdef desc, anon_exec desc, p.proname;
