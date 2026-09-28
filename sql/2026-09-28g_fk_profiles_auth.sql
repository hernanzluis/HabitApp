-- =============================================================================
-- APLICADO el 2026-09-28 con aprobación expresa de Luis (verificado en el catálogo). FK profiles.id → auth.users(id) ON DELETE CASCADE.
-- Fecha: 2026-09-28. Informe: docs/security-inventory-2026-09-28.md (sección C).
--
-- Estado comprobado a 2026-09-28: profiles solo tiene profiles_pkey; 0 profiles
-- sin auth.users; profiles.id tiene DEFAULT gen_random_uuid() (permitía crear
-- profiles con ids que no existen en Auth, como se vio el 2026-09-28).
--
-- Efectos:
-- - delete_own_account / delete_member borran profiles y después auth.users:
--   siguen funcionando igual (al borrar auth.users ya no queda profile).
-- - Borrar un usuario desde el dashboard o con auth.admin.deleteUser borra ya
--   su profile, y en cascada habit_logs, habit_assignments, habit_validators,
--   habit_validations y team_members (FKs ya existentes con CASCADE).
--   companies.admin_id y habits.created_by no son FKs: quedan como hoy.
-- - cleanupTestData() (tests/test-helpers.js) borra profiles antes que Auth:
--   sin cambios. Solo test-00 inserta profiles directamente, y lo hace para un
--   usuario de Auth que ya existe: sin cambios.
-- - Storage no se limpia (ni antes ni después): ver fichero f.
-- =============================================================================

begin;

alter table public.profiles alter column id drop default;

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

commit;

-- Comprobación (solo lectura)
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass;
