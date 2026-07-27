-- =====================================================================
-- GymManager · Migración 002 · Funciones de negocio, vistas y roles
-- =====================================================================

BEGIN;
SET search_path TO gimnasio, public;

-- ---------------------------------------------------------------------
-- RN-01 · Alta de staff EXCLUSIVA desde PostgreSQL
-- Uso:  SELECT gimnasio.crear_staff('jperez','Clave.Segura1','Juan Perez',
--                                   'ADMINISTRADOR','jperez@gym.com','555-1234');
-- SECURITY DEFINER + REVOKE: el rol de la aplicación no puede ejecutarla.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.crear_staff(
  p_usuario         TEXT,
  p_password        TEXT,
  p_nombre_completo TEXT,
  p_rol             TEXT,
  p_correo          TEXT DEFAULT NULL,
  p_telefono        TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gimnasio, public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF char_length(p_password) < 8 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres';
  END IF;
  IF upper(p_rol) NOT IN ('ADMINISTRADOR','OPERADOR') THEN
    RAISE EXCEPTION 'Rol inválido: % (use ADMINISTRADOR u OPERADOR)', p_rol;
  END IF;

  INSERT INTO gimnasio.staff (usuario, hash_password, nombre_completo, rol, correo, telefono)
  VALUES (
    p_usuario,
    crypt(p_password, gen_salt('bf', 10)),   -- bcrypt, compatible con bcryptjs de Node
    p_nombre_completo,
    upper(p_rol)::gimnasio.rol_staff,
    p_correo,
    p_telefono
  )
  RETURNING id INTO v_id;

  INSERT INTO gimnasio.auditoria (usuario, accion, entidad, entidad_id, datos_nuevos)
  VALUES (current_user, 'CREAR_STAFF', 'staff', v_id::TEXT,
          jsonb_build_object('usuario', p_usuario, 'rol', upper(p_rol)));

  RETURN v_id;
END $$;

COMMENT ON FUNCTION gimnasio.crear_staff IS
  'Único mecanismo para crear administradores y operadores. Ejecutar desde psql con un rol privilegiado.';

-- Reset de contraseña disponible para la aplicación (el admin resetea operadores)
CREATE OR REPLACE FUNCTION gimnasio.hash_password(p_password TEXT)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT crypt(p_password, gen_salt('bf', 10));
$$;

-- ---------------------------------------------------------------------
-- Cálculo de fecha fin de una membresía
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_calcular_fecha_fin(p_inicio DATE, p_dias INTEGER)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT p_inicio + make_interval(days => p_dias);
$$;

-- ---------------------------------------------------------------------
-- Saldo de puntos de un socio (RF-08.3)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_saldo_puntos(p_socio_id BIGINT)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(puntos), 0)::INTEGER
  FROM gimnasio.movimientos_puntos
  WHERE socio_id = p_socio_id;
$$;

-- RN-06 · el saldo nunca puede quedar negativo
CREATE OR REPLACE FUNCTION gimnasio.fn_validar_saldo_puntos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_saldo INTEGER;
BEGIN
  SELECT COALESCE(SUM(puntos), 0) INTO v_saldo
  FROM gimnasio.movimientos_puntos WHERE socio_id = NEW.socio_id;
  IF v_saldo < 0 THEN
    RAISE EXCEPTION 'Saldo de puntos insuficiente para el socio % (quedaría en %)', NEW.socio_id, v_saldo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_validar_saldo_puntos ON gimnasio.movimientos_puntos;
CREATE CONSTRAINT TRIGGER tg_validar_saldo_puntos
  AFTER INSERT OR UPDATE OR DELETE ON gimnasio.movimientos_puntos
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION gimnasio.fn_validar_saldo_puntos();

-- ---------------------------------------------------------------------
-- RF-06.6 · Vencimiento automático de membresías
-- Se invoca al leer estado y desde el cron de mantenimiento.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_vencer_membresias()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_afectadas INTEGER;
BEGIN
  UPDATE gimnasio.membresias
     SET estado = 'VENCIDA'
   WHERE estado = 'VIGENTE'
     AND fecha_fin <= CURRENT_DATE;
  GET DIAGNOSTICS v_afectadas = ROW_COUNT;
  RETURN v_afectadas;
END $$;

-- ---------------------------------------------------------------------
-- RF-05.8 / RF-07.2 · Validaciones al registrar asistencia
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_validar_asistencia()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_baneado BOOLEAN;
  v_activo  BOOLEAN;
  v_membresia BIGINT;
BEGIN
  SELECT baneado, activo INTO v_baneado, v_activo
  FROM gimnasio.socios WHERE id = NEW.socio_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El socio % no existe', NEW.socio_id;
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El socio está dado de baja' USING ERRCODE = 'check_violation';
  END IF;
  IF v_baneado THEN
    RAISE EXCEPTION 'El socio está baneado y no puede ingresar' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.membresia_id IS NULL THEN
    SELECT id INTO v_membresia
    FROM gimnasio.membresias
    WHERE socio_id = NEW.socio_id
      AND estado = 'VIGENTE'
      AND NEW.fecha BETWEEN fecha_inicio AND fecha_fin
    ORDER BY fecha_fin DESC
    LIMIT 1;

    IF v_membresia IS NULL THEN
      RAISE EXCEPTION 'El socio no tiene una membresía vigente' USING ERRCODE = 'check_violation';
    END IF;
    NEW.membresia_id := v_membresia;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_validar_asistencia ON gimnasio.asistencias;
CREATE TRIGGER tg_validar_asistencia
  BEFORE INSERT ON gimnasio.asistencias
  FOR EACH ROW EXECUTE FUNCTION gimnasio.fn_validar_asistencia();

