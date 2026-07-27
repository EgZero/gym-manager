# 2. Diseño de la Base de Datos — PostgreSQL

**Motor:** PostgreSQL 16 · **Esquema:** `gimnasio` · **Codificación:** UTF-8

---

## 2.1 Estrategia de diseño

| Decisión | Justificación |
|---|---|
| Esquema propio `gimnasio` en vez de `public` | Permite revocar `public` y otorgar permisos granulares al rol de la aplicación. |
| `BIGINT GENERATED ALWAYS AS IDENTITY` | Estándar SQL, evita el uso de `serial` y bloquea inserciones manuales del `id`. |
| Tipos `ENUM` (`rol_staff`, `estado_membresia`, `tipo_promocion`, `metodo_pago`, `origen_puntos`) | Integridad a nivel del motor: valores inválidos son imposibles, no solo improbables. |
| Puntos como **libro mayor** (`movimientos_puntos`) y no como columna de saldo | Auditable y a prueba de condiciones de carrera: el saldo es `SUM(puntos)`. |
| Precios **congelados** en `membresias` | Cambiar el precio de un plan no altera lo ya vendido (integridad contable). |
| Índices únicos parciales | Reglas de negocio impuestas por el motor (ej. una sola membresía vigente por socio). |
| Triggers de validación | La regla se cumple aunque alguien escriba directo por `psql`, no solo desde la API. |
| Baja lógica cuando hay historial | Nunca se pierde trazabilidad de socios, planes o promociones ya usados. |

---

## 2.2 Modelo entidad-relación

```
                      ┌────────────────┐
                      │     staff      │  (ADMINISTRADOR | OPERADOR)
                      │  usuario, hash │  ← creado SOLO por gimnasio.crear_staff()
                      └───────┬────────┘
                              │ registra / audita
        ┌─────────────────────┼──────────────────────────────┐
        │                     │                              │
┌───────▼────────┐   ┌────────▼─────────┐          ┌─────────▼────────┐
│     socios     │   │    auditoria     │          │    productos     │
│ documento (UQ) │   │ accion, entidad  │          │ costo_en_puntos  │
│ baneado        │   └──────────────────┘          │ stock            │
└───┬────────┬───┘                                 └─────────┬────────┘
    │        │                                               │
    │        │  1:N                                          │ canje
    │        └──────────────┐                                │
    │ 1:N                   │                     ┌──────────▼────────────┐
┌───▼──────────┐   ┌────────▼────────┐            │  movimientos_puntos   │
│ asistencias  │   │   membresias    │───────────►│ +/- puntos (libro     │
│ UQ(socio,fec)│   │ inicio, fin     │            │  mayor, saldo=SUM)    │
└──────────────┘   │ precio_final    │            └───────────────────────┘
                   │ estado          │
                   └──┬───────┬──────┘
                      │       │ 1:N
              ┌───────▼──┐  ┌─▼──────────┐
              │  planes  │  │   pagos    │
              │ precio   │  │ monto      │
              │ duracion │  │ metodo     │
              └────┬─────┘  └────────────┘
                   │ 1:N              ▲
        ┌──────────▼──────────┐       │ aplica
        │ historial_precios_  │  ┌────┴──────────┐
        │ plan (auditoría de  │  │  promociones  │
        │ cambios de precio)  │  │ codigo, tipo  │
        └─────────────────────┘  │ valor, usos   │
                                 └───────────────┘
```

---

## 2.3 Diccionario de datos

### `gimnasio.staff`
Personal con acceso al sistema.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | BIGINT | PK, identity | Identificador |
| `usuario` | TEXT | UNIQUE, NOT NULL | Nombre de inicio de sesión |
| `hash_password` | TEXT | NOT NULL | Hash bcrypt (coste 10) |
| `nombre_completo` | TEXT | NOT NULL | Nombre real |
| `rol` | `rol_staff` | NOT NULL | `ADMINISTRADOR` \| `OPERADOR` |
| `correo`, `telefono` | TEXT | NULL | Contacto |
| `activo` | BOOLEAN | DEFAULT true | Baja lógica |
| `intentos_fallidos` | INT | DEFAULT 0 | Contador para bloqueo |
| `bloqueado_hasta` | TIMESTAMPTZ | NULL | Fin del bloqueo temporal |
| `ultimo_acceso` | TIMESTAMPTZ | NULL | Último login exitoso |

