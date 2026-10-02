-- =============================================================================
-- Notificaciones push, etapa 3 (parte 2 de 2): el trigger que avisa a la
-- Edge Function push-events cuando se crea un log pendiente de validar.
-- Diseño: docs/push-etapa3-diseno.md (sección 2).
-- Fecha: 2026-10-02. PENDIENTE de aprobación de Luis (no aplicado). Requiere
-- 2026-10-02_push_events.sql aplicado y la función desplegada y probada.
--
-- - Solo INSERT con status = 'pending' (nada actualiza habit_logs después).
-- - net.http_post es asíncrono: la petición sale tras el commit y el INSERT
--   del log nunca espera ni falla por ella. Cualquier error del propio
--   trigger se convierte en WARNING para no bloquear el registro del hábito.
-- - El secreto se lee de Vault en cada disparo; no queda en la definición.
-- =============================================================================

begin;

create function public.notify_push_validation_pending()
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
    body := jsonb_build_object('type', 'validation_pending', 'log_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'push: no se pudo encolar el aviso del log %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke execute on function public.notify_push_validation_pending() from public, anon, authenticated;

create trigger habit_logs_push_validation_pending
  after insert on public.habit_logs
  for each row
  when (new.status = 'pending')
  execute function public.notify_push_validation_pending();

commit;

-- Comprobación (solo lectura)
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.habit_logs'::regclass and not tgisinternal;
