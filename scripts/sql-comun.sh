# Funciones comunes de sql-ensayo.sh y sql-aplica.sh (se carga con `source`).
# Nunca imprime la cadena de conexión.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PSQL="$(command -v psql || true)"
[ -n "$PSQL" ] || PSQL=/opt/homebrew/opt/libpq/bin/psql
PG_DUMP="$(command -v pg_dump || true)"
[ -n "$PG_DUMP" ] || PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump

cargar_conexion() {
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$REPO/.env" | head -1 | cut -d= -f2-)"
  fi
  [ -n "$SUPABASE_DB_URL" ] || { echo "Falta SUPABASE_DB_URL en $REPO/.env" >&2; exit 2; }
  export SUPABASE_DB_URL
}

validar_fichero() {
  local f="$1"
  [ -f "$f" ] || { echo "No existe el fichero: $f" >&2; exit 2; }
  python3 "$REPO/scripts/sql-sin-transaccion.py" "$f" || exit 1
}

# Huella del catálogo: funciones (con cuerpo y permisos), tablas y columnas,
# restricciones, triggers, policies, extensiones, esquemas y nombres de
# secretos de Vault. No cubre filas de datos.
huella_catalogo() {
  "$PSQL" "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 <<'SQL'
select md5(string_agg(x, '|' order by x)) from (
  select 'proc:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || coalesce(p.proacl::text, '') || md5(coalesce(p.prosrc, '')) || coalesce(array_to_string(p.proconfig, ','), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_t%'
  union all
  select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || coalesce(c.relacl::text, '') || c.relrowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_t%'
  union all
  select 'col:' || a.attrelid::regclass || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || a.attnotnull::text
         || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v', 'm', 'p')
     and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_t%'
  union all
  select 'con:' || conrelid::regclass || '.' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid <> 0
  union all
  select 'trg:' || tgrelid::regclass || '.' || tgname || ':' || tgenabled::text || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all
  select 'pol:' || schemaname || '.' || tablename || '.' || policyname || ':' || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, '') from pg_policies
  union all
  select 'ext:' || extname || ':' || extversion from pg_extension
  union all
  select 'nsp:' || nspname || coalesce(nspacl::text, '') from pg_namespace where nspname not like 'pg\_t%'
  union all
  select 'vault:' || name from vault.secrets
) s(x);
SQL
}
