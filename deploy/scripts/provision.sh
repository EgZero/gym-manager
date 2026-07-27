#!/usr/bin/env bash
# =====================================================================
# GymManager · Provisionamiento del VPS (Ubuntu 22.04 / 24.04)
#
# Instala y configura: Nginx, Node.js 20, PostgreSQL 16, usuario de
# sistema, base de datos, firewall UFW, fail2ban, respaldos y el
# servicio systemd de la API.
#
# Uso (como root o con sudo):
#   sudo DOMINIO=gym.midominio.com bash deploy/scripts/provision.sh
#   sudo bash deploy/scripts/provision.sh            # sin dominio: solo HTTP
#
# Es idempotente: puede volver a ejecutarse sin romper nada.
# =====================================================================
set -Eeuo pipefail

DOMINIO="${DOMINIO:-}"
APP_DIR="/var/www/gym-manager"
ENV_DIR="/etc/gym-manager"
LOG_DIR="/var/log/gym-manager"
BACKUP_DIR="/var/backups/gym-manager"
DB_NAME="${DB_NAME:-gymdb}"
DB_USER="${DB_USER:-gymapp}"
DB_OWNER="${DB_OWNER:-gymowner}"
USUARIO_DESPLIEGUE="${USUARIO_DESPLIEGUE:-deploy}"
RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log()   { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Este script debe ejecutarse como root (use sudo)." >&2
  exit 1
fi

# ---------------------------------------------------------------------
log "1/11 · Actualizando el sistema base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release ufw fail2ban \
  rsync git unattended-upgrades acl jq

# ---------------------------------------------------------------------
log "2/11 · Instalando Node.js 20 LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

# ---------------------------------------------------------------------
log "3/11 · Instalando PostgreSQL y Nginx"
apt-get install -y -qq postgresql postgresql-contrib nginx
systemctl enable --now postgresql
systemctl enable --now nginx

# PostgreSQL solo escucha en loopback (RNF-03)
PG_VERSION="$(ls /etc/postgresql | sort -V | tail -1)"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"
systemctl restart postgresql

# ---------------------------------------------------------------------
log "4/11 · Creando usuarios de sistema y directorios"
id -u gymapp >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin gymapp
id -u "$USUARIO_DESPLIEGUE" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USUARIO_DESPLIEGUE"

mkdir -p "$APP_DIR/backend" "$APP_DIR/frontend" "$ENV_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "$USUARIO_DESPLIEGUE":gymapp "$APP_DIR"
chmod -R 750 "$APP_DIR"
chown -R gymapp:gymapp "$LOG_DIR"
chown root:gymapp "$ENV_DIR"
chmod 750 "$ENV_DIR"
chown postgres:postgres "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# El usuario de despliegue debe poder recargar el servicio sin contraseña
cat > /etc/sudoers.d/gym-deploy <<EOF
${USUARIO_DESPLIEGUE} ALL=(root) NOPASSWD: /bin/systemctl restart gym-api, \\
  /bin/systemctl reload gym-api, /bin/systemctl status gym-api, \\
  /bin/systemctl reload nginx, /usr/sbin/nginx -t
EOF
chmod 440 /etc/sudoers.d/gym-deploy

# ---------------------------------------------------------------------
log "5/11 · Creando base de datos y roles"
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
OWNER_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_OWNER}'" | grep -q 1; then
  aviso "El rol ${DB_OWNER} ya existe: se conserva su contraseña actual"
  OWNER_PASSWORD=""
else
  sudo -u postgres psql -c "CREATE ROLE ${DB_OWNER} LOGIN PASSWORD '${OWNER_PASSWORD}';"
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  aviso "El rol ${DB_USER} ya existe: se conserva su contraseña actual"
  DB_PASSWORD=""
else
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
fi

sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb -O "${DB_OWNER}" "${DB_NAME}"

sudo -u postgres psql -d "${DB_NAME}" -c "GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};"

# ---------------------------------------------------------------------
log "6/11 · Escribiendo variables de entorno"
if [[ ! -f "${ENV_DIR}/api.env" ]]; then
  JWT_SECRET="$(openssl rand -base64 48)"
  cat > "${ENV_DIR}/api.env" <<EOF
