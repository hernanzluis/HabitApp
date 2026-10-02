#!/usr/bin/env bash
# Ensayo de un SQL versionado: lo ejecuta entre BEGIN y ROLLBACK y comprueba
# que no ha quedado nada aplicado. No cambia la base.
#
#   scripts/sql-ensayo.sh sql/AAAA-MM-DD_nombre.sql
#
# Falla si:
#   - el fichero contiene control de transacción o metacomandos de psql
#     (scripts/sql-sin-transaccion.py, antes de conectarse);
#   - hay cualquier error (ON_ERROR_STOP);
#   - psql emite un aviso de transacción ("already a transaction in
#     progress", "there is no transaction in progress");
#   - la huella del catálogo cambia entre antes y después del ensayo.
# Ver docs/workflow.md y docs/release.md ("Hallazgos de proceso", 2026-10-02).
set -euo pipefail
source "$(dirname "$0")/sql-comun.sh"

[ $# -eq 1 ] || { echo "uso: $0 <fichero.sql>" >&2; exit 2; }
FICHERO="$1"
validar_fichero "$FICHERO"
cargar_conexion

ANTES="$(huella_catalogo)"

SALIDA="$(mktemp)"
trap 'rm -f "$SALIDA"' EXIT
set +e
{ printf 'begin;\n'; cat "$FICHERO"; printf '\n;\nrollback;\n'; } \
  | "$PSQL" "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -P pager=off -f - >"$SALIDA" 2>&1
ESTADO=$?
set -e
cat "$SALIDA"

FALLO=0
if [ $ESTADO -ne 0 ]; then
  echo "ENSAYO FALLIDO: psql terminó con código $ESTADO" >&2
  FALLO=1
fi
if grep -qiE 'already a transaction in progress|there is no transaction in progress' "$SALIDA"; then
  echo "ENSAYO FALLIDO: aviso de control de transacción en la salida" >&2
  FALLO=1
fi
if ! tail -n 3 "$SALIDA" | grep -qx 'ROLLBACK'; then
  echo "ENSAYO FALLIDO: la última orden no fue ROLLBACK" >&2
  FALLO=1
fi

DESPUES="$(huella_catalogo)"
if [ "$ANTES" != "$DESPUES" ]; then
  echo "ENSAYO FALLIDO: el catálogo ha cambiado tras el ensayo. Algo se ha aplicado: avisa a Luis antes de seguir." >&2
  exit 3
fi
echo "Catálogo sin cambios tras el ensayo (huella ${DESPUES:0:12}…)."

[ $FALLO -eq 0 ] || exit 1
echo "ENSAYO OK: $FICHERO"
