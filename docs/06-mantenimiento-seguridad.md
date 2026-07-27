# 6. Plan de Mantenimiento y Seguridad

---

## 6.1 Estrategia de respaldo de PostgreSQL

### Objetivos de recuperación

| Métrica | Valor | Justificación |
|---|---|---|
| **RPO** (pérdida máxima aceptable) | 24 h | Volumen de transacciones bajo; un respaldo diario es suficiente. |
| **RTO** (tiempo máximo de recuperación) | < 15 min | Restaurar un `pg_dump -Fc` de esta base toma pocos minutos. |

### Esquema de respaldos

| Tipo | Frecuencia | Retención | Ubicación |
|---|---|---|---|
| Diario completo | 02:30 (cron) | 14 días | `/var/backups/gym-manager/` |
| Semanal (domingo) | 02:30 | 120 días | `/var/backups/gym-manager/semanal/` |
| Pre-restauración | Bajo demanda | Manual | Generado por `restore-db.sh` antes de sobrescribir |

### Qué hace `deploy/scripts/backup-db.sh`

1. `pg_dump --format=custom --compress=9` → volcado comprimido y restaurable por tabla.
2. **Verificación de integridad**: `pg_restore --list`; si el archivo está corrupto se elimina y
   el script termina con error (queda registrado en el log).
3. Genera un `.sha256` para detectar alteraciones posteriores.
4. Permisos `600` y directorio `700` (solo `postgres` puede leer los datos personales).
5. Rotación por antigüedad y registro del resultado en `/var/log/gym-manager/backup.log`.

```cron
30 2 * * * postgres /usr/local/bin/gym-backup-db.sh >> /var/log/gym-manager/backup.log 2>&1
```

### Restauración

```bash
sudo -u postgres /usr/local/bin/gym-restore-db.sh /var/backups/gym-manager/gymdb_20260315_023001.dump
```

El script verifica el checksum, pide confirmación explícita (`SI`), detiene la API, genera un
respaldo previo, restaura con `pg_restore --clean --if-exists` y reinicia el servicio.

### Prueba periódica de restauración (obligatoria)

Un respaldo que nunca se restauró no es un respaldo. **Una vez al mes:**

```bash
sudo -u postgres createdb gymdb_prueba
sudo -u postgres pg_restore -d gymdb_prueba --no-owner /var/backups/gym-manager/<último>.dump
sudo -u postgres psql -d gymdb_prueba -c "SELECT COUNT(*) FROM gimnasio.socios;"
sudo -u postgres dropdb gymdb_prueba
```

### Copia fuera del servidor (regla 3-2-1)

El script incluye, comentada, la línea para enviar los respaldos a otro host:

```bash
rsync -az --delete /var/backups/gym-manager/ respaldo@otro-host:/respaldos/gym-manager/
```

Recomendado: activarla hacia un almacenamiento externo (otro VPS u object storage), porque un
respaldo que vive en el mismo disco que la base no protege contra la pérdida del servidor.

---

## 6.2 Política de firewall

Aplicada por `deploy/scripts/setup-firewall.sh`. Filosofía: **denegar por defecto**.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp     # SSH con limitación de tasa
ufw allow 80/tcp     # HTTP (redirección + ACME)
ufw allow 443/tcp    # HTTPS
ufw deny  5432/tcp   # PostgreSQL: denegación explícita y documentada
ufw logging on
ufw --force enable
```

| Puerto | Política | Motivo |
|---|---|---|
| 22/tcp | `limit` | Necesario para administración y para el rsync de CI. `ufw limit` bloquea IPs con más de 6 conexiones en 30 s; fail2ban refuerza. |
| 80/tcp | `allow` | Redirección a HTTPS y validación ACME de Let's Encrypt. |
| 443/tcp | `allow` | Único punto de entrada de la aplicación. |
| 5432/tcp | `deny` | La API se conecta por `127.0.0.1`. La denegación explícita documenta la intención y protege ante un cambio accidental de `listen_addresses`. |
| 4000/tcp | sin regla (denegado por defecto) | El servidor de aplicaciones solo escucha en loopback. |

**Defensa en profundidad:** aunque UFW fallara, PostgreSQL tiene `listen_addresses = 'localhost'`
y Node escucha en `127.0.0.1`, por lo que ninguno de los dos sería alcanzable desde Internet.

### Capas adicionales

| Capa | Medida |
|---|---|
| Red | UFW deny-by-default + fail2ban (`sshd`, `nginx-http-auth`, `nginx-limit-req`) |
| Transporte | TLS 1.2/1.3 con Let's Encrypt, HSTS de 1 año, renovación automática por certbot |
| Nginx | `limit_req` 10 r/s en la API y 1 r/s en el login; `server_tokens off`; `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| SSH | Sin root, sin contraseña, solo clave pública, `MaxAuthTries 3` |
| Aplicación | JWT de 8 h, bcrypt coste 10, bloqueo tras 5 intentos fallidos, validación Zod, Helmet, CORS restringido al dominio |
| Base de datos | Tres roles separados (DBA / dueño / runtime); `gymapp` sin DDL ni acceso a `crear_staff` |
| Sistema | `unattended-upgrades`, systemd hardening, usuario `gymapp` sin shell |
| Secretos | Fuera del repositorio: `/etc/gym-manager/api.env` (640) y GitHub Secrets |

