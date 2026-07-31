# Informe Técnico — GymManager
## Despliegue Automatizado y Administración de Servicios en VPS

**Autor:** Angel Orellana (EgZero)
**Proyecto:** Sistema de gestión de gimnasio (SPA + API + PostgreSQL) con CI/CD hacia un VPS Linux
**Repositorio:** `gym-manager`

---

## Índice

| Sección | Documento |
|---|---|
| 1. Levantamiento de requerimientos | [`01-requerimientos.md`](01-requerimientos.md) |
| 2. Diseño de la base de datos | [`02-base-de-datos.md`](02-base-de-datos.md) |
| 3. Diseño de la infraestructura y arquitectura | [`03-arquitectura.md`](03-arquitectura.md) |
| 4. Proceso de provisionamiento (bitácora) | [`04-provisionamiento.md`](04-provisionamiento.md) |
| 5. Configuración del pipeline CI/CD | [`05-cicd.md`](05-cicd.md) |
| 6. Plan de mantenimiento y seguridad | [`06-mantenimiento-seguridad.md`](06-mantenimiento-seguridad.md) |

---

## 1. Resumen ejecutivo

GymManager es un sistema de gestión de gimnasios construido siguiendo el **ciclo de vida del
desarrollo de software**: levantamiento de requerimientos → análisis → diseño de datos →
implementación → pruebas → despliegue → mantenimiento.

Funcionalmente resuelve la operación diaria de un gimnasio: dos perfiles de acceso
(**administrador** y **operador**), CRUD completo de socios, planes de mensualidad,
promociones y productos; control de asistencias con cómputo de **días asistidos y faltados**
sobre un plan que corre por calendario; sistema de **puntos de membresía** canjeables por
productos o por un plan gratis; y **baneo** de socios.

Técnicamente se despliega sobre un **VPS Linux** con **Nginx** (servidor web y proxy inverso),
**Node.js/Express** (servidor de aplicaciones) y **PostgreSQL 16** (base de datos), y se
actualiza de forma **totalmente automática** ante cada `push` a `main` mediante **GitHub
Actions** con **SSH + rsync**, incluyendo migraciones, healthcheck y **rollback automático**.

---

## 2. Metodología: ciclo de vida aplicado

| Fase | Entregable | Ubicación |
|---|---|---|
| **1. Requerimientos** | 11 requerimientos funcionales, 14 no funcionales, 10 reglas de negocio, 7 casos de uso, matriz de permisos y criterios de aceptación | `docs/01-requerimientos.md` |
| **2. Análisis y diseño de datos** | MER, diccionario de datos de 11 tablas, restricciones, triggers, vistas y funciones | `docs/02-base-de-datos.md` |
| **3. Diseño de arquitectura** | Diagrama de red, capas, estructura del repositorio, contrato de la API REST | `docs/03-arquitectura.md` |
| **4. Implementación** | API TypeScript (10 routers) + SPA React (10 vistas) + SQL versionado | `backend/`, `frontend/` |
| **5. Pruebas** | 21 pruebas de integración contra PostgreSQL real, lint y typecheck | `backend/tests/api.test.ts` |
| **6. Despliegue** | Scripts de provisión, Nginx, systemd, UFW y pipeline CI/CD | `deploy/`, `.github/workflows/` |
| **7. Mantenimiento** | Respaldos verificados, restauración, logs, rotación, calendario e incidentes | `docs/06-mantenimiento-seguridad.md` |

---

## 3. Diseño de la infraestructura

Diagrama de red completo y descripción de componentes: [`03-arquitectura.md §3.1–3.2`](03-arquitectura.md).

Resumen de la topología:

```
Internet → UFW (22/80/443) → Nginx (TLS, SPA, proxy) → 127.0.0.1:4000 Node/Express
                                                              → 127.0.0.1:5432 PostgreSQL
```

Ni el servidor de aplicaciones ni la base de datos son accesibles desde Internet: el **único**
punto de entrada de la aplicación es Nginx sobre HTTPS.

