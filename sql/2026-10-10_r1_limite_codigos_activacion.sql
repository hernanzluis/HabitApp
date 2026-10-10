-- =============================================================================
-- R1: límite de intentos de check_activation_code que no se pueda esquivar.
-- Fecha: 2026-10-10. Aprobado por Luis. Sin begin/commit (scripts/sql-*.sh).
--
-- Problema (comprobado el 2026-10-09 con direcciones de documentación): la
-- función usaba la cabecera x-forwarded-for ENTERA como clave del límite por
-- IP. La pasarela de Supabase añade la IP real al final de lo que envía el
-- cliente ("<del cliente>,<IP real>"), así que variando la primera parte cada
-- intento contaba como una IP nueva. Con códigos de 6 cifras y la
-- confirmación de email desactivada, adivinar un código permitía ocupar una
-- invitación ajena.
--
-- Cambios:
--  1. IP = ÚLTIMO elemento de x-forwarded-for (el que pone la pasarela). Si
--     la cabecera falta o viene vacía, todos esos casos comparten la clave
--     'sin-ip' (y por tanto el mismo límite de 5 intentos / 15 min).
--  2. Tope GLOBAL: si en los últimos 10 minutos hay 30 o más intentos
--     fallidos (de cualquier IP), se bloquea la comprobación de códigos para
--     todos durante 5 minutos. Cada activación del tope deja una fila en
--     activation_lockouts (cuándo empezó, hasta cuándo y cuántos fallos):
--     rastro consultable. Mientras dura, los intentos no se registran (no
--     alarga el bloqueo).
--  3. activation_attempts.succeeded: el intento se marca como acertado si el
--     código es válido; el tope global solo cuenta los fallidos.
--  4. Limpieza global de intentos de más de 1 hora (antes solo los de la
--     propia IP, y los de otras IP se acumulaban).
--  5. Se vacía activation_attempts al aplicar: las filas antiguas tienen la
--     clave con el formato viejo (cadena entera) y nunca coincidirían con la
--     nueva; son solo estado de limitación de como mucho 1 hora. Comprobado
--     el 2026-10-10: la tabla estaba vacía.
-- Se mantienen la firma, el mensaje de bloqueo (los clientes lo traducen
-- igual) y el límite por código (capa 1). Códigos más largos: pendiente.
-- =============================================================================

alter table public.activation_attempts
  add column succeeded boolean not null default false;

create table public.activation_lockouts (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  until       timestamptz not null,
  failures    integer not null
);
alter table public.activation_lockouts enable row level security;  -- sin policies: solo service_role
revoke all on public.activation_lockouts from anon, authenticated;

delete from public.activation_attempts;

create or replace function public.check_activation_code(p_code text)
returns table(email text, full_name text, company_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row activation_codes%rowtype;
  v_ip text;
  v_ip_attempts integer;
  v_global_failures integer;
  v_attempt_id uuid;
begin
  -- ── Capa 3: tope global (bloqueo activo) ────────────────────
  if exists (select 1 from activation_lockouts where until > now()) then
    raise exception 'Código bloqueado temporalmente, inténtalo de nuevo en unos minutos';
  end if;

  -- ── Capa 2: límite por IP ──────────────────────────────────
  -- Último elemento de x-forwarded-for: el que añade la pasarela de Supabase.
  -- Lo anterior lo controla el cliente y no sirve como clave.
  v_ip := nullif(btrim(regexp_replace(
            coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            '^.*,', '')), '');
  v_ip := coalesce(v_ip, 'sin-ip');

  -- Limpieza: intentos de más de 1 hora, de cualquier IP.
  delete from activation_attempts where attempted_at < now() - interval '1 hour';

  select count(*) into v_ip_attempts
  from activation_attempts
  where ip_address = v_ip
    and attempted_at > now() - interval '15 minutes';

  if v_ip_attempts >= 5 then
    -- No se inserta intento nuevo: evita alargar la ventana de bloqueo
    -- indefinidamente mientras el atacante siga llamando.
    raise exception 'Código bloqueado temporalmente, inténtalo de nuevo en unos minutos';
  end if;

  insert into activation_attempts (ip_address) values (v_ip) returning id into v_attempt_id;

  -- ── Capa 1: límite por código concreto ─────────────────────
  select * into v_row
  from activation_codes
  where code = p_code
  for update;

  if found and (v_row.locked_until is null or v_row.locked_until <= now())
     and v_row.used = false and (v_row.expires_at is null or v_row.expires_at > now()) then
    -- Código válido: resetea cualquier bloqueo/contador previo y marca el
    -- intento como acertado (no cuenta para el tope global).
    update activation_codes
    set failed_attempts = 0,
        locked_until = null
    where id = v_row.id;
    update activation_attempts set succeeded = true where id = v_attempt_id;

    return query select v_row.email, v_row.full_name, v_row.company_id;
    return;
  end if;

  if found and v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'Código bloqueado temporalmente, inténtalo de nuevo en unos minutos';
  end if;

  if found then
    -- Código encontrado pero no válido ahora mismo (usado o expirado):
    -- cuenta como intento fallido contra ESTA fila.
    update activation_codes
    set failed_attempts = failed_attempts + 1,
        locked_until = case
          when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else locked_until
        end
    where id = v_row.id;
  end if;

  -- ── Capa 3: tope global (activación) ───────────────────────
  -- Intento fallido (código inexistente, usado o expirado).
  select count(*) into v_global_failures
  from activation_attempts
  where not succeeded and attempted_at > now() - interval '10 minutes';

  if v_global_failures >= 30 then
    insert into activation_lockouts (until, failures)
    values (now() + interval '5 minutes', v_global_failures);
  end if;

  return;
end;
$function$;

-- Comprobación (solo lectura)
select proname, has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec, proconfig
  from pg_proc where proname = 'check_activation_code';
select relname, relrowsecurity as rls,
       has_table_privilege('anon', oid, 'select') as anon_sel,
       has_table_privilege('authenticated', oid, 'select') as auth_sel
  from pg_class where relname in ('activation_attempts', 'activation_lockouts') and relnamespace = 'public'::regnamespace;
