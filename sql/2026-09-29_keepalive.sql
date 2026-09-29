-- =============================================================================
-- keepalive(): ping mínimo para que el proyecto de Supabase (plan gratuito) no
-- se pause por 7 días de inactividad. Lo llama cada 3 días el workflow
-- .github/workflows/supabase-keepalive.yml con la anon key.
-- Fecha: 2026-09-29. APLICADO ese día con aprobación expresa de Luis (verificado
-- en el catálogo y con la misma llamada HTTP que hace el workflow).
--
-- Por qué una función y no leer una tabla: desde el cierre de seguridad del
-- 2026-09-28 (sql/2026-09-28d_grants_tablas.sql) anon no tiene ningún
-- privilegio de tabla; un GET a /rest/v1/plan_limits devuelve 401.
--
-- Diseño: SECURITY INVOKER (se ejecuta con los permisos de anon, sin
-- privilegios extra), no lee ni escribe ninguna tabla, devuelve siempre 1.
-- Es la segunda función ejecutable por anon junto a check_activation_code
-- (tests/test-09-aislamiento.js, test 2, lo refleja).
-- =============================================================================

begin;

create function public.keepalive()
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 1;
$$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

commit;

-- Comprobación (solo lectura)
select proname, prosecdef as security_definer,
       has_function_privilege('anon', oid, 'execute') as anon_exec
  from pg_proc where proname = 'keepalive';