NODE_ENV=production
PORT=4000
CORS_ORIGIN=${DOMINIO:+https://$DOMINIO}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
MIGRATION_DATABASE_URL=postgresql://${DB_OWNER}:${OWNER_PASSWORD}@127.0.0.1:5432/${DB_NAME}
PGSSL=false
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=8h
MAX_INTENTOS_LOGIN=5
BLOQUEO_MINUTOS=15
PUNTOS_POR_ASISTENCIA=2
EOF
  chown root:gymapp "${ENV_DIR}/api.env"
  chmod 640 "${ENV_DIR}/api.env"
  echo "Archivo ${ENV_DIR}/api.env creado con credenciales aleatorias."
else
  aviso "${ENV_DIR}/api.env ya existe: no se sobrescribe"
fi

# ---------------------------------------------------------------------
log "7/11 · Instalando el servicio systemd"
install -m 644 "${RAIZ_REPO}/deploy/systemd/gym-api.service" /etc/systemd/system/gym-api.service
systemctl daemon-reload
systemctl enable gym-api

# ---------------------------------------------------------------------
log "8/11 · Configurando Nginx"
if [[ -n "$DOMINIO" ]]; then
  sed "s/__DOMINIO__/${DOMINIO}/g" "${RAIZ_REPO}/deploy/nginx/gym-manager.conf" \
    > /etc/nginx/sites-available/gym-manager
  aviso "Ejecute luego: certbot --nginx -d ${DOMINIO}  (el sitio no cargará hasta emitir el certificado)"
else
  install -m 644 "${RAIZ_REPO}/deploy/nginx/gym-manager-http.conf" /etc/nginx/sites-available/gym-manager
fi
ln -sf /etc/nginx/sites-available/gym-manager /etc/nginx/sites-enabled/gym-manager
rm -f /etc/nginx/sites-enabled/default
mkdir -p "$APP_DIR/frontend"
[[ -f "$APP_DIR/frontend/index.html" ]] || \
  echo '<h1>GymManager</h1><p>Esperando el primer despliegue…</p>' > "$APP_DIR/frontend/index.html"
nginx -t && systemctl reload nginx

if [[ -n "$DOMINIO" ]]; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ---------------------------------------------------------------------
log "9/11 · Configurando el firewall (UFW)"
bash "${RAIZ_REPO}/deploy/scripts/setup-firewall.sh"

# ---------------------------------------------------------------------
log "10/11 · Programando respaldos automáticos y mantenimiento"
install -m 750 -o postgres -g postgres "${RAIZ_REPO}/deploy/scripts/backup-db.sh" /usr/local/bin/gym-backup-db.sh
install -m 750 -o postgres -g postgres "${RAIZ_REPO}/deploy/scripts/restore-db.sh" /usr/local/bin/gym-restore-db.sh

cat > /etc/cron.d/gym-manager <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Respaldo diario de la base de datos a las 02:30
30 2 * * * postgres /usr/local/bin/gym-backup-db.sh >> /var/log/gym-manager/backup.log 2>&1
# Marcar membresías vencidas cada día a las 00:05
5 0 * * * postgres psql -d gymdb -c "SELECT gimnasio.fn_vencer_membresias();" >> /var/log/gym-manager/mantenimiento.log 2>&1
EOF
chmod 644 /etc/cron.d/gym-manager
touch /var/log/gym-manager/backup.log /var/log/gym-manager/mantenimiento.log
chown postgres:postgres /var/log/gym-manager/backup.log /var/log/gym-manager/mantenimiento.log

cat > /etc/logrotate.d/gym-manager <<'EOF'
/var/log/gym-manager/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

# Actualizaciones de seguridad desatendidas
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------------------------------------------------------------------
log "11/11 · Endureciendo SSH y fail2ban"
SSHD_CONF=/etc/ssh/sshd_config.d/99-gym-manager.conf
cat > "$SSHD_CONF" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
aviso "SSH quedará solo con clave pública. Asegúrese de tener su llave en ~${USUARIO_DESPLIEGUE}/.ssh/authorized_keys antes de reiniciar sshd."

cat > /etc/fail2ban/jail.d/gym-manager.local <<'EOF'
[sshd]
enabled  = true
maxretry = 4
bantime  = 1h
findtime = 10m

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled  = true
maxretry = 20
bantime  = 30m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ---------------------------------------------------------------------
log "Provisionamiento completado"
cat <<EOF

Resumen
-------
  Aplicación .......... ${APP_DIR}
  Variables ........... ${ENV_DIR}/api.env  (root:gymapp 640)
  Logs ................ ${LOG_DIR}  +  journalctl -u gym-api
  Respaldos ........... ${BACKUP_DIR}  (diarios 02:30, retención 14 días)
  Base de datos ....... ${DB_NAME}  (roles: ${DB_OWNER} dueño, ${DB_USER} app)

Pasos siguientes
----------------
  1) Copie la llave pública de despliegue:
       sudo -u ${USUARIO_DESPLIEGUE} mkdir -p ~${USUARIO_DESPLIEGUE}/.ssh
       sudo nano ~${USUARIO_DESPLIEGUE}/.ssh/authorized_keys
       sudo systemctl restart ssh
  2) Cargue los secretos en GitHub (ver docs/05-cicd.md) y haga push a main.
  3) Cree las cuentas de staff (ÚNICA vía permitida):
       sudo -u postgres psql -d ${DB_NAME} \\
         -c "SELECT gimnasio.crear_staff('admin','SuClaveSegura','Nombre Apellido','ADMINISTRADOR');"
EOF
