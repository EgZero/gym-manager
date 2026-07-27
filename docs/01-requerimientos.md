# 1. Levantamiento de Requerimientos — GymManager

**Proyecto:** Sistema de gestión de gimnasio con despliegue automatizado en VPS
**Versión:** 1.0
**Autor:** Angel Orellana (EgZero)

---

## 1.1 Contexto y alcance

GymManager es una **Single Page Application (SPA)** que permite administrar la operación diaria
de un gimnasio: socios, planes de mensualidad, promociones, control de asistencias, puntos de
membresía y canjes. El sistema se despliega en un **VPS Linux** con stack **Nginx + Node.js +
PostgreSQL** y se actualiza automáticamente mediante un **pipeline CI/CD en GitHub Actions**.

### Dentro del alcance
- Autenticación con dos roles operativos: **administrador** y **operador**.
- CRUD completo de socios, planes, promociones, productos y asistencias.
- Motor de membresías: los días del plan se descuentan por calendario, asista o no el socio.
- Sistema de puntos de membresía y canjes (productos o plan gratis).
- Baneo/reactivación de socios.
- Despliegue automatizado, respaldos y hardening básico del servidor.

### Fuera del alcance
- Pasarela de pago en línea (los pagos se registran manualmente por caja).
- Aplicación móvil nativa.
- Facturación electrónica / fiscal.

---

## 1.2 Actores del sistema

| Actor | Descripción | Vía de alta |
|---|---|---|
| **PostgreSQL / DBA** | Persona con acceso al motor de base de datos. Es el **único** que puede crear cuentas de staff (administradores y operadores). | Acceso directo a `psql` |
| **Administrador** | Gestiona el negocio: planes, precios, promociones, productos, socios y operadores. Ve reportes completos. | Creado por el DBA en la BD |
| **Operador** | Personal de recepción. Registra socios, cobra mensualidades, marca asistencias y canjea puntos. | Creado por el DBA en la BD |
| **Socio (miembro)** | Cliente del gimnasio. **No** tiene login; es una entidad administrada por el staff. | Registrado por operador o administrador |

> **Regla dura del enunciado:** «solo el postgres puede crear más operadores o administradores».
> Se implementa con la función `gimnasio.crear_staff(...)` que **solo** se ejecuta desde `psql`
> con un rol privilegiado. La API expone `POST /api/staff` únicamente con respuesta `403` y un
> mensaje que indica el procedimiento correcto (ver `docs/02-base-de-datos.md`).

---

## 1.3 Requerimientos funcionales

### RF-01 Autenticación y sesión
| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-01.1 | El sistema debe permitir iniciar sesión con usuario y contraseña, devolviendo un JWT firmado. | Alta |
| RF-01.2 | El JWT debe incluir `sub`, `usuario`, `rol` y expirar en 8 horas. | Alta |
| RF-01.3 | Las contraseñas se almacenan con hash **bcrypt** (coste ≥ 10). Nunca en texto plano. | Alta |
| RF-01.4 | El sistema debe bloquear temporalmente (15 min) una cuenta tras 5 intentos fallidos consecutivos. | Media |
| RF-01.5 | Toda ruta distinta de `/api/auth/login` y `/api/health` exige JWT válido. | Alta |
| RF-01.6 | Un staff desactivado (`activo = false`) no puede iniciar sesión. | Alta |

### RF-02 Gestión de staff (operadores y administradores)
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-02.1 | Crear cuentas de staff **solo** vía PostgreSQL (`gimnasio.crear_staff`). | DBA | Alta |
| RF-02.2 | Listar staff con rol, estado y último acceso. | Admin | Alta |
| RF-02.3 | Actualizar nombre, correo y teléfono de un operador. | Admin | Alta |
| RF-02.4 | Activar / desactivar un operador (baja lógica). | Admin | Alta |
| RF-02.5 | Resetear la contraseña de un operador. | Admin | Media |
| RF-02.6 | Un administrador **no** puede desactivarse ni degradarse a sí mismo. | Admin | Alta |
| RF-02.7 | Un administrador **no** puede modificar ni desactivar a otro administrador. | Admin | Media |

### RF-03 Gestión de planes de mensualidad
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-03.1 | Crear plan con nombre, descripción, precio, duración en días y puntos otorgados. | Admin | Alta |
| RF-03.2 | Listar planes (activos e inactivos). | Admin / Operador | Alta |
| RF-03.3 | Actualizar precio y datos del plan. Los cambios **no** afectan membresías ya vendidas (el precio se congela en la venta). | Admin | Alta |
| RF-03.4 | Eliminar plan; si tiene membresías asociadas se realiza baja lógica (`activo = false`). | Admin | Alta |
| RF-03.5 | Registrar histórico de cambios de precio en `historial_precios_plan`. | Sistema | Media |

