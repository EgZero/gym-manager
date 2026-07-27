#!/usr/bin/env bash
# =====================================================================
# GymManager · Política de firewall (UFW)
#
# Política: denegar todo el tráfico entrante y permitir solo lo necesario.
#   22/tcp  SSH  (con limitación de tasa contra fuerza bruta)
#   80/tcp  HTTP (redirección a HTTPS y desafío ACME de Let's Encrypt)
#   443/tcp HTTPS
# PostgreSQL (5432) NO se expone: la API se conecta por 127.0.0.1.
#
# Uso: sudo bash deploy/scripts/setup-firewall.sh [PUERTO_SSH]
# =====================================================================
set -Eeuo pipefail

PUERTO_SSH="${1:-22}"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecute este script como root (sudo)." >&2
  exit 1
fi

command -v ufw >/dev/null || { apt-get update -qq && apt-get install -y -qq ufw; }

echo "==> Aplicando política por defecto: denegar entrante, permitir saliente"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing

echo "==> Permitiendo SSH en el puerto ${PUERTO_SSH} con limitación de tasa"
ufw limit "${PUERTO_SSH}/tcp" comment 'SSH con rate limit'

echo "==> Permitiendo tráfico web"
ufw allow 80/tcp  comment 'HTTP - Nginx'
ufw allow 443/tcp comment 'HTTPS - Nginx'

echo "==> Bloqueando explícitamente el acceso remoto a PostgreSQL"
ufw deny 5432/tcp comment 'PostgreSQL solo por loopback'

ufw logging on
ufw --force enable

echo
ufw status verbose
echo
echo "Firewall configurado. Verifique que PostgreSQL escucha solo en loopback:"
echo "  sudo ss -lntp | grep 5432   # debe mostrar 127.0.0.1:5432"
