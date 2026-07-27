# 3. Diseño de la Infraestructura y Arquitectura

---

## 3.1 Diagrama de red

```
                            INTERNET
                                │
                                │  DNS: gym.midominio.com  →  IP pública del VPS
                                ▼
                 ╔══════════════════════════════════╗
                 ║      FIREWALL UFW (host)         ║
                 ║  deny incoming / allow outgoing  ║
                 ║  ✔ 22/tcp  SSH (rate-limited)    ║
                 ║  ✔ 80/tcp  HTTP → redirige 443   ║
                 ║  ✔ 443/tcp HTTPS                 ║
                 ║  ✘ 5432/tcp PostgreSQL (DENY)    ║
                 ╚══════════════╤═══════════════════╝
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                       VPS Linux (Ubuntu 22.04 LTS)                  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Nginx  :80 / :443        (servidor web + proxy inverso)      │  │
│  │  · TLS Let's Encrypt, HSTS y cabeceras de seguridad           │  │
│  │  · SPA estática:  /var/www/gym-manager/frontend  (try_files)  │  │
│  │  · limit_req: 10 r/s API · 1 r/s en /api/auth/login           │  │
│  │  · /api/*  →  proxy_pass http://127.0.0.1:4000                │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │ loopback (no expuesto)           │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │  gym-api.service  ·  Node.js 20 + Express  ·  127.0.0.1:4000  │  │
│  │  usuario: gymapp (nologin) · systemd hardening · Restart=always│ │
│  │  JWT · bcrypt · Helmet · Zod · rate limit · auditoría          │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │ loopback (no expuesto)           │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │  PostgreSQL 16  ·  listen_addresses = 'localhost'             │  │
│  │  BD gymdb · esquema gimnasio                                  │  │
│  │  roles: postgres (DBA) · gymowner (DDL) · gymapp (runtime)    │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │ pg_dump -Fc diario 02:30         │
│                        /var/backups/gym-manager  (chmod 700)        │
│                                                                     │
│  Servicios de soporte: fail2ban · logrotate · unattended-upgrades   │
└─────────────────────────────────────────────────────────────────────┘
              ▲
              │ SSH (clave ED25519) + rsync
              │
    ┌─────────┴──────────┐
    │  GitHub Actions    │  ← push a main
    │  runner ubuntu-24  │
    └────────────────────┘
```

---

## 3.2 Componentes instalados

| Componente | Versión | Rol en la arquitectura | Puerto |
|---|---|---|---|
| Ubuntu Server | 22.04 / 24.04 LTS | Sistema operativo del VPS | — |
| Nginx | 1.24+ | Servidor web, TLS, archivos estáticos, proxy inverso, rate limiting | 80, 443 |
| Node.js | 20 LTS | Runtime del servidor de aplicaciones | — |
| Express | 4.x | Framework HTTP de la API REST | 4000 (loopback) |
| PostgreSQL | 16 | Base de datos relacional | 5432 (loopback) |
| systemd | — | Supervisión del proceso, arranque automático, reinicio ante fallos | — |
| UFW | — | Firewall de host | — |
| fail2ban | — | Bloqueo de IPs por fuerza bruta en SSH y Nginx | — |
| certbot | — | Emisión y renovación automática de certificados TLS | — |
| cron | — | Respaldos diarios y vencimiento de membresías | — |
| logrotate | — | Rotación y compresión de logs | — |

---

## 3.3 Arquitectura de la aplicación

### Capas

```
SPA React (navegador)
   │  fetch + JWT en Authorization: Bearer
   ▼
Nginx  ── archivos estáticos ─┐
   │  /api/*                  │
   ▼                          │
Express (rutas)               │  El navegador nunca habla
   │  middleware: auth, rol   │  directamente con la API
   ▼                          │  ni con PostgreSQL.
Validación Zod                │
   ▼                          │
Lógica de negocio / SQL ──────┘
   ▼
PostgreSQL (constraints, triggers, vistas)
```

La validación es **defensa en profundidad**: se valida en el formulario (UX), con Zod en la API
(contrato) y con `CHECK`/triggers en PostgreSQL (verdad última).

### Estructura del repositorio

```
gym-manager/
├── backend/
│   ├── db/migrations/         DDL versionado con checksum
│   ├── db/seeds/              Datos de demostración
│   └── src/
│       ├── app.ts             Express, middlewares globales, /api/health
│       ├── server.ts          Arranque y apagado ordenado (SIGTERM)
│       ├── config.ts          Configuración centralizada por entorno
│       ├── db.ts              Pool de conexiones y helper de transacciones
│       ├── middleware/        auth (JWT/roles) y manejo de errores
│       └── routes/            auth, staff, socios, planes, promociones,
│                              membresias, asistencias, productos, puntos, reportes
├── frontend/src/
│   ├── api/                   Cliente HTTP tipado y tipos compartidos
│   ├── components/            Layout y componentes reutilizables
│   └── pages/                 Login, Tablero, Socios, FichaSocio, Asistencias,
│                              Planes, Promociones, Productos, Operadores, Reportes
├── deploy/
│   ├── nginx/                 Configuración del sitio (HTTP y HTTPS)
│   ├── systemd/               Unidad gym-api.service
│   ├── docker/                Inicialización de PostgreSQL para desarrollo
│   └── scripts/               provision · setup-firewall · backup · restore · post-deploy
├── .github/workflows/         ci.yml y deploy.yml
└── docs/                      Informe técnico
```

