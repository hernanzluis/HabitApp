-- =============================================================================
-- Corrección de sql/2026-09-28_registro_seguro.sql (ya aplicado).
-- Fecha: 2026-09-28 — encontrado por la Fase 5 (test-05-limites.js, test 3).
--
-- Fallo: handle_activation_registration comprobaba el cupo de IP ANTES de
-- mirar el código. check_activation_code (paso 1 del flujo) registra en
-- activation_attempts TODAS sus llamadas, también las buenas. Un usuario que
-- se equivoca 4 veces y acierta a la 5ª pasa el paso 1 (llega a 5 intentos)
-- y luego el alta le fallaba con "Código bloqueado" en el último paso — con
-- su auth.user ya creado por signUp y sin profile.
--
-- Arreglo: el cupo de IP solo se comprueba en la rama de FALLO. Un código
-- válido, sin usar, sin caducar, no bloqueado y emitido para el email del
-- usuario autenticado siempre se canjea; eso no es una señal de fuerza
-- bruta. Quien prueba códigos sigue limitado a 5 fallos cada 15 min por IP.
--
-- Solo cambia el cuerpo de la función (mismo tipo de retorno): CREATE OR
-- REPLACE conserva los permisos (EXECUTE solo para authenticated).
-- =============================================================================

create or replace function public.handle_activation_registration(
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

  select * into v_code
    from activation_codes c
   where c.code = handle_activation_registration.activation_code
   for update;
  v_exists := found;
  v_dead := v_exists and (v_code.used or (v_code.expires_at is not null and v_code.expires_at <= now()));

  -- Capa por código: solo un código muerto puede estar bloqueado.
  if v_exists and v_code.locked_until is not null and v_code.locked_until > now() then
    raise exception '%', v_lock_msg;
  end if;

  if not v_exists or v_dead or lower(btrim(v_code.email)) <> lower(btrim(v_email)) then
    -- Capa IP, solo en la rama de fallo (mismo origen de IP que check_activation_code).
    v_ip := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
    delete from activation_attempts
     where ip_address = v_ip and attempted_at < now() - interval '1 hour';
    select count(*) into v_recent
      from activation_attempts
     where ip_address = v_ip and attempted_at > now() - interval '15 minutes';
    if v_recent >= 5 then
      raise exception '%', v_lock_msg;
    end if;

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

  if not check_member_limit(v_code.company_id) then
    raise exception 'limit_members_reached';
  end if;

  update activation_codes
     set used = true, failed_attempts = 0, locked_until = null
   where id = v_code.id and used = false;
  if not found then
    raise exception 'code_already_used';
  end if;

  insert into profiles (id, email, full_name, company_id, role)
  values (v_uid, v_email, v_code.full_name, v_code.company_id, 'usuario');

  return 'ok';
end;
$$;

-- Comprobación (solo lectura): debe seguir anon_exec = false, auth_exec = true.
select proname,
       has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       proconfig
  from pg_proc
 where proname = 'handle_activation_registration';