### `gimnasio.planes`
Mensualidades y sus costos.

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | BIGINT | PK |
| `nombre` | TEXT | UNIQUE, NOT NULL |
| `descripcion` | TEXT | NULL |
| `precio` | NUMERIC(10,2) | `CHECK (precio >= 0)` |
| `duracion_dias` | INT | `CHECK (duracion_dias > 0)` |
| `puntos_otorgados` | INT | `CHECK (>= 0)` — puntos que gana el socio al comprarlo |
| `costo_en_puntos` | INT | NULL = no canjeable; si no, precio en puntos del plan gratis |
| `activo` | BOOLEAN | DEFAULT true |

### `gimnasio.historial_precios_plan`
Bitácora automática (trigger) de cada cambio de precio: `plan_id`, `precio_anterior`, `precio_nuevo`, `cambiado_por`, `cambiado_en`.

### `gimnasio.promociones`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | TEXT UNIQUE | Ej. `VERANO2026` |
| `tipo` | `tipo_promocion` | `PORCENTAJE` \| `MONTO_FIJO` |
| `valor` | NUMERIC(10,2) | `CHECK`: si es porcentaje, ≤ 100 |
| `plan_id` | BIGINT NULL | `NULL` = aplica a todos los planes |
| `vigente_desde` / `vigente_hasta` | DATE | `CHECK (hasta >= desde)` |
| `usos_maximos` | INT NULL | `NULL` = ilimitado |
| `usos_actuales` | INT | Incrementado en la venta, dentro de la transacción |

### `gimnasio.socios`
Miembros del gimnasio (sin login).

| Columna | Tipo | Notas |
|---|---|---|
| `documento` | TEXT UNIQUE | Identidad, usada para el check-in |
| `nombres`, `apellidos` | TEXT NOT NULL | |
| `correo`, `telefono`, `direccion`, `contacto_emergencia` | TEXT NULL | |
| `fecha_nacimiento` | DATE NULL | |
| `activo` | BOOLEAN | Baja lógica |
| `baneado` | BOOLEAN | Impide asistir, comprar y canjear |
| `motivo_baneo` | TEXT NULL | Obligatorio al banear (validado en la API) |
| `baneado_hasta` | DATE NULL | Baneo temporal opcional |
| `registrado_por` | BIGINT → staff | Trazabilidad |

### `gimnasio.membresias`
Contrato entre un socio y un plan.

| Columna | Tipo | Notas |
|---|---|---|
| `socio_id`, `plan_id` | BIGINT FK | |
| `fecha_inicio`, `fecha_fin` | DATE | `fecha_fin = fecha_inicio + duracion_dias - 1` |
| `estado` | `estado_membresia` | `VIGENTE` \| `VENCIDA` \| `CANCELADA` |
| `precio_lista`, `descuento`, `precio_final` | NUMERIC(10,2) | Congelados al vender |
| `promocion_id` | BIGINT NULL FK | Promoción aplicada |
| `pagada_con_puntos` | BOOLEAN | Canje de plan gratis |

**Restricción clave — una sola membresía vigente por socio:**

```sql
CREATE UNIQUE INDEX ux_membresia_vigente_por_socio
  ON gimnasio.membresias (socio_id)
  WHERE estado = 'VIGENTE';
```

### `gimnasio.pagos`
`membresia_id`, `monto`, `metodo` (`EFECTIVO`|`TARJETA`|`TRANSFERENCIA`|`PUNTOS`), `registrado_por`, `creado_en`.

### `gimnasio.asistencias`
`socio_id`, `fecha`, `hora_ingreso`, `registrado_por`.

**Una asistencia por socio y día:** `CONSTRAINT ux_asistencia_dia UNIQUE (socio_id, fecha)`.

### `gimnasio.productos`
Catálogo de canje: `nombre`, `descripcion`, `costo_en_puntos`, `stock`, `activo`.

### `gimnasio.movimientos_puntos`
Libro mayor de puntos. `puntos` positivo acredita, negativo debita.
`origen`: `COMPRA_MEMBRESIA` | `ASISTENCIA` | `CANJE_PRODUCTO` | `CANJE_PLAN` | `AJUSTE_MANUAL`.