---

## 3.4 API REST

Todas las rutas requieren `Authorization: Bearer <jwt>` salvo `/api/health` y `/api/auth/login`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/api/health` | público | Estado de la API y de la BD (usado por CI/CD y monitoreo) |
| POST | `/api/auth/login` | público | Autenticación, devuelve JWT |
| GET | `/api/auth/perfil` | ambos | Datos de la sesión actual |
| POST | `/api/auth/cambiar-password` | ambos | Cambio de contraseña propia |
| POST | `/api/staff` | — | **403 siempre**: el alta solo se hace desde PostgreSQL |
| GET | `/api/staff` · `/api/staff/:id` | admin | Listado y detalle del personal |
| PUT | `/api/staff/:id` | admin | Editar datos de un operador |
| PATCH | `/api/staff/:id/estado` | admin | Activar / desactivar operador |
| POST | `/api/staff/:id/reset-password` | admin | Restablecer contraseña de un operador |
| GET | `/api/socios` | ambos | Listado paginado con búsqueda, filtros y días asistidos/faltados |
| GET | `/api/socios/:id` | ambos | Ficha completa (membresías, puntos, asistencias) |
| GET | `/api/socios/documento/:doc` | ambos | Búsqueda para el check-in |
| POST | `/api/socios` | ambos | Registrar socio (**RF: el operador puede**) |
| PUT | `/api/socios/:id` | ambos | Actualizar socio |
| DELETE | `/api/socios/:id` | admin | Eliminar (físico si no tiene historial, lógico si lo tiene) |
| PATCH | `/api/socios/:id/reactivar` | admin | Reactivar socio dado de baja |
| POST | `/api/socios/:id/banear` · `/desbanear` | admin | Gestión de baneos |
| GET/POST/PUT/DELETE | `/api/planes` | lectura ambos · escritura admin | CRUD de mensualidades y costos |
| GET/POST/PUT/DELETE | `/api/promociones` | lectura ambos · escritura admin | CRUD de promociones |
| GET/POST/PUT/DELETE | `/api/productos` | lectura ambos · escritura admin | CRUD de productos canjeables |
| POST | `/api/membresias` | ambos | Vender membresía (aplica promoción, registra pago y puntos) |
| GET | `/api/membresias` | ambos | Listado de membresías |
| POST | `/api/membresias/:id/cancelar` | admin | Cancelación administrativa |
| POST | `/api/asistencias` | ambos | Check-in por documento o `socio_id` |
| GET | `/api/asistencias` · `/api/asistencias/hoy` | ambos | Consulta de asistencias |
| DELETE | `/api/asistencias/:id` | admin | Corrección de un registro erróneo |
| GET | `/api/puntos/socio/:id` | ambos | Saldo y movimientos |
| POST | `/api/puntos/canjear/producto` | ambos | Canje por producto (descuenta stock) |
| POST | `/api/puntos/canjear/plan` | ambos | Canje por plan gratis |
| POST | `/api/puntos/ajuste` | admin | Ajuste manual con motivo obligatorio |
| GET | `/api/reportes/tablero` | ambos | KPIs (ingresos solo para administrador) |
| GET | `/api/reportes/ingresos` | admin | Ingresos por plan en un rango |
| GET | `/api/reportes/auditoria` | admin | Bitácora de acciones |

### Contrato de errores

```json
{ "error": { "mensaje": "El documento ya está registrado", "codigo": "DUPLICADO" } }
```

| Código HTTP | Situación |
|---|---|
| 400 | Validación Zod fallida o regla de negocio violada |
| 401 | Sin token, token inválido o expirado |
| 403 | Rol insuficiente / alta de staff por API |
| 404 | Recurso inexistente |
| 409 | Conflicto (duplicado, membresía vigente, asistencia repetida) |
| 429 | Límite de peticiones excedido |
| 500 | Error interno (detalle solo en los logs, nunca al cliente) |

---

## 3.5 Matriz de permisos

| Acción | DBA (psql) | Administrador | Operador |
|---|:---:|:---:|:---:|
| Crear administradores u operadores | ✅ | ❌ | ❌ |
| Editar / activar / desactivar operadores | ✅ | ✅ | ❌ |
| Registrar y editar socios | ✅ | ✅ | ✅ |
| Eliminar socios | ✅ | ✅ | ❌ |
| Banear / desbanear socios | ✅ | ✅ | ❌ |
| Crear y modificar planes y precios | ✅ | ✅ | ❌ |
| Crear y modificar promociones | ✅ | ✅ | ❌ |
| Crear y modificar productos | ✅ | ✅ | ❌ |
| Vender membresías y registrar pagos | ✅ | ✅ | ✅ |
| Registrar asistencias | ✅ | ✅ | ✅ |
| Eliminar asistencias | ✅ | ✅ | ❌ |
| Canjear puntos | ✅ | ✅ | ✅ |
| Ajustar puntos manualmente | ✅ | ✅ | ❌ |
| Ver reportes de ingresos y auditoría | ✅ | ✅ | ❌ |
