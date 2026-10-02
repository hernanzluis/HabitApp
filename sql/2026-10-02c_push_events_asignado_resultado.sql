-- =============================================================================
-- Notificaciones push, etapa 3 (continuación): avisos "hábito asignado" y
-- "resultado de la validación". Diseño: docs/push-etapa3b-diseno.md.
-- Fecha: 2026-10-02. Aprobado el diseño por Luis (relleno incluido, un solo
-- fichero). Primer fichero con la salvaguarda nueva: SIN begin/commit; se
-- ensaya con scripts/sql-ensayo.sh y se aplica con scripts/sql-aplica.sh.
--
-- Crea:
--   push_recipients_for_assignment(assignment, actor)   destinatario del aviso
--   push_validation_result_for_log(log)                 autor + recuentos + ready
--   notify_push_habit_assigned()   + trigger habit_assignments_push_assigned
--   notify_push_validation_result() + trigger habit_validations_push_result
--   relleno de notification_log para las asignaciones existentes (sin envío)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. "Hábito asignado": el asignado, si el hábito está activo, es de su
--    empresa y no es quien hizo la asignación (p_actor_id; null = desde SQL).
-- -----------------------------------------------------------------------------
create function public.push_recipients_for_assignment(p_assignment_id uuid, p_actor_id uuid)
returns table (recipient_id uuid, habit_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ha.user_id, ha.habit_id
    from habit_assignments ha
    join habits h on h.id = ha.habit_id
    join profiles p on p.id = ha.user_id
   where ha.id = p_assignment_id
     and h.is_active
     and p.company_id = h.company_id
     and ha.user_id is distinct from p_actor_id;
$$;

-- -----------------------------------------------------------------------------
-- 2. "Resultado de la validación": el autor del log, con los recuentos de
--    votos y si ya han votado todos los votantes esperados (los mismos
--    destinatarios que "pendiente de validar": validadores, o admins si no
--    hay ninguno, sin el autor y de la misma empresa). Una fila como máximo;
--    ninguna si el log no existe o el autor no es de la empresa del hábito.
-- -----------------------------------------------------------------------------
create function public.push_validation_result_for_log(p_log_id uuid)
returns table (recipient_id uuid, habit_id uuid, validated_count int, rejected_count int, ready boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with l as (
    select hl.id, hl.user_id, hl.habit_id
      from habit_logs hl
      join habits h on h.id = hl.habit_id
      join profiles p on p.id = hl.user_id
     where hl.id = p_log_id and p.company_id = h.company_id
  ),
  expected as (
    select r.recipient_id from push_recipients_for_validation(p_log_id) r
  ),
  votes as (
    select hv.validator_id, hv.status
      from habit_validations hv join l on hv.habit_log_id = l.id
  )
  select l.user_id,
         l.habit_id,
         (select count(*) from votes where status = 'validated')::int,
         (select count(*) from votes where status = 'rejected')::int,
         exists (select 1 from expected)
           and not exists (select 1 from expected e
                            where not exists (select 1 from votes v where v.validator_id = e.recipient_id))
    from l;
$$;

revoke execute on function public.push_recipients_for_assignment(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.push_validation_result_for_log(uuid) from public, anon, authenticated;
grant execute on function public.push_recipients_for_assignment(uuid, uuid) to service_role;
grant execute on function public.push_validation_result_for_log(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Triggers: mismo patrón que notify_push_validation_pending(). Asíncronos
--    (pg_net, tras el commit); cualquier error propio pasa a WARNING para no
--    bloquear la escritura.
-- -----------------------------------------------------------------------------
create function public.notify_push_habit_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_webhook_secret';
  if v_secret is null then
    raise warning 'push: falta push_webhook_secret en Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://uvsngemnftpysjvxslhu.supabase.co/functions/v1/push-events',
    body := jsonb_build_object('type', 'habit_assigned', 'assignment_id', new.id, 'actor_id', auth.uid()),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'push: no se pudo encolar el aviso de la asignación %: %', new.id, sqlerrm;
  return new;
end;
$$;

create function public.notify_push_validation_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_webhook_secret';
  if v_secret is null then
    raise warning 'push: falta push_webhook_secret en Vault';
    return new;
  end if;

  perform net.http_post(
    url := 'https://uvsngemnftpysjvxslhu.supabase.co/functions/v1/push-events',
    body := jsonb_build_object('type', 'validation_result', 'log_id', new.habit_log_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'push: no se pudo encolar el resultado del log %: %', new.habit_log_id, sqlerrm;
  return new;
end;
$$;

revoke execute on function public.notify_push_habit_assigned() from public, anon, authenticated;
revoke execute on function public.notify_push_validation_result() from public, anon, authenticated;

create trigger habit_assignments_push_assigned
  after insert on public.habit_assignments
  for each row
  execute function public.notify_push_habit_assigned();

create trigger habit_validations_push_result
  after insert on public.habit_validations
  for each row
  execute function public.notify_push_validation_result();

-- -----------------------------------------------------------------------------
-- 4. Relleno: las asignaciones existentes cuentan como ya avisadas, para que
--    la primera edición de esos hábitos (que borra y reinserta asignaciones)
--    no avise como si fueran nuevas. No se envía nada. Va después de crear el
--    trigger y en la misma transacción: una asignación que entre a la vez
--    queda cubierta por una de las dos vías.
-- -----------------------------------------------------------------------------
insert into notification_log (type, recipient_id, habit_id, title, body, data)
select 'habit_assigned', ha.user_id, ha.habit_id,
       '(relleno)', 'Asignación anterior a los avisos push; no se envió nada',
       jsonb_build_object('backfill', true)
  from habit_assignments ha
  join auth.users u on u.id = ha.user_id
on conflict do nothing;

-- Comprobación (solo lectura)
select proname, has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('service_role', oid, 'execute') as service_exec
  from pg_proc
 where proname in ('push_recipients_for_assignment', 'push_validation_result_for_log',
                   'notify_push_habit_assigned', 'notify_push_validation_result')
 order by 1;
select tgrelid::regclass as tabla, tgname, pg_get_triggerdef(oid) as def
  from pg_trigger
 where tgname in ('habit_assignments_push_assigned', 'habit_validations_push_result');
select count(*) as relleno from notification_log where type = 'habit_assigned' and data ? 'backfill';
