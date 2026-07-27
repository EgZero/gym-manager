# 4. Proceso de Provisionamiento — Bitácora de Instalación

Este documento es la **bitácora reproducible** de la puesta en marcha del VPS. Todo lo descrito
está automatizado en `deploy/scripts/provision.sh`; aquí se detalla qué hace cada paso y cómo
verificarlo.

> **Ejecución completa:**
> ```bash
> git clone https://github.com/EgZero/gym-manager.git
> cd gym-manager
> sudo DOMINIO=gym.midominio.com bash deploy/scripts/provision.sh
> ```
> Sin la variable `DOMINIO` se instala el sitio en modo solo HTTP (útil si aún no hay dominio).

---

## 4.1 Requisitos previos

| Recurso | Mínimo recomendado |
|---|---|
| VPS | 1 vCPU, 1 GB RAM, 20 GB SSD (Ubuntu 22.04 LTS) |
| Acceso | Usuario con `sudo` y clave SSH |
| Dominio | Opcional, necesario para HTTPS con Let's Encrypt |

---

## 4.2 Bitácora paso a paso

### Paso 1 — Actualización del sistema base
```bash
apt-get update && apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg ufw fail2ban rsync git unattended-upgrades jq acl
```
**Verificación:** `lsb_release -a`

### Paso 2 — Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```
**Verificación:** `node -v` → `v20.x` · `npm -v`

### Paso 3 — PostgreSQL 16 y Nginx
```bash
apt-get install -y postgresql postgresql-contrib nginx
systemctl enable --now postgresql nginx
# PostgreSQL solo en loopback
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" \
  /etc/postgresql/16/main/postgresql.conf
systemctl restart postgresql
```
**Verificación:** `ss -lntp | grep 5432` debe mostrar **`127.0.0.1:5432`** y nunca `0.0.0.0:5432`.

### Paso 4 — Usuarios de sistema y estructura de directorios

| Usuario | Shell | Propósito |
|---|---|---|
| `gymapp` | `/usr/sbin/nologin` | Ejecuta el proceso Node. Sin login, sin sudo. |
| `deploy` | `/bin/bash` | Recibe el `rsync` de GitHub Actions. Sudo restringido a 5 comandos. |
| `postgres` | — | Dueño del motor y de los respaldos. |

| Ruta | Dueño | Permisos | Contenido |
|---|---|---|---|
| `/var/www/gym-manager/backend` | `deploy:gymapp` | 750 | API compilada |
| `/var/www/gym-manager/frontend` | `deploy:gymapp` | 750 | SPA compilada |
| `/etc/gym-manager/api.env` | `root:gymapp` | **640** | Secretos (DB, JWT) |
| `/var/log/gym-manager` | `gymapp:gymapp` | 755 | Logs de backup y mantenimiento |
| `/var/backups/gym-manager` | `postgres:postgres` | **700** | Volcados de la base |

Sudo mínimo para el despliegue (`/etc/sudoers.d/gym-deploy`):
```
deploy ALL=(root) NOPASSWD: /bin/systemctl restart gym-api, /bin/systemctl reload gym-api,
  /bin/systemctl status gym-api, /bin/systemctl reload nginx, /usr/sbin/nginx -t
```
El usuario de CI **no** puede ejecutar nada más como root.

### Paso 5 — Base de datos y roles
```bash
sudo -u postgres psql -c "CREATE ROLE gymowner LOGIN PASSWORD '<aleatoria>';"
sudo -u postgres psql -c "CREATE ROLE gymapp  LOGIN PASSWORD '<aleatoria>';"
sudo -u postgres createdb -O gymowner gymdb
sudo -u postgres psql -d gymdb -c "GRANT CONNECT ON DATABASE gymdb TO gymapp;"
```
Las contraseñas las genera el script con `openssl rand` y quedan solo en `/etc/gym-manager/api.env`.

**Verificación:** `sudo -u postgres psql -d gymdb -c "\du"`

### Paso 6 — Variables de entorno

`/etc/gym-manager/api.env` (root:gymapp, 640) — **fuera del repositorio**:

```ini
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://gym.midominio.com
DATABASE_URL=postgresql://gymapp:***@127.0.0.1:5432/gymdb
MIGRATION_DATABASE_URL=postgresql://gymowner:***@127.0.0.1:5432/gymdb
JWT_SECRET=<openssl rand -base64 48>
JWT_EXPIRES_IN=8h
MAX_INTENTOS_LOGIN=5
BLOQUEO_MINUTOS=15
PUNTOS_POR_ASISTENCIA=2
```

