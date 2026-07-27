#!/usr/bin/env bash
# =====================================================================
# GymManager · Restauración de la base de datos desde un respaldo
#
# Uso:
#   sudo -u postgres /usr/local/bin/gym-restore-db.sh <archivo.dump> [base_destino]
#
# Por seguridad:
#  - Detiene la API antes de restaurar y la reinicia al terminar.
#  - Verifica el archivo y su checksum antes de tocar la base.
#  - Genera un respaldo previo por si la restauración fue un error.
# =====================================================================
set -Eeuo pipefail

ARCHIVO="${1:-}"
DB_NAME="${2:-gymdb}"

if [[ -z "$ARCHIVO" || ! -f "$ARCHIVO" ]]; then
  echo "Uso: $0 <archivo.dump> [base_destino]" >&2
  echo "Respaldos disponibles:" >&2
  ls -1t /var/backups/gym-manager/*.dump 2>/dev/null | head -20 >&2 || true
  exit 1
fi

registro() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

registro "Verificando integridad de ${ARCHIVO}"
pg_restore --list "$ARCHIVO" >/dev/null
if [[ -f "${ARCHIVO}.sha256" ]]; then
  sha256sum --check --status "${ARCHIVO}.sha256" || {
    echo "El checksum no coincide: el archivo pudo alterarse." >&2
    exit 1
  }
  registro "Checksum verificado"
fi

read -r -p "Se sobrescribirá la base '${DB_NAME}'. ¿Continuar? (escriba SI): " CONFIRMA
[[ "$CONFIRMA" == "SI" ]] || { echo "Cancelado."; exit 1; }

registro "Deteniendo la API"
systemctl stop gym-api 2>/dev/null || sudo systemctl stop gym-api 2>/dev/null || \
  registro "AVISO: no se pudo detener gym-api (¿sin permisos?), continúe con cuidado"

PREVIO="/var/backups/gym-manager/pre_restauracion_$(date +%Y%m%d_%H%M%S).dump"
registro "Generando respaldo previo en ${PREVIO}"
pg_dump --dbname="${DB_NAME}" --format=custom --compress=9 --file="${PREVIO}" || \
  registro "AVISO: no se pudo generar el respaldo previo"

registro "Restaurando ${ARCHIVO} en ${DB_NAME}"
pg_restore --dbname="${DB_NAME}" --clean --if-exists --no-owner --no-privileges "$ARCHIVO"

registro "Reiniciando la API"
systemctl start gym-api 2>/dev/null || sudo systemctl start gym-api 2>/dev/null || true

registro "Restauración completada. Verifique con:"
echo "  psql -d ${DB_NAME} -c 'SELECT COUNT(*) FROM gimnasio.socios;'"
echo "  curl -fsS http://127.0.0.1:4000/api/health"
