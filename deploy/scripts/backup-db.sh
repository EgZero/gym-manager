#!/usr/bin/env bash
# =====================================================================
# GymManager · Respaldo automático de PostgreSQL
#
# - Volcado en formato custom (-Fc), comprimido y restaurable por tabla.
# - Verificación de integridad del archivo con pg_restore --list.
# - Retención configurable (por defecto 14 días) + copia semanal mensual.
# - Registro de resultado para revisión en los logs.
#
# Instalado por provision.sh en /usr/local/bin/gym-backup-db.sh y
# ejecutado por cron (usuario postgres) todos los días a las 02:30.
#
# Uso manual:  sudo -u postgres /usr/local/bin/gym-backup-db.sh
# =====================================================================
set -Eeuo pipefail

DB_NAME="${DB_NAME:-gymdb}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gym-manager}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
RETENCION_SEMANAL_DIAS="${RETENCION_SEMANAL_DIAS:-120}"
FECHA="$(date +%Y%m%d_%H%M%S)"
ARCHIVO="${BACKUP_DIR}/${DB_NAME}_${FECHA}.dump"

mkdir -p "${BACKUP_DIR}/semanal"

registro() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

registro "Iniciando respaldo de ${DB_NAME}"

pg_dump --dbname="${DB_NAME}" --format=custom --compress=9 --file="${ARCHIVO}"

# --- Verificación de integridad --------------------------------------
if ! pg_restore --list "${ARCHIVO}" >/dev/null 2>&1; then
  registro "ERROR: el respaldo ${ARCHIVO} está corrupto; se elimina"
  rm -f "${ARCHIVO}"
  exit 1
fi

chmod 600 "${ARCHIVO}"
TAMANIO="$(du -h "${ARCHIVO}" | cut -f1)"
sha256sum "${ARCHIVO}" > "${ARCHIVO}.sha256"
registro "Respaldo verificado: ${ARCHIVO} (${TAMANIO})"

# --- Copia semanal (domingos) para retención larga --------------------
if [[ "$(date +%u)" == "7" ]]; then
  cp "${ARCHIVO}" "${BACKUP_DIR}/semanal/"
  registro "Copia semanal almacenada en ${BACKUP_DIR}/semanal/"
fi

# --- Rotación ---------------------------------------------------------
find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}_*.dump*" -mtime "+${RETENCION_DIAS}" -delete
find "${BACKUP_DIR}/semanal" -name "${DB_NAME}_*.dump*" -mtime "+${RETENCION_SEMANAL_DIAS}" -delete
registro "Rotación aplicada (diarios ${RETENCION_DIAS}d, semanales ${RETENCION_SEMANAL_DIAS}d)"

TOTAL="$(find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}_*.dump" | wc -l)"
registro "Respaldo finalizado correctamente. Copias diarias disponibles: ${TOTAL}"

# --- Copia fuera del servidor (opcional) ------------------------------
# Descomente y configure para cumplir la regla 3-2-1 de respaldos:
# rsync -az --delete "${BACKUP_DIR}/" respaldo@otro-host:/respaldos/gym-manager/
