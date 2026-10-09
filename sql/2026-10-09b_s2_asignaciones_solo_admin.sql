-- =============================================================================
-- S2 (auditoría 2026-10-09): solo el admin crea asignaciones, y solo de
-- miembros de su empresa. Fecha: 2026-10-09. Aprobado por Luis.
--
-- Antes cualquier miembro podía insertar asignaciones (documentado como
-- intencional: auto-asignarse), incluso de usuarios de otra empresa. Desde
-- que existen los avisos push de "hábito asignado", eso permitía enviar
-- avisos a otros miembros. AdminScreen y el panel web ya asignan como admin.
-- =============================================================================

drop policy "authenticated can insert assignments for own company habits" on public.habit_assignments;

create policy "admins can insert assignments for own company habits" on public.habit_assignments
  for insert to authenticated
  with check (
    public.is_admin()
    and exists (select 1 from public.habits h
                 where h.id = habit_assignments.habit_id and h.company_id = public.my_company_id())
    and exists (select 1 from public.profiles p
                 where p.id = habit_assignments.user_id and p.company_id = public.my_company_id())
  );

-- Comprobación (solo lectura)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'habit_assignments' order by cmd;
