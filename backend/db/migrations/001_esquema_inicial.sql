-- =====================================================================
-- GymManager · Migración 001 · Esquema inicial
-- Motor: PostgreSQL 14+
-- Idempotente: puede ejecutarse varias veces sin efectos secundarios.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS gimnasio;
SET search_path TO gimnasio, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() y crypt()/bcrypt
CREATE EXTENSION IF NOT EXISTS citext;     -- correos y usuarios case-insensitive

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE gimnasio.rol_staff AS ENUM ('ADMINISTRADOR', 'OPERADOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gimnasio.estado_membresia AS ENUM ('VIGENTE', 'VENCIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gimnasio.tipo_promocion AS ENUM ('PORCENTAJE', 'MONTO_FIJO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gimnasio.metodo_pago AS ENUM ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'PUNTOS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gimnasio.origen_puntos AS ENUM
    ('COMPRA_MEMBRESIA', 'ASISTENCIA', 'CANJE_PRODUCTO', 'CANJE_PLAN', 'AJUSTE_MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Función utilitaria: mantener actualizado_en
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_touch_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- staff · administradores y operadores (RF-02)
-- Alta EXCLUSIVA por PostgreSQL mediante gimnasio.crear_staff()
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.staff (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario             CITEXT       NOT NULL UNIQUE,
  hash_password       TEXT         NOT NULL,
  nombre_completo     TEXT         NOT NULL,
  correo              CITEXT       UNIQUE,
  telefono            TEXT,
  rol                 gimnasio.rol_staff NOT NULL,
  activo              BOOLEAN      NOT NULL DEFAULT TRUE,
  intentos_fallidos   SMALLINT     NOT NULL DEFAULT 0,
  bloqueado_hasta     TIMESTAMPTZ,
  ultimo_acceso       TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT staff_usuario_len CHECK (char_length(usuario) BETWEEN 3 AND 40)
);

-- ---------------------------------------------------------------------
-- planes · costos de mensualidad (RF-03)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.planes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            TEXT          NOT NULL UNIQUE,
  descripcion       TEXT,
  precio            NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  duracion_dias     INTEGER       NOT NULL CHECK (duracion_dias BETWEEN 1 AND 3650),
  puntos_otorgados  INTEGER       NOT NULL DEFAULT 0 CHECK (puntos_otorgados >= 0),
  costo_en_puntos   INTEGER       CHECK (costo_en_puntos IS NULL OR costo_en_puntos > 0),
  activo            BOOLEAN       NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON COLUMN gimnasio.planes.costo_en_puntos IS
  'Puntos necesarios para canjear este plan gratis. NULL = no canjeable.';

CREATE TABLE IF NOT EXISTS gimnasio.historial_precios_plan (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id        BIGINT        NOT NULL REFERENCES gimnasio.planes(id) ON DELETE CASCADE,
  precio_anterior NUMERIC(10,2) NOT NULL,
  precio_nuevo    NUMERIC(10,2) NOT NULL,
  cambiado_por    BIGINT        REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  cambiado_en     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- promociones (RF-04)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.promociones (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo         CITEXT        NOT NULL UNIQUE,
  descripcion    TEXT          NOT NULL,
  tipo           gimnasio.tipo_promocion NOT NULL,
  valor          NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  plan_id        BIGINT        REFERENCES gimnasio.planes(id) ON DELETE CASCADE,
  vigente_desde  DATE          NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta  DATE          NOT NULL,
  usos_maximos   INTEGER       CHECK (usos_maximos IS NULL OR usos_maximos > 0),
  usos_actuales  INTEGER       NOT NULL DEFAULT 0 CHECK (usos_actuales >= 0),
  activo         BOOLEAN       NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT promo_vigencia_valida CHECK (vigente_hasta >= vigente_desde),
  CONSTRAINT promo_porcentaje_valido CHECK (tipo <> 'PORCENTAJE' OR valor <= 100)
);

-- ---------------------------------------------------------------------
-- socios (RF-05)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.socios (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento         TEXT        NOT NULL UNIQUE,
  nombres           TEXT        NOT NULL,
  apellidos         TEXT        NOT NULL,
  correo            CITEXT,
  telefono          TEXT,
  fecha_nacimiento  DATE,
  direccion         TEXT,
  contacto_emergencia TEXT,
  activo            BOOLEAN     NOT NULL DEFAULT TRUE,
  baneado           BOOLEAN     NOT NULL DEFAULT FALSE,
  motivo_baneo      TEXT,
  baneado_en        TIMESTAMPTZ,
  baneado_hasta     DATE,
  baneado_por       BIGINT      REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  registrado_por    BIGINT      REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT socio_baneo_coherente CHECK (NOT baneado OR motivo_baneo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_socios_documento ON gimnasio.socios (documento);
CREATE INDEX IF NOT EXISTS ix_socios_apellidos ON gimnasio.socios (lower(apellidos), lower(nombres));
CREATE INDEX IF NOT EXISTS ix_socios_activo    ON gimnasio.socios (activo) WHERE activo;

-- ---------------------------------------------------------------------
-- membresias (RF-06)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.membresias (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  socio_id       BIGINT        NOT NULL REFERENCES gimnasio.socios(id) ON DELETE CASCADE,
  plan_id        BIGINT        NOT NULL REFERENCES gimnasio.planes(id) ON DELETE RESTRICT,
  promocion_id   BIGINT        REFERENCES gimnasio.promociones(id) ON DELETE SET NULL,
  fecha_inicio   DATE          NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin      DATE          NOT NULL,
  precio_lista   NUMERIC(10,2) NOT NULL CHECK (precio_lista >= 0),
  descuento      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  precio_final   NUMERIC(10,2) NOT NULL CHECK (precio_final >= 0),
  estado         gimnasio.estado_membresia NOT NULL DEFAULT 'VIGENTE',
  pagada_con_puntos BOOLEAN    NOT NULL DEFAULT FALSE,
  registrada_por BIGINT        REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  cancelada_en   TIMESTAMPTZ,
  motivo_cancelacion TEXT,
  creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT membresia_rango_valido CHECK (fecha_fin > fecha_inicio),
  CONSTRAINT membresia_precio_coherente CHECK (precio_final = precio_lista - descuento)
);

CREATE INDEX IF NOT EXISTS ix_membresias_socio  ON gimnasio.membresias (socio_id, fecha_fin DESC);
CREATE INDEX IF NOT EXISTS ix_membresias_estado ON gimnasio.membresias (estado);

-- RN: una sola membresía VIGENTE (no cancelada) solapada por socio
CREATE UNIQUE INDEX IF NOT EXISTS ux_membresia_vigente_por_socio
  ON gimnasio.membresias (socio_id)
  WHERE estado = 'VIGENTE';

-- ---------------------------------------------------------------------
-- pagos (RF-06)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.pagos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membresia_id   BIGINT        NOT NULL REFERENCES gimnasio.membresias(id) ON DELETE CASCADE,
  monto          NUMERIC(10,2) NOT NULL CHECK (monto >= 0),
  metodo         gimnasio.metodo_pago NOT NULL,
  referencia     TEXT,
  registrado_por BIGINT        REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  pagado_en      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON gimnasio.pagos (pagado_en);

-- ---------------------------------------------------------------------
-- asistencias (RF-07)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.asistencias (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  socio_id       BIGINT      NOT NULL REFERENCES gimnasio.socios(id) ON DELETE CASCADE,
  membresia_id   BIGINT      REFERENCES gimnasio.membresias(id) ON DELETE SET NULL,
  fecha          DATE        NOT NULL DEFAULT CURRENT_DATE,
  hora_ingreso   TIMESTAMPTZ NOT NULL DEFAULT now(),
  registrada_por BIGINT      REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  CONSTRAINT ux_asistencia_dia UNIQUE (socio_id, fecha)
);

CREATE INDEX IF NOT EXISTS ix_asistencias_fecha ON gimnasio.asistencias (fecha DESC);

-- ---------------------------------------------------------------------
-- productos canjeables (RF-09)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.productos (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre          TEXT        NOT NULL UNIQUE,
  descripcion     TEXT,
  costo_en_puntos INTEGER     NOT NULL CHECK (costo_en_puntos > 0),
  stock           INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  activo          BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- movimientos_puntos · libro mayor de puntos (RF-08)
-- El saldo SIEMPRE se calcula como SUM(puntos); nunca se guarda desnormalizado.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.movimientos_puntos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  socio_id       BIGINT      NOT NULL REFERENCES gimnasio.socios(id) ON DELETE CASCADE,
  puntos         INTEGER     NOT NULL CHECK (puntos <> 0),  -- positivo acredita, negativo debita
  origen         gimnasio.origen_puntos NOT NULL,
  descripcion    TEXT,
  membresia_id   BIGINT      REFERENCES gimnasio.membresias(id) ON DELETE SET NULL,
  asistencia_id  BIGINT      REFERENCES gimnasio.asistencias(id) ON DELETE SET NULL,
  producto_id    BIGINT      REFERENCES gimnasio.productos(id) ON DELETE SET NULL,
  registrado_por BIGINT      REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_puntos_socio ON gimnasio.movimientos_puntos (socio_id, creado_en DESC);

-- ---------------------------------------------------------------------
-- auditoría (RF-11)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gimnasio.auditoria (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id     BIGINT      REFERENCES gimnasio.staff(id) ON DELETE SET NULL,
  usuario      TEXT,
  accion       TEXT        NOT NULL,
  entidad      TEXT        NOT NULL,
  entidad_id   TEXT,
  datos_previos JSONB,
  datos_nuevos  JSONB,
  ip           INET,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_auditoria_fecha  ON gimnasio.auditoria (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_auditoria_entidad ON gimnasio.auditoria (entidad, entidad_id);

-- ---------------------------------------------------------------------
-- Triggers de actualizado_en
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff','planes','promociones','socios','membresias','productos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_touch_%1$s ON gimnasio.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER tg_touch_%1$s BEFORE UPDATE ON gimnasio.%1$s
       FOR EACH ROW EXECUTE FUNCTION gimnasio.fn_touch_actualizado_en()', t);
  END LOOP;
END $$;

COMMIT;
