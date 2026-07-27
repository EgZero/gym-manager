# 5. Configuración del Pipeline CI/CD

**Plataforma:** GitHub Actions · **Disparador:** `push` a `main` · **Transporte:** SSH + rsync

---

## 5.1 Flujo completo

```
  Desarrollador
       │ git push origin main
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  .github/workflows/deploy.yml                                        │
│                                                                      │
│  job: ci  (reutiliza .github/workflows/ci.yml)                       │
│   ├── backend  · npm ci → lint → typecheck → build → migrate →       │
│   │              seed → test (21 pruebas contra PostgreSQL 16 real)  │
│   ├── frontend · npm ci → lint → vite build → artefacto              │
│   └── scripts  · shellcheck sobre deploy/scripts/*.sh                │
│                          │                                           │
│                   ¿todo verde?                                       │
│              NO ─────────┴──────────► ⛔ se detiene, el VPS no cambia │
│              SÍ                                                      │
│                          ▼                                           │
│  job: deploy  (environment: produccion)                              │
│   1. Build de backend (tsc) y `npm prune --omit=dev`                 │
│   2. Build de la SPA (vite)                                          │
│   3. Empaquetado: dist + node_modules + db/ + post-deploy.sh         │
│   4. Carga de la clave SSH y `ssh-keyscan` del host                  │
│   5. rsync -az --delete  →  /var/www/gym-manager/backend             │
│   6. rsync -az --delete  →  /var/www/gym-manager/frontend            │
│   7. ssh → post-deploy.sh:                                           │
│         migraciones · systemctl restart gym-api · healthcheck        │
│         └── si falla ► ROLLBACK al release anterior + reinicio       │
│   8. Verificación pública de /api/health                             │
│   9. Borrado de la clave privada del runner                          │
└──────────────────────────────────────────────────────────────────────┘
       ▼
   VPS actualizado sin intervención manual
```

---

## 5.2 Workflow de Integración Continua (`ci.yml`)

Se ejecuta en cada `push` a `main`, en cada Pull Request y como workflow reutilizable
llamado por el de despliegue.

| Job | Pasos | Propósito |
|---|---|---|
| `backend` | `npm ci` → `lint` → `typecheck` → `build` → `migrate` → `seed` → `test` | Levanta un **servicio PostgreSQL 16** real con healthcheck y ejecuta las 21 pruebas de integración sobre la API completa. |
| `frontend` | `npm ci` → `lint` → `vite build` → `upload-artifact` | Garantiza que la SPA compila sin errores de tipos y publica el artefacto. |
| `scripts` | `shellcheck --severity=warning deploy/scripts/*.sh` | Evita desplegar scripts de servidor con errores de shell. |

Las dependencias se cachean por `package-lock.json`, y `npm ci` garantiza instalaciones
deterministas (no `npm install`).

---

## 5.3 Workflow de Despliegue Continuo (`deploy.yml`)

### Condiciones de ejecución
- `push` a `main` (automático — requisito de la rúbrica).
- `workflow_dispatch` (re-despliegue manual desde la interfaz de GitHub).
- `concurrency: deploy-produccion` con `cancel-in-progress: false`: nunca hay dos despliegues
  simultáneos escribiendo en el VPS.
- `needs: ci`: **es imposible desplegar código que no pasó las pruebas.**

### Paquete que viaja al VPS

| Se envía | No se envía |
|---|---|
| `backend/dist` (JavaScript compilado) | Código fuente TypeScript |
| `backend/node_modules` (solo producción, tras `npm prune`) | Dependencias de desarrollo |
| `backend/db` (migraciones y seeds) | `.env` (vive solo en el VPS) |
| `backend/package.json`, `package-lock.json` | Pruebas, documentación, `.git` |
| `deploy/post-deploy.sh` | |
| `frontend/dist` (HTML, CSS y JS con hash) | |

`rsync -az --delete` transfiere solo los bloques modificados y elimina archivos huérfanos del
release anterior, dejando el directorio idéntico al paquete construido.

### Pasos remotos (`deploy/scripts/post-deploy.sh`)

1. Carga `/etc/gym-manager/api.env`.
2. `node dist/db/migrate.js` — aplica migraciones pendientes (idempotente, con checksum).
3. `sudo systemctl restart gym-api`.
4. Sondea `http://127.0.0.1:4000/api/health` hasta 15 veces con 2 s de espera.
5. **Éxito:** guarda el release actual en `/var/www/gym-manager/.release-anterior`.
6. **Fallo:** vuelca `journalctl -u gym-api`, restaura `.release-anterior` con rsync, reinicia
   y sale con código 1 (el job de GitHub aparece en rojo).