### RF-04 Gestión de promociones
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-04.1 | Crear promoción con código único, tipo (`PORCENTAJE`/`MONTO_FIJO`), valor, vigencia y usos máximos. | Admin | Alta |
| RF-04.2 | Asociar la promoción a un plan específico o dejarla global. | Admin | Media |
| RF-04.3 | Listar, actualizar y eliminar promociones (baja lógica si ya fue usada). | Admin | Alta |
| RF-04.4 | Al vender una membresía, validar vigencia, usos disponibles y aplicabilidad al plan. | Sistema | Alta |
| RF-04.5 | El descuento nunca puede dejar el precio final por debajo de 0. | Sistema | Alta |

### RF-05 Gestión de socios
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-05.1 | Registrar socio con documento único, nombres, apellidos, contacto y fecha de nacimiento. | Admin / Operador | Alta |
| RF-05.2 | Listar socios con búsqueda por nombre/documento, filtros por estado de membresía y paginación. | Admin / Operador | Alta |
| RF-05.3 | Ver ficha del socio: plan vigente, días transcurridos, días restantes, asistencias, inasistencias, puntos y estado de baneo. | Admin / Operador | Alta |
| RF-05.4 | Actualizar datos del socio. | Admin / Operador | Alta |
| RF-05.5 | Eliminar socio: baja lógica siempre que tenga historial; eliminación física solo si no tiene movimientos. | Admin | Alta |
| RF-05.6 | Banear socio con motivo y fecha; opcionalmente con fecha de fin de baneo. | Admin | Alta |
| RF-05.7 | Levantar el baneo de un socio. | Admin | Alta |
| RF-05.8 | Un socio baneado no puede registrar asistencia ni comprar membresías. | Sistema | Alta |

### RF-06 Membresías y control de días
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-06.1 | Vender membresía a un socio: plan, promoción opcional, fecha de inicio y método de pago. | Admin / Operador | Alta |
| RF-06.2 | La fecha de fin se calcula como `fecha_inicio + duracion_dias`. | Sistema | Alta |
| RF-06.3 | **Los días se consumen por calendario**, asista o no el socio: `dias_transcurridos = min(hoy, fecha_fin) - fecha_inicio`. | Sistema | Alta |
| RF-06.4 | `dias_restantes = max(0, fecha_fin - hoy)`; `dias_asistidos = COUNT(asistencias)`; `dias_faltados = dias_transcurridos - dias_asistidos`. | Sistema | Alta |
| RF-06.5 | Un socio no puede tener dos membresías `VIGENTE` solapadas. | Sistema | Alta |
| RF-06.6 | El estado se deriva: `VIGENTE`, `VENCIDA`, `CANCELADA`. | Sistema | Alta |
| RF-06.7 | Al vender una membresía se acreditan los puntos definidos en el plan. | Sistema | Alta |
| RF-06.8 | El precio pagado se congela en la membresía (`precio_lista`, `descuento`, `precio_final`). | Sistema | Alta |

### RF-07 Asistencias
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-07.1 | Registrar asistencia (check-in) buscando al socio por documento. | Admin / Operador | Alta |
| RF-07.2 | Rechazar el check-in si el socio está baneado o sin membresía vigente. | Sistema | Alta |
| RF-07.3 | Una sola asistencia por socio por día (restricción única). | Sistema | Alta |
| RF-07.4 | Listar asistencias del día y por socio, con rango de fechas. | Admin / Operador | Alta |
| RF-07.5 | Eliminar una asistencia mal registrada (corrección). | Admin | Media |

### RF-08 Puntos de membresía y canjes
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-08.1 | Los puntos se acreditan al comprar una membresía (`planes.puntos_otorgados`). | Sistema | Alta |
| RF-08.2 | Los puntos se acreditan por asistencia (`PUNTOS_POR_ASISTENCIA`, configurable). | Sistema | Media |
| RF-08.3 | El saldo de puntos es la suma del libro mayor `movimientos_puntos` (nunca un campo editable a mano). | Sistema | Alta |
| RF-08.4 | Canjear puntos por un producto del catálogo, descontando stock. | Admin / Operador | Alta |
| RF-08.5 | Canjear puntos por un plan gratis, generando una membresía con `precio_final = 0`. | Admin / Operador | Alta |
| RF-08.6 | Rechazar el canje si el saldo es insuficiente o no hay stock. | Sistema | Alta |
| RF-08.7 | Ajuste manual de puntos por parte del administrador, con motivo obligatorio. | Admin | Media |