| Componente | Función |
|---|---|
| Nginx 1.24 | TLS, archivos estáticos de la SPA, proxy inverso `/api`, rate limiting, cabeceras de seguridad |
| Node.js 20 + Express | API REST, autenticación JWT, autorización por rol, reglas de negocio |
| PostgreSQL 16 | Persistencia, integridad referencial, triggers, vistas y auditoría |
| systemd | Supervisión, arranque automático, reinicio ante fallos, aislamiento del proceso |
| UFW + fail2ban | Filtrado de red y bloqueo de ataques por fuerza bruta |
| cron + pg_dump | Respaldos diarios verificados y vencimiento de membresías |

---

## 4. Proceso de provisionamiento

Bitácora completa: [`04-provisionamiento.md`](04-provisionamiento.md). Todo está automatizado en
un único script idempotente:

```bash
sudo DOMINIO=gym.midominio.com bash deploy/scripts/provision.sh
```

### Puertos abiertos

| Puerto | Servicio | Alcance |
|---|---|---|
| 22/tcp | SSH | Internet, con `ufw limit` + fail2ban |
| 80/tcp | Nginx HTTP | Internet (redirige a HTTPS) |
| 443/tcp | Nginx HTTPS | Internet |
| 4000/tcp | API Node | Solo loopback |
| 5432/tcp | PostgreSQL | Solo loopback, denegado explícitamente en UFW |

### Usuarios y permisos

| Usuario | Tipo | Privilegios |
|---|---|---|
| `gymapp` | Sistema, `nologin` | Ejecuta la API. Sin shell, sin sudo. |
| `deploy` | Sistema, con shell | Recibe el rsync. Sudo limitado a 5 comandos de systemd/nginx. |
| `postgres` | Sistema | DBA. Único que crea cuentas de staff y ejecuta respaldos. |
| `gymowner` | Rol de BD | Dueño del esquema. Solo para migraciones. |
| `gymapp` | Rol de BD | DML sobre las tablas. Sin DDL, sin `crear_staff`. |
| `ADMINISTRADOR` | Rol de aplicación | Planes, precios, promociones, socios, operadores, reportes |
| `OPERADOR` | Rol de aplicación | Socios, ventas, asistencias, canjes |

Los archivos con secretos (`/etc/gym-manager/api.env`) tienen permisos `640 root:gymapp` y
**nunca** se versionan.

---

## 5. Configuración del pipeline CI/CD

Detalle completo: [`05-cicd.md`](05-cicd.md).

**Disparador:** `push` a la rama `main`.

**Integración continua** (`ci.yml`) — bloquea el despliegue si algo falla:
lint → typecheck → build → migraciones → seed → 21 pruebas de integración contra un servicio
PostgreSQL 16 real; build de la SPA; `shellcheck` de los scripts de servidor.

**Despliegue continuo** (`deploy.yml`):

1. Compila el backend (`tsc`) y poda dependencias de desarrollo (`npm prune --omit=dev`).
2. Compila la SPA (`vite build`).
3. Empaqueta `dist` + `node_modules` + migraciones + `post-deploy.sh`.
4. Autentica por SSH con clave dedicada guardada en GitHub Secrets.
5. `rsync -az --delete` del backend y de la SPA al VPS.
6. En el VPS: aplica migraciones → `systemctl restart gym-api` → sondea `/api/health`.
7. Si el healthcheck falla: **rollback automático** al release anterior y job en rojo.
8. Verificación pública del healthcheck y borrado de la clave privada del runner.

Resultado: **cero intervención manual**. Un cambio local llega a producción con solo hacer push.

---

## 6. Plan de mantenimiento y seguridad

Detalle completo: [`06-mantenimiento-seguridad.md`](06-mantenimiento-seguridad.md).

### Respaldos (RPO 24 h · RTO < 15 min)

- `pg_dump -Fc --compress=9` diario a las 02:30 por cron.
- **Verificación de cada respaldo** con `pg_restore --list` y checksum SHA-256.
- Retención: 14 días de diarios y 120 días de copias semanales.
- Permisos `600` en archivos y `700` en el directorio.
- Restauración guiada por `restore-db.sh`, con respaldo previo automático.
- Prueba mensual de restauración documentada como tarea obligatoria.