### Paso 7 — Servicio systemd
```bash
install -m 644 deploy/systemd/gym-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now gym-api
```
Endurecimiento aplicado: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp`, `PrivateDevices`, `RestrictAddressFamilies`, `CapabilityBoundingSet=` vacío,
`Restart=always` con `RestartSec=5`.

**Verificación:** `systemctl status gym-api` · `journalctl -u gym-api -n 50`

### Paso 8 — Nginx
```bash
sed 's/__DOMINIO__/gym.midominio.com/g' deploy/nginx/gym-manager.conf \
  > /etc/nginx/sites-available/gym-manager
ln -sf /etc/nginx/sites-available/gym-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d gym.midominio.com     # HTTPS + renovación automática
```
**Verificación:** `curl -I https://gym.midominio.com` y `curl -fsS https://gym.midominio.com/api/health`

### Paso 9 — Firewall (detalle en `docs/06-mantenimiento-seguridad.md`)
```bash
bash deploy/scripts/setup-firewall.sh
```

### Paso 10 — Respaldos y tareas programadas

`/etc/cron.d/gym-manager`:
```cron
30 2 * * * postgres /usr/local/bin/gym-backup-db.sh >> /var/log/gym-manager/backup.log 2>&1
5  0 * * * postgres psql -d gymdb -c "SELECT gimnasio.fn_vencer_membresias();" >> /var/log/gym-manager/mantenimiento.log 2>&1
```
Más `logrotate` semanal con 8 rotaciones comprimidas y `unattended-upgrades` para parches de seguridad.

### Paso 11 — Endurecimiento de SSH y fail2ban

`/etc/ssh/sshd_config.d/99-gym-manager.conf`:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```
fail2ban activa las jaulas `sshd`, `nginx-http-auth` y `nginx-limit-req`.

> ⚠️ Antes de reiniciar `sshd`, cargue su llave pública en
> `/home/deploy/.ssh/authorized_keys`, o perderá el acceso al servidor.

---

## 4.3 Puertos y superficie de exposición

| Puerto | Protocolo | Origen permitido | Servicio | Estado |
|---|---|---|---|---|
| 22 | TCP | Internet (con `ufw limit` + fail2ban) | SSH / rsync de CI | Abierto |
| 80 | TCP | Internet | Nginx (redirección y ACME) | Abierto |
| 443 | TCP | Internet | Nginx (SPA + API) | Abierto |
| 4000 | TCP | **solo 127.0.0.1** | API Node | No expuesto |
| 5432 | TCP | **solo 127.0.0.1** | PostgreSQL | Denegado explícitamente |

---

## 4.4 Primer despliegue y creación del administrador

```bash
# 1) Llave de despliegue en el VPS
sudo -u deploy mkdir -p /home/deploy/.ssh
sudo -u deploy nano /home/deploy/.ssh/authorized_keys      # pegar la clave PÚBLICA
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys

# 2) Push a main → GitHub Actions compila, sincroniza, migra y reinicia

# 3) Crear el administrador (ÚNICA vía autorizada)
sudo -u postgres psql -d gymdb -c \
  "SELECT gimnasio.crear_staff('admin','ClaveFuerte#2026','Angel Orellana','ADMINISTRADOR');"

# 4) Crear operadores
sudo -u postgres psql -d gymdb -c \
  "SELECT gimnasio.crear_staff('recepcion1','ClaveFuerte#2026','María López','OPERADOR');"
```

---

## 4.5 Lista de verificación posterior a la instalación

```bash
systemctl is-active gym-api nginx postgresql     # los tres: active
ss -lntp | grep -E '5432|4000'                   # ambos en 127.0.0.1
sudo ufw status verbose                          # 22, 80, 443 abiertos; 5432 denegado
curl -fsS http://127.0.0.1:4000/api/health       # {"estado":"ok",...}
curl -fsS https://gym.midominio.com/api/health   # a través de Nginx
sudo -u postgres /usr/local/bin/gym-backup-db.sh # respaldo manual de prueba
ls -lh /var/backups/gym-manager                  # el .dump existe
sudo fail2ban-client status sshd                 # jaula activa
```
