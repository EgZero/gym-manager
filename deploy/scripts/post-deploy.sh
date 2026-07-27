#!/usr/bin/env bash
# =====================================================================
# GymManager · Pasos posteriores al rsync, ejecutados EN EL VPS por CI
#
# Lo invoca .github/workflows/deploy.yml a través de SSH:
#   bash /var/www/gym-manager/backend/deploy/post-deploy.sh
#
# Responsabilidades:
#   1) Aplicar migraciones de base de datos.
#   2) Reiniciar la API y esperar a que el healthcheck responda.
#   3) Revertir al release anterior si el healthcheck falla (rollback).
# =====================================================================
set -Eeuo pipefail

APP_DIR="/var/www/gym-manager"
BACKEND_DIR="${APP_DIR}/backend"
RESPALDO_DIR="${APP_DIR}/.release-anterior"
ENV_FILE="/etc/gym-manager/api.env"
URL_SALUD="http://127.0.0.1:4000/api/health"
INTENTOS=15

registro() { printf '\n[deploy] %s\n' "$*"; }

registro "Aplicando migraciones de base de datos"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
cd "$BACKEND_DIR"
node dist/db/migrate.js

registro "Reiniciando el servicio gym-api"
sudo systemctl restart gym-api

registro "Verificando el healthcheck (${INTENTOS} intentos)"
for intento in $(seq 1 "$INTENTOS"); do
  if curl -fsS --max-time 3 "$URL_SALUD" >/dev/null 2>&1; then
    registro "Servicio saludable en el intento ${intento}"
    curl -fsS "$URL_SALUD"
    echo
    # El release actual pasa a ser el punto de retorno del próximo despliegue
    rm -rf "$RESPALDO_DIR"
    cp -a "$BACKEND_DIR" "$RESPALDO_DIR"
    registro "Despliegue completado correctamente"
    exit 0
  fi
  sleep 2
done

registro "ERROR: el healthcheck no respondió. Iniciando rollback."
sudo systemctl status gym-api --no-pager --lines 40 || true
journalctl -u gym-api --no-pager --lines 60 || true

if [[ -d "$RESPALDO_DIR" ]]; then
  rsync -a --delete "${RESPALDO_DIR}/" "${BACKEND_DIR}/"
  sudo systemctl restart gym-api
  sleep 5
  if curl -fsS --max-time 3 "$URL_SALUD" >/dev/null 2>&1; then
    registro "Rollback exitoso: el release anterior está en línea"
  else
    registro "CRÍTICO: el rollback tampoco levantó el servicio. Requiere intervención manual."
  fi
else
  registro "No hay release anterior almacenado: no se pudo hacer rollback"
fi

exit 1