---

## 6.3 Logs y su revisión

| Fuente | Ruta / comando | Contenido |
|---|---|---|
| API | `journalctl -u gym-api` | Peticiones (Morgan), errores, arranque y apagado |
| Nginx acceso | `/var/log/nginx/gym-manager.access.log` | Tráfico HTTP, códigos de estado |
| Nginx error | `/var/log/nginx/gym-manager.error.log` | Fallos de proxy y de TLS |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` | Consultas lentas, errores del motor |
| Respaldos | `/var/log/gym-manager/backup.log` | Resultado de cada respaldo diario |
| Mantenimiento | `/var/log/gym-manager/mantenimiento.log` | Vencimiento diario de membresías |
| Firewall | `/var/log/ufw.log` | Paquetes bloqueados |
| fail2ban | `fail2ban-client status sshd` | IPs baneadas |
| **Auditoría de negocio** | Tabla `gimnasio.auditoria` / `GET /api/reportes/auditoria` | Quién hizo qué, cuándo y desde qué IP |

Rotación: `logrotate` semanal, 8 rotaciones, comprimidas (`/etc/logrotate.d/gym-manager`);
`journald` limitado por la configuración del sistema.

### Comandos de revisión rápida

```bash
journalctl -u gym-api --since "24 hours ago" -p err     # errores del día
grep -c ' 500 ' /var/log/nginx/gym-manager.access.log   # errores 5xx
grep -i 'error' /var/log/gym-manager/backup.log         # fallos de respaldo
sudo ufw status numbered                                # reglas activas
sudo fail2ban-client status sshd                        # ataques bloqueados
df -h /var                                              # espacio disponible
```

---

## 6.4 Calendario de mantenimiento

| Frecuencia | Tarea | Responsable |
|---|---|---|
| Diaria (automática) | Respaldo 02:30 · vencimiento de membresías 00:05 · parches de seguridad | cron / unattended-upgrades |
| Diaria (manual, 5 min) | Revisar `journalctl -u gym-api -p err` y el log de respaldos | Administrador |
| Semanal | Revisar accesos 4xx/5xx en Nginx, IPs baneadas y uso de disco | Administrador |
| Mensual | **Prueba de restauración** en base temporal · `apt upgrade` completo · revisar `gimnasio.auditoria` | Administrador |
| Trimestral | Rotar la clave SSH de despliegue y el `JWT_SECRET` · revisar cuentas de staff inactivas | Administrador |
| Anual | Revisión de la versión de Ubuntu/Node/PostgreSQL y plan de actualización | Administrador |

---

## 6.5 Procedimientos de incidente

### La aplicación no responde
```bash
systemctl status gym-api                 # ¿el servicio está caído?
journalctl -u gym-api -n 100 --no-pager  # ¿por qué?
systemctl status postgresql              # ¿la base está arriba?
curl -fsS http://127.0.0.1:4000/api/health
nginx -t && systemctl status nginx
df -h && free -m                         # ¿disco o memoria agotados?
```

### Sospecha de acceso no autorizado
1. `sudo fail2ban-client status sshd` y `last -20` para revisar accesos.
2. `SELECT * FROM gimnasio.auditoria ORDER BY creado_en DESC LIMIT 100;`
3. Rotar `JWT_SECRET` en `/etc/gym-manager/api.env` y reiniciar (invalida todas las sesiones).
4. Restablecer las contraseñas del staff y revocar la clave SSH comprometida.

### Pérdida o corrupción de datos
1. Detener la API: `sudo systemctl stop gym-api`.
2. Identificar el respaldo válido más reciente en `/var/backups/gym-manager`.
3. `sudo -u postgres /usr/local/bin/gym-restore-db.sh <archivo.dump>`.
4. Verificar (`SELECT COUNT(*) FROM gimnasio.socios;`) y reiniciar la API.
5. Documentar el incidente y la ventana de datos perdida.
