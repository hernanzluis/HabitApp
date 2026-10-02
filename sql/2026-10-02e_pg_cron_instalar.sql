-- =============================================================================
-- Recordatorio diario, paso 2a: instalar pg_cron (sin programar nada).
-- Diseño: docs/push-etapa6-recordatorio-diseno.md, punto 1.
-- Instalación indicada por Supabase (docs/guides/cron/install). Sin
-- begin/commit: scripts/sql-ensayo.sh y scripts/sql-aplica.sh.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Comprobación de permisos (solo lectura): qué queda al alcance de los
-- clientes (anon, authenticated) y de PUBLIC, y quién lo concedió.
select 'esquema' as que, n.nspname as objeto,
       has_schema_privilege('anon', n.oid, 'usage') as anon,
       has_schema_privilege('authenticated', n.oid, 'usage') as auth,
       coalesce(n.nspacl::text, '') as acl
  from pg_namespace n where n.nspname = 'cron'
union all
select 'tabla', c.relname,
       has_table_privilege('anon', c.oid, 'select,insert,update,delete'),
       has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'),
       coalesce(c.relacl::text, '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'cron' and c.relkind in ('r', 'v')
union all
select 'funcion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       has_function_privilege('anon', p.oid, 'execute'),
       has_function_privilege('authenticated', p.oid, 'execute'),
       coalesce(p.proacl::text, '(PUBLIC por defecto)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'cron'
 order by 1, 2;