### RF-09 Catálogo de productos canjeables
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-09.1 | CRUD de productos: nombre, descripción, costo en puntos, stock. | Admin | Alta |
| RF-09.2 | Listar productos disponibles para canje (activos y con stock). | Admin / Operador | Alta |

### RF-10 Reportes y tablero
| ID | Requerimiento | Rol | Prioridad |
|---|---|---|---|
| RF-10.1 | Tablero con socios activos, membresías por vencer (7 días), asistencias del día e ingresos del mes. | Admin | Alta |
| RF-10.2 | Tablero de operador con asistencias del día y accesos rápidos. | Operador | Alta |
| RF-10.3 | Reporte de ingresos por rango de fechas agrupado por plan. | Admin | Media |

### RF-11 Auditoría
| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-11.1 | Registrar en `auditoria` toda operación de escritura: actor, acción, entidad, id, datos previos/nuevos, IP y fecha. | Alta |
| RF-11.2 | La auditoría es de solo lectura para la aplicación (sin UPDATE/DELETE). | Media |

---

## 1.4 Requerimientos no funcionales

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Seguridad | Contraseñas con bcrypt; JWT firmado HS256; secretos solo por variables de entorno. |
| RNF-02 | Seguridad | HTTPS en producción (Let's Encrypt), cabeceras de seguridad con Helmet y HSTS en Nginx. |
| RNF-03 | Seguridad | Firewall UFW con política `deny incoming`; solo 22/tcp (limitado), 80/tcp y 443/tcp. PostgreSQL escucha solo en `127.0.0.1`. |
| RNF-04 | Seguridad | Rate limiting: 100 req/15 min global y 10 intentos/15 min en `/api/auth/login`. |
| RNF-05 | Seguridad | La aplicación corre bajo un usuario de sistema sin privilegios (`gymapp`), servicio systemd endurecido. |
| RNF-06 | Rendimiento | Respuesta < 300 ms en el percentil 95 para listados paginados (≤ 50 registros). |
| RNF-07 | Rendimiento | Índices en claves de búsqueda: documento, fechas de asistencia, estado de membresía. |
| RNF-08 | Disponibilidad | Servicio gestionado por systemd con `Restart=always`; Nginx como proxy inverso. |
| RNF-09 | Respaldo | Respaldo diario automático con `pg_dump` (formato custom), retención 14 días, verificación de integridad y restauración documentada. |
| RNF-10 | Mantenibilidad | Código en TypeScript, ESLint + Prettier, migraciones SQL versionadas e idempotentes. |
| RNF-11 | Trazabilidad | Logs de aplicación en journald y logs de acceso/error en Nginx, con logrotate. |
| RNF-12 | Portabilidad | Entorno local reproducible con Docker Compose idéntico al de producción. |
| RNF-13 | Usabilidad | SPA responsiva; mensajes de error claros en español. |
| RNF-14 | Despliegue | Todo push a `main` que pase CI se despliega solo, con salud verificada y rollback ante fallo. |

---

## 1.5 Reglas de negocio

| ID | Regla |
|---|---|
| RN-01 | Solo el DBA (acceso a PostgreSQL) crea cuentas de administrador u operador. |
| RN-02 | El administrador gestiona operadores y socios; el operador solo gestiona socios y operación diaria. |
| RN-03 | Los días del plan corren por calendario desde `fecha_inicio`, independientemente de la asistencia. |
| RN-04 | Un socio baneado no accede a las instalaciones ni compra membresías. |
| RN-05 | Los puntos se acreditan por compra de membresía y por asistencia; se debitan por canje. |
| RN-06 | El saldo de puntos jamás puede quedar negativo. |
| RN-07 | El precio de un plan se congela en la membresía vendida; cambiar el plan no reescribe el histórico. |
| RN-08 | Una promoción se valida por vigencia, cupo de usos y plan aplicable. |
| RN-09 | Una asistencia por socio por día. |
| RN-10 | Las entidades con historial no se borran físicamente: baja lógica. |

---

## 1.6 Casos de uso principales

### CU-01 Iniciar sesión
- **Actor:** Administrador / Operador
- **Precondición:** Cuenta creada por el DBA y activa.
- **Flujo:** 1) El actor ingresa usuario y contraseña → 2) el sistema valida el hash bcrypt →
  3) emite JWT y registra `ultimo_acceso` → 4) la SPA redirige al tablero según el rol.