### Políticas de firewall

`deny incoming` por defecto; solo 22 (con limitación de tasa), 80 y 443 abiertos; 5432 denegado
explícitamente. Refuerzo con fail2ban en SSH y Nginx, y `limit_req` en Nginx (1 r/s en el login).

### Logs

`journalctl -u gym-api`, logs de acceso y error de Nginx, log de PostgreSQL, logs de respaldo y
mantenimiento, log de UFW y la tabla de auditoría `gimnasio.auditoria` (quién, qué, cuándo y desde
qué IP). Rotación semanal comprimida con 8 retenciones.

---

## 7. Evidencia de pruebas

### Pruebas automatizadas (backend)

```
$ npm run typecheck   → sin errores
$ npm run lint        → sin advertencias
$ npm run migrate     → 2 migraciones aplicadas
$ npm test

# tests 21
# pass 21
# fail 0
```

Cobertura funcional de las pruebas:

| Área | Casos verificados |
|---|---|
| Salud | `/api/health` responde con la base conectada |
| Autenticación | Login válido, credenciales incorrectas, rutas protegidas sin token |
| Regla del enunciado | `POST /api/staff` devuelve **403** (alta solo desde PostgreSQL) |
| Autorización | El operador no puede crear planes ni ver reportes de ingresos |
| Planes | Alta, edición, histórico de precios, baja lógica cuando hay historial |
| Socios | Alta, documento duplicado, edición, baja lógica, reactivación |
| Membresías | Venta con y sin promoción, rechazo de doble membresía vigente |
| Asistencias | Check-in, cálculo de días restantes, rechazo de asistencia duplicada |
| Puntos | Acreditación, ajuste manual, canje, rechazo por saldo insuficiente |
| Baneos | Banear, impedir operaciones y desbanear |
| Reportes | El tablero del operador oculta los ingresos; el del administrador los muestra |

### Verificación del frontend

```
$ npm run lint    → sin advertencias
$ npm run build   → tsc -b && vite build, 47 módulos, build correcto
```

### Verificación de la infraestructura

Lista de comprobación ejecutable en `docs/04-provisionamiento.md §4.5`.

> **Nota sobre el estado del despliegue:** el VPS aún no ha sido contratado. Todo el
> provisionamiento, la configuración de servicios y el pipeline están escritos, versionados y
> listos para ejecutarse; el despliegue real se completa ejecutando `provision.sh` en el servidor
> y cargando los cuatro secretos en GitHub.

---
## 9. Decisiones de ingeniería destacadas

1. **«Solo postgres crea staff»** se implementó de verdad, no por convención: la función
   `gimnasio.crear_staff()` es `SECURITY DEFINER`, el rol de runtime no tiene `EXECUTE` sobre
   ella y el endpoint HTTP devuelve `403` explicando el procedimiento correcto.
2. **Puntos como libro mayor** en vez de un campo de saldo: cada movimiento es auditable, el
   saldo es `SUM(puntos)` y un trigger impide que quede negativo, incluso con escrituras
   concurrentes.
3. **Días por calendario**: el enunciado exige que los días corran vaya o no el socio. Se calcula
   sobre fechas en `vw_socios_estado`, y las faltas son `días_transcurridos − asistencias`.
4. **Precios congelados** en la membresía vendida: cambiar el precio de un plan no reescribe la
   historia contable; los cambios quedan en `historial_precios_plan`.
5. **Migraciones con checksum**: si alguien edita una migración ya aplicada, el runner aborta el
   despliegue en lugar de dejar el esquema en un estado ambiguo.
6. **Rollback automático**: el despliegue no se considera exitoso hasta que `/api/health`
   responde; si no lo hace, el release anterior vuelve a estar en línea en segundos.
7. **Build en el runner, no en el VPS**: el servidor no necesita compiladores ni dependencias de
   desarrollo, lo que reduce superficie de ataque, uso de RAM y tiempo de despliegue.
