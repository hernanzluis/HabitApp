-- =============================================================================
-- Eliminar la tabla invitations (sin uso). Fecha: 2026-09-28.
-- Informe: docs/security-inventory-2026-09-28.md. Aplicar DESPUÉS de
-- 2026-09-28c_funciones.sql, que elimina su única función
-- (handle_invited_user_registration).
--
-- Estado comprobado: 0 filas; ninguna llamada a .from('invitations') en la app
-- ni en habitteam-web; su FK invitations.created_by → profiles desaparece con
-- la tabla. Copia de la definición en el backup del 2026-09-28.
-- =============================================================================

begin;

drop table public.invitations;

commit;

-- Comprobación (solo lectura): debe devolver null.
select to_regclass('public.invitations');