- **Alternos:** credenciales inválidas (401 + incremento de contador); cuenta bloqueada (423); cuenta inactiva (403).

### CU-02 Registrar socio y vender membresía
- **Actor:** Operador
- **Flujo:** 1) Alta del socio con documento único → 2) selecciona plan y promoción opcional →
  3) el sistema calcula `precio_final` y `fecha_fin` → 4) crea la membresía `VIGENTE`,
  registra el pago y acredita puntos → 5) muestra el comprobante.
- **Alternos:** documento duplicado (409); socio baneado (409); promoción vencida o sin cupo (422).

### CU-03 Registrar asistencia
- **Actor:** Operador
- **Flujo:** 1) Busca al socio por documento → 2) el sistema valida baneo y membresía vigente →
  3) inserta la asistencia del día y acredita puntos → 4) muestra días restantes y asistencias.
- **Alternos:** ya registrado hoy (409); membresía vencida (409); socio baneado (409).

### CU-04 Canjear puntos
- **Actor:** Operador / Administrador
- **Flujo:** 1) Elige socio y recompensa (producto o plan gratis) → 2) el sistema valida saldo y stock →
  3) debita puntos, descuenta stock o genera la membresía gratuita → 4) registra el canje.
- **Alternos:** saldo insuficiente (422); sin stock (409).

### CU-05 Administrar costos y promociones
- **Actor:** Administrador
- **Flujo:** CRUD de planes y promociones; cada cambio de precio queda en `historial_precios_plan` y en `auditoria`.

### CU-06 Supervisar socios
- **Actor:** Administrador
- **Flujo:** Consulta la vista `vw_socios_estado` con plan contratado, días transcurridos/restantes,
  asistidos/faltados, puntos y estado de baneo; puede banear o levantar el baneo.

### CU-07 Administrar operadores
- **Actor:** Administrador
- **Flujo:** Lista operadores, edita datos, resetea contraseñas y activa/desactiva. **No** puede crearlos.

---

## 1.7 Matriz de permisos

| Operación | DBA | Administrador | Operador |
|---|:--:|:--:|:--:|
| Crear staff | ✔ | ✗* | ✗ |
| Listar / editar / activar operadores | ✔ | ✔ | ✗ |
| CRUD planes y precios | ✔ | ✔ | ✗ (solo lectura) |
| CRUD promociones | ✔ | ✔ | ✗ (solo lectura) |
| CRUD productos canjeables | ✔ | ✔ | ✗ (solo lectura) |
| Registrar / editar socios | ✔ | ✔ | ✔ |
| Eliminar socios | ✔ | ✔ | ✗ |
| Banear / desbanear socios | ✔ | ✔ | ✗ |
| Vender membresías y registrar pagos | ✔ | ✔ | ✔ |
| Registrar asistencias | ✔ | ✔ | ✔ |
| Eliminar asistencias | ✔ | ✔ | ✗ |
| Canjear puntos | ✔ | ✔ | ✔ |
| Ajuste manual de puntos | ✔ | ✔ | ✗ |
| Reportes financieros | ✔ | ✔ | ✗ |
| Ver auditoría | ✔ | ✔ | ✗ |

`✗` = 403 Forbidden. `✗*` = bloqueado por diseño en la API: la creación de staff solo se realiza vía `psql`.

---

## 1.8 Criterios de aceptación (trazabilidad con la rúbrica)

| Criterio de la rúbrica | Evidencia en el proyecto |
|---|---|
| Infraestructura | `deploy/scripts/provision.sh`, `deploy/nginx/`, `deploy/systemd/`, `docs/04-provisionamiento.md` |
| Despliegue y funcionalidad (CRUD) | Backend `backend/src/routes/*`, SPA `frontend/src/pages/*`, CRUD completo de socios/planes/promociones/productos/asistencias |
| Automatización CI/CD | `.github/workflows/ci.yml` y `.github/workflows/deploy.yml` (push a `main` → build + rsync + migraciones + healthcheck + rollback) |
| Seguridad y mantenimiento | `deploy/scripts/setup-firewall.sh`, `deploy/scripts/backup-db.sh`, `deploy/scripts/restore-db.sh`, `docs/06-mantenimiento-seguridad.md` |
| Informe técnico | `docs/INFORME.md` + documentos `01`–`06` y diagramas en `docs/diagramas/` |
