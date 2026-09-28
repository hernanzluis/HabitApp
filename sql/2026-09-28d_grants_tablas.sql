-- =============================================================================
-- PROPUESTA — NO EJECUTADO. Privilegios de tabla de anon y authenticated.
-- Fecha: 2026-09-28. Informe: docs/security-inventory-2026-09-28.md (sección A).
--
-- Hoy anon y authenticated tienen SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES y TRIGGER en TODAS las tablas de public (default privileges de
-- Supabase). TRUNCATE no pasa por RLS; PostgREST no lo expone, pero no hay
-- motivo para tenerlo. La app y la web no hacen NINGUNA consulta a tablas sin
-- sesión (el alta usa RPCs), así que anon se queda sin nada.
-- =============================================================================

begin;

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Tablas a las que ningún cliente accede directamente (solo vía funciones
-- SECURITY DEFINER): fuera también para authenticated.
revoke all on public.activation_attempts from authenticated;
revoke all on public.plan_limits from authenticated;

-- Secuencias: anon no las necesita.
revoke all on all sequences in schema public from anon;

-- Tablas futuras: sin privilegios para anon por defecto, y sin TRUNCATE/
-- REFERENCES/TRIGGER para authenticated.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

commit;

-- Comprobación (solo lectura): anon sin ninguna fila; authenticated sin TRUNCATE.
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
 group by 1, 2 order by 1, 2;