---

## 5.4 Secretos y variables

Configurar en **Settings → Secrets and variables → Actions**.

### Secrets (cifrados, nunca visibles en los logs)

| Nombre | Ejemplo | Descripción |
|---|---|---|
| `VPS_HOST` | `203.0.113.25` | IP o dominio del VPS |
| `VPS_USER` | `deploy` | Usuario de despliegue (nunca `root`) |
| `VPS_PORT` | `22` | Puerto SSH (opcional, por defecto 22) |
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | Clave **privada** ED25519 de despliegue |

### Variables (públicas)

| Nombre | Ejemplo | Uso |
|---|---|---|
| `URL_PUBLICA` | `https://gym.midominio.com` | Verificación externa del healthcheck tras el deploy |

### Generación del par de claves

```bash
# En su máquina local
ssh-keygen -t ed25519 -C "github-actions-gym-manager" -f ~/.ssh/gym_deploy -N ""

# La PÚBLICA va al VPS
ssh-copy-id -i ~/.ssh/gym_deploy.pub deploy@203.0.113.25
# o manualmente en /home/deploy/.ssh/authorized_keys

# La PRIVADA se pega íntegra (incluidas las líneas BEGIN/END) en el secret VPS_SSH_KEY
cat ~/.ssh/gym_deploy
```

Buenas prácticas aplicadas:
- La clave privada **nunca** se versiona (`.gitignore` bloquea `*.pem`, `id_ed25519*`).
- Es una clave **dedicada** al pipeline; se puede revocar sin afectar al acceso personal.
- `ssh-keyscan` fija el host en `known_hosts` y se usa `StrictHostKeyChecking=yes`.
- El paso final borra `~/.ssh/id_deploy` del runner incluso si el job falló (`if: always()`).
- El usuario `deploy` tiene sudo limitado a cinco comandos concretos.

---

## 5.5 Estrategia de build

| Etapa | Dónde | Comando | Resultado |
|---|---|---|---|
| Backend | Runner de GitHub | `tsc -p tsconfig.json` | `dist/*.js` |
| Dependencias | Runner | `npm ci && npm prune --omit=dev` | `node_modules` mínimo |
| Frontend | Runner | `tsc -b && vite build` | `dist/` con hashes de contenido |
| Migraciones | VPS | `node dist/db/migrate.js` | Esquema al día |

El build ocurre **en el runner**, no en el VPS: el servidor no necesita compiladores ni
herramientas de desarrollo, lo que reduce la superficie de ataque y el consumo de recursos.

---

## 5.6 Verificación del despliegue

```bash
# Desde cualquier lugar
curl -fsS https://gym.midominio.com/api/health
# {"estado":"ok","base_datos":"conectada","entorno":"production","version":"<sha>","hora":"..."}

# En el VPS
systemctl status gym-api
journalctl -u gym-api -f
cat /var/www/gym-manager/backend/VERSION   # commit desplegado
```

El campo `version` del healthcheck devuelve el SHA del commit, de modo que se puede confirmar
que el VPS ejecuta exactamente el código de `main`.

---

## 5.7 Rollback

| Escenario | Mecanismo |
|---|---|
| El servicio no levanta tras el deploy | Automático: `post-deploy.sh` restaura `.release-anterior` |
| Bug detectado más tarde | `git revert <sha> && git push` → el pipeline despliega la corrección |
| Datos corruptos | `sudo -u postgres /usr/local/bin/gym-restore-db.sh <archivo.dump>` |
| Emergencia manual | `sudo systemctl stop gym-api` + restaurar desde `/var/www/gym-manager/.release-anterior` |

Las migraciones son **aditivas** por política: no se eliminan columnas en el mismo despliegue en
que se deja de usarlas, de modo que el release anterior siga siendo compatible con el esquema.

---

## 5.8 Prueba del pipeline (evidencia para la rúbrica)

1. Modificar un texto visible de la SPA (por ejemplo, el título del tablero).
2. `git commit -am "prueba de pipeline" && git push origin main`.
3. Observar en la pestaña **Actions** los jobs `ci` y luego `deploy` en verde.
4. Recargar `https://gym.midominio.com` y comprobar el cambio, sin haber tocado el VPS.
5. Adjuntar como evidencia: captura de Actions, salida de `/api/health` con el nuevo SHA y
   captura de la SPA actualizada.
