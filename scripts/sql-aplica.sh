#!/usr/bin/env bash
# Aplicación de un SQL versionado, SOLO con aprobación expresa de Luis en el
# chat y después de un ensayo correcto con scripts/sql-ensayo.sh.
#
#   scripts/sql-aplica.sh sql/AAAA-MM-DD_nombre.sql
#
# 1. Rechaza el fichero si contiene control de transacción o metacomandos de
#    psql (la transacción la pone este script).
# 2. Copia de seguridad del esquema public en
#    ~/habitapp-backups/AAAA-MM-DD-pre-<nombre>/ (fuera del repo).
# 3. Lo ejecuta en UNA transacción (psql --single-transaction): si algo
#    falla, no se aplica nada.
# Ver docs/workflow.md.
set -euo pipefail
source "$(dirname "$0")/sql-comun.sh"

[ $# -eq 1 ] || { echo "uso: $0 <fichero.sql>" >&2; exit 2; }
FICHERO="$1"
validar_fichero "$FICHERO"
cargar_conexion

NOMBRE="$(basename "$FICHERO" .sql)"
COPIA="$HOME/habitapp-backups/$(date +%F)-pre-$NOMBRE"
mkdir -p "$COPIA"
"$PG_DUMP" "$SUPABASE_DB_URL" --schema-only --schema=public -f "$COPIA/public_schema.sql" 2>"$COPIA/err.txt" \
  || { echo "Falló la copia de seguridad (ver $COPIA/err.txt): no se aplica nada" >&2; exit 1; }
echo "Copia de seguridad: $COPIA/public_schema.sql"

ANTES="$(huella_catalogo)"
"$PSQL" "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -P pager=off --single-transaction -f "$FICHERO"
DESPUES="$(huella_catalogo)"

if [ "$ANTES" = "$DESPUES" ]; then
  echo "Aviso: el catálogo no ha cambiado (¿era un fichero solo de datos, o ya estaba aplicado?)" >&2
fi
echo "APLICADO: $FICHERO"
