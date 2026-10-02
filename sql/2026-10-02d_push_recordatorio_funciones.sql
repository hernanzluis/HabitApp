-- =============================================================================
-- Notificaciones push, recordatorio diario (tipo 4), paso 1 de 3: funciones
-- SQL, SIN pg_cron. Diseño: docs/push-etapa6-recordatorio-diseno.md
-- (aprobado por Luis el 2026-10-02). Sin begin/commit: se ensaya con
-- scripts/sql-ensayo.sh y se aplica con scripts/sql-aplica.sh.
--
-- Crea:
--   pending_habits_for_user(user, tz, now)   hábitos pendientes hoy (día local)
--   push_reminder_candidates(now, user_ids)  a quién le toca el recordatorio
--   push_cron_tick()                         llamada de pg_cron a push-events (paso 2)
--
-- Ninguna decide con now() por dentro (salvo push_cron_tick, que solo lo
-- pasa): el instante es un parámetro para poder probar sin esperar horas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hábitos pendientes "hoy" para un usuario, replicando HomeScreen.fetchData,
--    con los límites del día, la semana (lunes) y el mes calculados en la
--    zona horaria del usuario y comparados como instantes: nunca se usa la
--    fecha UTC de created_at (el índice habit_logs_one_per_day sí la usa;
--    ver database.md).
--    Los logs posteriores al fin del día local no cuentan (en tiempo real no
--    existen; con un p_now simulado, sí).
-- -----------------------------------------------------------------------------
create function public.pending_habits_for_user(p_user_id uuid, p_time_zone text, p_now timestamptz)
returns table (habit_id uuid, title text, recurrence text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lim as (
    select (d::timestamp at time zone p_time_zone)                                         as day_start,
           ((d + 1)::timestamp at time zone p_time_zone)                                   as day_end,
           (date_trunc('week', d::timestamp) at time zone p_time_zone)                     as week_start,
           (date_trunc('month', d::timestamp) at time zone p_time_zone)                    as month_start,
           ((date_trunc('month', d::timestamp) + interval '1 month') at time zone p_time_zone) as month_end
      from (select (p_now at time zone p_time_zone)::date as d) x
  ),
  hs as (
    select h.id, h.title, h.recurrence, h.weekly_target, h.monthly_target
      from habit_assignments ha
      join habits h on h.id = ha.habit_id
      join profiles p on p.id = ha.user_id
     where ha.user_id = p_user_id
       and h.company_id = p.company_id
       and h.is_active
       and (h.expires_at is null or h.expires_at > p_now)
  ),
  stats as (
    select hs.*,
           count(l.id) filter (where l.created_at < lim.day_end)                                    as logs_ever,
           count(l.id) filter (where l.created_at >= lim.day_start and l.created_at < lim.day_end)  as logs_today,
           count(l.id) filter (where l.created_at >= lim.week_start and l.created_at < lim.day_end) as logs_week,
           count(l.id) filter (where l.created_at >= lim.month_start and l.created_at < lim.month_end
                                 and l.created_at < lim.day_end)                                    as logs_month
      from hs
      cross join lim
      left join habit_logs l on l.habit_id = hs.id and l.user_id = p_user_id
     group by hs.id, hs.title, hs.recurrence, hs.weekly_target, hs.monthly_target
  )
  select id, title, recurrence
    from stats
   where not (recurrence = 'once' and logs_ever > 0)
     and logs_today = 0
     and not (recurrence = 'weekly_x' and logs_week >= coalesce(weekly_target, 1))
     and not (recurrence = 'monthly_x' and logs_month >= coalesce(monthly_target, 1))
   order by title;
$$;

-- -----------------------------------------------------------------------------
-- 2. Candidatos al recordatorio en el instante p_now: usuarios con algún token
--    activo cuya hora local (zona de su token usado más recientemente) es las
--    20 o las 21 (la 21 es el reintento si falló la de las 20), con algún
--    hábito pendiente y sin recordatorio ese día local. p_user_ids limita a
--    esos usuarios: obligatorio en las pruebas con un p_now simulado, para no
--    alcanzar nunca a usuarios reales; el tick de pg_cron no lo pasa.
-- -----------------------------------------------------------------------------
create function public.push_reminder_candidates(p_now timestamptz, p_user_ids uuid[] default null)
returns table (user_id uuid, time_zone text, local_date date, local_hour int, pending_count int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tz as (
    select distinct on (t.user_id) t.user_id, t.time_zone
      from push_tokens t
     where t.enabled
       and (p_user_ids is null or t.user_id = any (p_user_ids))
     order by t.user_id, t.last_seen_at desc, t.id
  ),
  loc as (
    select tz.user_id, tz.time_zone, (p_now at time zone tz.time_zone) as lt
      from tz
  )
  select loc.user_id, loc.time_zone, loc.lt::date, extract(hour from loc.lt)::int, pc.n
    from loc
    cross join lateral (
      select count(*)::int as n from pending_habits_for_user(loc.user_id, loc.time_zone, p_now)
    ) pc
   where extract(hour from loc.lt) in (20, 21)
     and pc.n > 0
     and not exists (select 1 from notification_log n
                      where n.type = 'daily_reminder'
                        and n.recipient_id = loc.user_id
                        and n.local_date = loc.lt::date)
   order by loc.user_id;
$$;

revoke execute on function public.pending_habits_for_user(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.push_reminder_candidates(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.pending_habits_for_user(uuid, text, timestamptz) to service_role;
grant execute on function public.push_reminder_candidates(timestamptz, uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Lo que ejecutará la tarea de pg_cron (paso 2): lee el secreto de Vault y
--    llama a push-events. Así el secreto no queda en cron.job.command (texto
--    plano). Sin ejecución para ningún cliente ni para service_role.
-- -----------------------------------------------------------------------------
create function public.push_cron_tick()
returns void
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
    return;
  end if;

  perform net.http_post(
    url := 'https://uvsngemnftpysjvxslhu.supabase.co/functions/v1/push-events',
    body := jsonb_build_object('type', 'daily_reminder'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.push_cron_tick() from public, anon, authenticated, service_role;

-- Comprobación (solo lectura)
select proname, has_function_privilege('anon', oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('service_role', oid, 'execute') as service_exec
  from pg_proc
 where proname in ('pending_habits_for_user', 'push_reminder_candidates', 'push_cron_tick')
 order by 1;
