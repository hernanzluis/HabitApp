-- =============================================================================
-- Notificaciones push, etapa 3 (parte 1 de 2): piezas de base de datos que
-- usa la Edge Function push-events. Diseño: docs/push-etapa3-diseno.md.
-- Fecha: 2026-10-02. PENDIENTE de aprobación de Luis (no aplicado).
--
-- Crea:
--   extensión pg_net                       (la usará el trigger, parte 2)
--   secreto 'push_webhook_secret' en Vault (generado aquí, nadie lo ve)
--   push_webhook_secret_ok(secret)         la función comprueba la cabecera
--   push_recipients_for_validation(log)    a quién avisar de un log pendiente
--
-- Las dos funciones solo las ejecuta service_role (la Edge Function y los
-- tests). El trigger sobre habit_logs va aparte (2026-10-02b) y se aplica
-- después de probar la función llamándola directamente.
-- =============================================================================

begin;

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- 1. Secreto compartido trigger -> Edge Function. Se genera dentro de la base:
--    no pasa por el chat, ni por el repo, ni por la terminal.
-- -----------------------------------------------------------------------------
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'push_webhook_secret',
  'Cabecera x-webhook-secret del trigger de habit_logs hacia la Edge Function push-events'
);

-- -----------------------------------------------------------------------------
-- 2. La Edge Function comprueba aquí la cabecera recibida (el secreto no se
--    copia a los secretos de Edge Functions: vive solo en Vault).
-- -----------------------------------------------------------------------------
create function public.push_webhook_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_secret, '') <> ''
     and exists (select 1 from vault.decrypted_secrets
                  where name = 'push_webhook_secret' and decrypted_secret = p_secret);
$$;

-- -----------------------------------------------------------------------------
-- 3. Destinatarios del aviso "pendiente de validar". Misma regla que
--    ValidateHabitScreen:
--    - los validadores del hábito;
--    - si el hábito no tiene ningún validador, los admins de su empresa;
--    - nunca el autor del log, y siempre de la misma empresa que el hábito.
--    Si el log no existe o ya no está pendiente: ninguno.
-- -----------------------------------------------------------------------------
create function public.push_recipients_for_validation(p_log_id uuid)
returns table (recipient_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with l as (
    select hl.user_id as author_id, h.id as habit_id, h.company_id
      from habit_logs hl
      join habits h on h.id = hl.habit_id
     where hl.id = p_log_id and hl.status = 'pending'
  ),
  v as (
    select hv.user_id from l join habit_validators hv on hv.habit_id = l.habit_id
  )
  select p.id
    from l
    join profiles p on p.company_id = l.company_id
   where p.id <> l.author_id
     and (p.id in (select user_id from v)
          or (not exists (select 1 from v) and p.role = 'admin'));
$$;

revoke execute on function public.push_webhook_secret_ok(text) from public, anon, authenticated;
revoke execute on function public.push_recipients_for_validation(uuid) from public, anon, authenticated;
grant execute on function public.push_webhook_secret_ok(text) to service_role;
grant execute on function public.push_recipients_for_validation(uuid) to service_role;

commit;

-- Comprobación (solo lectura; no muestra el secreto)
select name, length(decrypted_secret) as len from vault.decrypted_secrets where name = 'push_webhook_secret';
select proname, has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('service_role', oid, 'execute') as service_exec
  from pg_proc where proname in ('push_webhook_secret_ok', 'push_recipients_for_validation');
select n.nspname, has_schema_privilege('anon', n.oid, 'usage') as anon_usage,
       has_schema_privilege('authenticated', n.oid, 'usage') as auth_usage
  from pg_namespace n where n.nspname = 'net';
