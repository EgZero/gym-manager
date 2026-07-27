# GymManager

Sistema de gestión de gimnasio con **SPA React**, **API Node/Express**, **PostgreSQL** y
**despliegue automatizado en VPS** mediante GitHub Actions (SSH + rsync).

Trabajo práctico: *Despliegue Automatizado y Administración de Servicios en VPS*.

---

## Funcionalidades

- **Dos perfiles de acceso**: administrador y operador (las cuentas se crean **solo desde
  PostgreSQL**, según el requerimiento).
- **Socios**: alta, edición, baja, búsqueda, baneo y desbaneo.
- **Planes de mensualidad**: CRUD de precios con histórico de cambios.
- **Promociones**: descuento por porcentaje o monto fijo, con vigencia y cupo de usos.
- **Asistencias**: check-in por documento; los días del plan corren por calendario, asista o no
  el socio, y se muestran **días transcurridos, asistidos, faltados y restantes**.
- **Puntos de membresía**: se acumulan por compra y asistencia, y se canjean por **productos** o
  por un **plan gratis**.
- **Reportes**: tablero de KPIs, ingresos por plan y bitácora de auditoría.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/INFORME.md`](docs/INFORME.md) | **Informe técnico completo** |
| [`docs/01-requerimientos.md`](docs/01-requerimientos.md) | Requerimientos, casos de uso y reglas de negocio |
| [`docs/02-base-de-datos.md`](docs/02-base-de-datos.md) | MER, diccionario de datos y migraciones |
| [`docs/03-arquitectura.md`](docs/03-arquitectura.md) | Diagrama de red, arquitectura y API REST |
| [`docs/04-provisionamiento.md`](docs/04-provisionamiento.md) | Bitácora de instalación del VPS |
| [`docs/05-cicd.md`](docs/05-cicd.md) | Pipeline de integración y despliegue continuo |
| [`docs/06-mantenimiento-seguridad.md`](docs/06-mantenimiento-seguridad.md) | Respaldos, firewall, logs y mantenimiento |

---

## Desarrollo local

### Requisitos
Node.js 20+ y PostgreSQL 16 (o Docker).

```bash
git clone https://github.com/EgZero/gym-manager.git
cd gym-manager

# 1) Base de datos (con Docker)
docker compose up -d

# 2) Backend
cd backend
cp .env.example .env          # ajuste DATABASE_URL si es necesario
npm install
npm run migrate               # crea el esquema
npm run seed                  # datos de demostración
npm run dev                   # http://127.0.0.1:4000

# 3) Frontend (en otra terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### Credenciales de demostración (solo desarrollo)

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador | `admin` | `Admin.2026` |
| Operador | `operador` | `Operador.2026` |

> Estas cuentas provienen de los seeds y **no deben usarse en producción**. En el VPS las cuentas
> se crean con `gimnasio.crear_staff(...)` desde `psql`.

### Comandos de verificación

```bash
cd backend  && npm run lint && npm run typecheck && npm test
cd frontend && npm run lint && npm run build
```

---

## Despliegue en el VPS

```bash
# En el servidor, una sola vez
sudo DOMINIO=gym.midominio.com bash deploy/scripts/provision.sh

# Cargar la llave pública de despliegue en /home/deploy/.ssh/authorized_keys
# Configurar en GitHub → Settings → Secrets and variables → Actions:
#   VPS_HOST · VPS_USER · VPS_SSH_KEY · VPS_PORT (opcional)
#   Variable: URL_PUBLICA

# Crear el administrador (única vía autorizada)
sudo -u postgres psql -d gymdb -c \
  "SELECT gimnasio.crear_staff('admin','SuClaveSegura','Nombre Apellido','ADMINISTRADOR');"
```

A partir de ahí, cada `push` a `main` despliega automáticamente: pruebas → build → rsync →
migraciones → reinicio → healthcheck (con rollback automático si falla).

---

## Estructura

```
backend/    API Express + TypeScript, migraciones SQL y pruebas de integración
frontend/   SPA React + Vite + TypeScript
deploy/     Nginx, systemd y scripts de provisión, firewall, respaldo y despliegue
docs/       Informe técnico
.github/    Workflows de CI y CD
```

---

## Stack

Nginx · Node.js 20 · Express · TypeScript · PostgreSQL 16 · React 18 · Vite · JWT · bcrypt ·
Zod · GitHub Actions · systemd · UFW · fail2ban · Let's Encrypt