-- ---------------------------------------------------------------------
-- RF-03.5 · Histórico de precios de plan
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gimnasio.fn_registrar_cambio_precio()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.precio IS DISTINCT FROM OLD.precio THEN
    INSERT INTO gimnasio.historial_precios_plan (plan_id, precio_anterior, precio_nuevo)
    VALUES (OLD.id, OLD.precio, NEW.precio);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_historial_precio_plan ON gimnasio.planes;
CREATE TRIGGER tg_historial_precio_plan
  AFTER UPDATE ON gimnasio.planes
  FOR EACH ROW EXECUTE FUNCTION gimnasio.fn_registrar_cambio_precio();

-- ---------------------------------------------------------------------
-- VISTA · Estado integral del socio (RF-05.3, RF-06.3, RF-06.4)
-- Días consumidos por CALENDARIO, asista o no el socio.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW gimnasio.vw_socios_estado AS
WITH membresia_actual AS (
  SELECT DISTINCT ON (m.socio_id)
         m.socio_id, m.id AS membresia_id, m.plan_id, m.fecha_inicio, m.fecha_fin,
         m.estado, m.precio_final, p.nombre AS plan_nombre, p.duracion_dias
  FROM gimnasio.membresias m
  JOIN gimnasio.planes p ON p.id = m.plan_id
  WHERE m.estado <> 'CANCELADA'
  ORDER BY m.socio_id, m.fecha_fin DESC, m.id DESC
),
asistencias_membresia AS (
  SELECT a.socio_id, a.membresia_id, COUNT(*)::INTEGER AS total
  FROM gimnasio.asistencias a
  GROUP BY a.socio_id, a.membresia_id
),
puntos AS (
  SELECT socio_id, COALESCE(SUM(puntos), 0)::INTEGER AS saldo
  FROM gimnasio.movimientos_puntos
  GROUP BY socio_id
)
SELECT
  s.id,
  s.documento,
  s.nombres,
  s.apellidos,
  s.nombres || ' ' || s.apellidos           AS nombre_completo,
  s.correo,
  s.telefono,
  s.fecha_nacimiento,
  s.activo,
  s.baneado,
  s.motivo_baneo,
  s.baneado_en,
  s.baneado_hasta,
  s.creado_en,
  ma.membresia_id,
  ma.plan_id,
  ma.plan_nombre,
  ma.fecha_inicio,
  ma.fecha_fin,
  ma.precio_final,
  CASE
    WHEN ma.membresia_id IS NULL THEN 'SIN_MEMBRESIA'
    WHEN ma.fecha_fin <= CURRENT_DATE THEN 'VENCIDA'
    ELSE 'VIGENTE'
  END                                        AS estado_membresia,
  COALESCE(ma.duracion_dias, 0)              AS dias_plan,
  -- días transcurridos por calendario (tope: duración del plan)
  COALESCE(GREATEST(0, LEAST(CURRENT_DATE, ma.fecha_fin) - ma.fecha_inicio), 0)::INTEGER
                                             AS dias_transcurridos,
  COALESCE(GREATEST(0, ma.fecha_fin - CURRENT_DATE), 0)::INTEGER
                                             AS dias_restantes,
  COALESCE(am.total, 0)                      AS dias_asistidos,
  GREATEST(
    0,
    COALESCE(GREATEST(0, LEAST(CURRENT_DATE, ma.fecha_fin) - ma.fecha_inicio), 0)::INTEGER
      - COALESCE(am.total, 0)
  )                                          AS dias_faltados,
  COALESCE(pt.saldo, 0)                      AS puntos
FROM gimnasio.socios s
LEFT JOIN membresia_actual ma       ON ma.socio_id = s.id
LEFT JOIN asistencias_membresia am  ON am.socio_id = s.id AND am.membresia_id = ma.membresia_id
LEFT JOIN puntos pt                 ON pt.socio_id = s.id;

COMMENT ON VIEW gimnasio.vw_socios_estado IS
  'Ficha consolidada del socio: plan contratado, días transcurridos/restantes, asistidos/faltados, puntos y baneo.';

-- ---------------------------------------------------------------------
-- VISTA · Ingresos por plan y mes (RF-10.3)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW gimnasio.vw_ingresos_por_plan AS
SELECT
  date_trunc('month', pg_.pagado_en)::DATE AS mes,
  pl.id   AS plan_id,
  pl.nombre AS plan_nombre,
  COUNT(*)::INTEGER AS operaciones,
  SUM(pg_.monto)::NUMERIC(12,2) AS ingresos
FROM gimnasio.pagos pg_
JOIN gimnasio.membresias m ON m.id = pg_.membresia_id
JOIN gimnasio.planes pl    ON pl.id = m.plan_id
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------
-- Rol de aplicación con privilegios mínimos (RNF-01)
-- El rol se crea en provision.sh; aquí solo se otorgan/revocan permisos.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymapp') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA gimnasio TO gymapp';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gimnasio TO gymapp';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gimnasio TO gymapp';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA gimnasio
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gymapp';
    -- La app NO puede crear staff (RN-01) ni alterar la auditoría (RF-11.2)
    EXECUTE 'REVOKE ALL ON FUNCTION gimnasio.crear_staff(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION gimnasio.crear_staff(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM gymapp';
    EXECUTE 'REVOKE INSERT ON gimnasio.staff FROM gymapp';
    EXECUTE 'REVOKE DELETE ON gimnasio.staff FROM gymapp';
    EXECUTE 'REVOKE UPDATE, DELETE ON gimnasio.auditoria FROM gymapp';
  END IF;
END $$;

COMMIT;
