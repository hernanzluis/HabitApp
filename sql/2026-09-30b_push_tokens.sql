-- =============================================================================
-- Notificaciones push, etapa 1: almacenamiento.
-- Fecha: 2026-09-30. Plan: docs/push-notifications-plan.md (secciones 3 y 7).
-- Aprobado por Luis en el chat y APLICADO el 2026-09-30 (ensayo previo con ROLLBACK,
-- copia del esquema en ~/habitapp-backups/2026-09-30-pre-push-tokens/).
--
-- Crea:
--   push_tokens        un token de Expo por dispositivo (ExponentPushToken[...])
--   notification_log   un aviso lógico por destinatario (deduplicación)
--   push_deliveries    un envío por token (ticket y receipt de Expo)
--   register_push_token(token, platform, locale, time_zone)   RPC de alta
--   unregister_push_token(token)                             RPC de baja
--
-- Ninguna tabla se puede escribir directamente desde un cliente: el alta y
-- la baja de tokens pasan por las RPCs, y los dos registros de envío solo
-- los tocan las Edge Functions (Service Role Key). anon: nada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. push_tokens
-- -----------------------------------------------------------------------------
create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token        text not null unique
               check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'),
  platform     text not null check (platform in ('ios', 'android')),
  locale       text not null default 'es' check (locale in ('es', 'en')),
  time_zone    text not null default 'Europe/Madrid',
  enabled      boolean not null default true,       -- false tras DeviceNotRegistered
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_enabled_idx on public.push_tokens (user_id) where enabled;

alter table public.push_tokens enable row level security;

-- Cada usuario ve y borra solo sus tokens. Sin policies de INSERT/UPDATE:
-- el alta pasa por register_push_token (SECURITY DEFINER), que puede
-- reasignar un token de un usuario a otro (misma app, cambio de cuenta).
create policy "users read own push tokens" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "users delete own push tokens" on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.push_tokens from anon;
revoke insert, update, truncate, references, trigger on public.push_tokens from authenticated;

-- -----------------------------------------------------------------------------
-- 2. notification_log — un aviso lógico por destinatario
--    Los índices únicos parciales son la deduplicación del plan:
--    - habit_assigned:     un aviso por (asignado, hábito) — aunque al editar
--                          el hábito se borren y reinserten las asignaciones.
--    - validation_pending: un aviso por (validador, log).
--    - validation_result:  un único aviso resumido por log (decisión de Luis).
--    - daily_reminder:     uno por usuario y día local.
-- -----------------------------------------------------------------------------
create table public.notification_log (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('habit_assigned', 'validation_pending', 'validation_result', 'daily_reminder')),
  recipient_id  uuid not null references auth.users (id) on delete cascade,
  habit_id      uuid references public.habits (id) on delete cascade,
  log_id        uuid references public.habit_logs (id) on delete cascade,
  local_date    date,
  title         text not null,
  body          text not null,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint notification_log_shape check (
    (type = 'habit_assigned'     and habit_id is not null) or
    (type = 'validation_pending' and log_id is not null) or
    (type = 'validation_result'  and log_id is not null) or
    (type = 'daily_reminder'     and local_date is not null)
  )
);
create unique index notification_log_assigned_uniq on public.notification_log (recipient_id, habit_id) where type = 'habit_assigned';
create unique index notification_log_pending_uniq  on public.notification_log (recipient_id, log_id)   where type = 'validation_pending';
create unique index notification_log_result_uniq   on public.notification_log (log_id)                 where type = 'validation_result';
create unique index notification_log_reminder_uniq on public.notification_log (recipient_id, local_date) where type = 'daily_reminder';

alter table public.notification_log enable row level security;  -- sin policies: solo Service Role
revoke all on public.notification_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. push_deliveries — un envío por token (ticket y receipt de Expo)
-- -----------------------------------------------------------------------------
create table public.push_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  notification_id    uuid not null references public.notification_log (id) on delete cascade,
  push_token_id      uuid references public.push_tokens (id) on delete set null,
  ticket_id          text,
  status             text not null default 'queued'
                     check (status in ('queued', 'ticket_ok', 'ticket_error', 'receipt_ok', 'receipt_error')),
  error              text,
  created_at         timestamptz not null default now(),
  receipt_checked_at timestamptz
);
create index push_deliveries_pending_receipts_idx on public.push_deliveries (created_at) where status = 'ticket_ok';

alter table public.push_deliveries enable row level security;  -- sin policies: solo Service Role
revoke all on public.push_deliveries from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPC de alta: upsert por token, asignado al usuario autenticado
-- -----------------------------------------------------------------------------
create function public.register_push_token(p_token text, p_platform text, p_locale text, p_time_zone text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$' then
    raise exception 'invalid_push_token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid_platform';
  end if;
  if p_locale is null or p_locale not in ('es', 'en') then
    raise exception 'invalid_locale';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;
  -- Tope defensivo: 10 dispositivos activos por usuario (sin contar este token).
  if (select count(*) from push_tokens where user_id = v_uid and enabled and token <> p_token) >= 10 then
    raise exception 'too_many_push_tokens';
  end if;

  insert into push_tokens (user_id, token, platform, locale, time_zone)
  values (v_uid, p_token, p_platform, p_locale, p_time_zone)
  on conflict (token) do update
     set user_id = excluded.user_id,       -- cambio de cuenta en el mismo dispositivo
         platform = excluded.platform,
         locale = excluded.locale,
         time_zone = excluded.time_zone,
         enabled = true,
         last_seen_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC de baja: borra el token si es del usuario autenticado (al cerrar sesión)
-- -----------------------------------------------------------------------------
create function public.unregister_push_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from push_tokens where token = p_token and user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke execute on function public.register_push_token(text, text, text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

commit;

-- Comprobación (solo lectura)
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
  from pg_class c
 where c.relname in ('push_tokens', 'notification_log', 'push_deliveries')
 order by 1;
select proname, has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec, proconfig
  from pg_proc where proname in ('register_push_token', 'unregister_push_token');
