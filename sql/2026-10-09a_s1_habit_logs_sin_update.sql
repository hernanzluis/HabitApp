-- =============================================================================
-- S1 (auditoría 2026-10-09): nadie modifica habit_logs desde un cliente.
-- Fecha: 2026-10-09. Aprobado por Luis. Sin begin/commit (scripts/sql-*.sh).
--
-- La policy de UPDATE dejaba al autor poner su log en 'validated', cambiar
-- created_at, photo_url o habit_id, y a un validador cambiar el estado de un
-- log ajeno o apropiárselo (user_id). Ni la app ni la web hacen UPDATE sobre
-- habit_logs (la validación va en habit_validations); las funciones SECURITY
-- DEFINER son de postgres (dueño de la tabla, sin FORCE RLS) y la Edge
-- Function usa la clave de servicio: no dependen de esta policy.
-- Además se retira el privilegio de UPDATE a authenticated, para que una
-- policy futura no lo reabra por descuido.
-- =============================================================================

drop policy "owner validators or admins can update habit logs" on public.habit_logs;
revoke update on public.habit_logs from authenticated;

-- Comprobación (solo lectura)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'habit_logs' order by cmd;
select has_table_privilege('authenticated', 'public.habit_logs', 'update') as auth_update;
