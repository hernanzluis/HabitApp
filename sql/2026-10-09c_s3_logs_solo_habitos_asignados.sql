-- =============================================================================
-- S3 (auditoría 2026-10-09): solo se registran logs de hábitos asignados al
-- propio usuario y de su empresa. Fecha: 2026-10-09. Aprobado por Luis.
--
-- Antes bastaba con que el hábito fuera de la empresa: un miembro podía
-- registrar logs de hábitos que no tenía asignados (y disparar avisos
-- "pendiente de validar"). HabitDetailScreen solo completa hábitos que
-- aparecen en Inicio, que son los asignados (también los de tipo "una vez" y
-- los que el admin se asigna a sí mismo).
-- =============================================================================

drop policy "users can create own habit logs" on public.habit_logs;

create policy "users can create logs of own assigned habits" on public.habit_logs
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.habit_assignments a
                  join public.habits h on h.id = a.habit_id
                 where a.habit_id = habit_logs.habit_id
                   and a.user_id = auth.uid()
                   and h.company_id = public.my_company_id())
  );

-- Comprobación (solo lectura)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'habit_logs' order by cmd;