### `gimnasio.auditoria`
`staff_id`, `usuario`, `accion`, `entidad`, `entidad_id`, `detalle` (JSONB), `ip`, `creado_en`.

---

## 2.4 Reglas de negocio implementadas en el motor

| # | Regla | Mecanismo |
|---|---|---|
| RN-01 | Solo el DBA crea staff | `gimnasio.crear_staff()` (`SECURITY DEFINER`) + `POST /api/staff` → 403 |
| RN-02 | Un socio no puede tener dos membresías vigentes | Índice único parcial |
| RN-03 | Una sola asistencia por socio y día | `UNIQUE (socio_id, fecha)` |
| RN-04 | Un socio baneado o sin membresía vigente no puede asistir | `trg_validar_asistencia` (trigger `BEFORE INSERT`) |
| RN-05 | El saldo de puntos nunca es negativo | `trg_validar_saldo_puntos` sobre `movimientos_puntos` |
| RN-06 | Los cambios de precio quedan registrados | `trg_historial_precio_plan` (`AFTER UPDATE`) |
| RN-07 | Los días corren por calendario | `vw_socios_estado` calcula sobre fechas, no sobre asistencias |
| RN-08 | Las membresías caducan solas | `gimnasio.fn_vencer_membresias()` ejecutada por cron a las 00:05 |
| RN-09 | Promociones con vigencia y cupo | `CHECK` + validación transaccional en la venta |
| RN-10 | Toda escritura relevante se audita | Inserciones en `gimnasio.auditoria` |

---

## 2.5 Fórmula de días asistidos / faltados

Requisito del enunciado: *«hay un plan mensual, y vaya o no el usuario los días se van contando»*.

```sql
dias_plan          = fecha_fin - fecha_inicio + 1
dias_transcurridos = LEAST(CURRENT_DATE, fecha_fin) - fecha_inicio + 1
dias_restantes     = GREATEST(0, fecha_fin - CURRENT_DATE)
dias_asistidos     = COUNT(asistencias BETWEEN fecha_inicio AND CURRENT_DATE)
dias_faltados      = dias_transcurridos - dias_asistidos
```

Expuesto por la vista `gimnasio.vw_socios_estado`, que consume la API en
`GET /api/socios` y `GET /api/socios/:id`.

---

## 2.6 Creación de cuentas de staff (única vía autorizada)

```bash
sudo -u postgres psql -d gymdb -c \
  "SELECT gimnasio.crear_staff('recepcion1','ClaveSegura#2026','María López','OPERADOR','maria@gym.com');"
```

La función:
1. Valida que el rol sea `ADMINISTRADOR` u `OPERADOR`.
2. Exige contraseña de al menos 8 caracteres.
3. Hashea con `crypt(..., gen_salt('bf', 10))` (`pgcrypto`), compatible con bcrypt de Node.
4. Devuelve el `id` creado.

La API **no** puede invocarla: el rol `gymapp` no tiene `EXECUTE` sobre ella y el endpoint
`POST /api/staff` responde `403 ALTA_SOLO_EN_POSTGRES`.

---

## 2.7 Migraciones

| Archivo | Contenido |
|---|---|
| `backend/db/migrations/001_esquema_inicial.sql` | Esquema, tipos, tablas, índices y permisos |
| `backend/db/migrations/002_funciones_y_vistas.sql` | Funciones, vistas, triggers y `crear_staff` |
| `backend/db/seeds/001_datos_iniciales.sql` | Datos de demostración (solo desarrollo) |

El runner (`backend/src/db/migrate.ts`) registra cada archivo en `gimnasio.schema_migrations`
con su **checksum SHA-256** y aborta si una migración ya aplicada fue modificada. Se ejecuta
automáticamente en cada despliegue (`deploy/scripts/post-deploy.sh`).

```bash
npm run migrate      # desarrollo (tsx)
npm run migrate:prod # producción (dist compilado)
npm run seed         # datos de demostración
```

### Roles de base de datos

| Rol | Uso | Privilegios |
|---|---|---|
| `postgres` | DBA | Superusuario. Crea staff. |
| `gymowner` | Migraciones | Dueño del esquema `gimnasio` (`MIGRATION_DATABASE_URL`) |
| `gymapp` | API en runtime | `SELECT/INSERT/UPDATE/DELETE` sobre las tablas; **sin** DDL ni `crear_staff` |
