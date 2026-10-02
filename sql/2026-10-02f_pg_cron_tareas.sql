-- =============================================================================
-- Recordatorio diario, paso 2b: programar las tareas de pg_cron.
-- Requiere 2026-10-02e (pg_cron instalado) y 2026-10-02d (push_cron_tick).
-- Diseño: docs/push-etapa6-recordatorio-diseno.md. Sin begin/commit.
--
-- OJO: en cuanto se aplique, la primera ejecución en punto que caiga en las
-- 20:00 o 21:00 de Madrid enviará recordatorios REALES a quien tenga hábitos
-- pendientes (es el funcionamiento normal).
--
-- Programación en UTC. cron.schedule con nombre es idempotente: si la tarea
-- existe, la actualiza.
-- =============================================================================

-- Cada hora en punto: solo encola la llamada a push-events (el secreto lo
-- lee push_cron_tick de Vault; aquí no aparece).
select cron.schedule('push-reminder-tick', '0 * * * *', 'select public.push_cron_tick();');

-- Limpieza diaria del historial de ejecuciones (pg_cron no lo limpia solo).
select cron.schedule('cron-cleanup', '30 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- Comprobación (solo lectura)
select jobid, jobname, schedule, command, username, active from cron.job order by jobname;
