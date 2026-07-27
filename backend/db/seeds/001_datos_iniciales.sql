-- =====================================================================
-- GymManager · Semilla de datos iniciales (idempotente)
-- Ejecutar como superusuario / dueño de la BD:
--   psql -U postgres -d gymdb -f backend/db/seeds/001_datos_iniciales.sql
--
-- ¡IMPORTANTE! Cambie estas contraseñas en producción con:
--   SELECT gimnasio.crear_staff('usuario','ClaveNueva','Nombre','OPERADOR');
-- =====================================================================

BEGIN;
SET search_path TO gimnasio, public;

-- --- Staff inicial (RN-01: alta solo por PostgreSQL) -----------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gimnasio.staff WHERE usuario = 'admin') THEN
    PERFORM gimnasio.crear_staff(
      'admin', 'Admin.2026', 'Administrador General', 'ADMINISTRADOR',
      'admin@gymmanager.local', '000-0000');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gimnasio.staff WHERE usuario = 'operador') THEN
    PERFORM gimnasio.crear_staff(
      'operador', 'Operador.2026', 'Operador de Recepción', 'OPERADOR',
      'operador@gymmanager.local', '000-0001');
  END IF;
END $$;

-- --- Planes de mensualidad -------------------------------------------
INSERT INTO gimnasio.planes (nombre, descripcion, precio, duracion_dias, puntos_otorgados, costo_en_puntos)
VALUES
  ('Mensual Básico',    'Acceso a sala de máquinas en horario regular',       350.00, 30,  35, 700),
  ('Mensual Full',      'Sala de máquinas + clases grupales + sauna',         550.00, 30,  60, 1100),
  ('Trimestral Full',   'Plan Full con 3 meses de vigencia',                 1450.00, 90, 180, 2800),
  ('Anual Premium',     'Acceso total, casillero y evaluación física mensual',5200.00, 365, 800, 9000),
  ('Estudiante',        'Plan mensual con descuento para estudiantes',        250.00, 30,  25, 500)
ON CONFLICT (nombre) DO NOTHING;

-- --- Promociones ------------------------------------------------------
INSERT INTO gimnasio.promociones (codigo, descripcion, tipo, valor, plan_id, vigente_desde, vigente_hasta, usos_maximos)
SELECT 'BIENVENIDA10', 'Descuento de bienvenida 10%', 'PORCENTAJE', 10, NULL,
       CURRENT_DATE, CURRENT_DATE + 365, 500
WHERE NOT EXISTS (SELECT 1 FROM gimnasio.promociones WHERE codigo = 'BIENVENIDA10');

INSERT INTO gimnasio.promociones (codigo, descripcion, tipo, valor, plan_id, vigente_desde, vigente_hasta, usos_maximos)
SELECT 'VERANO50', 'L. 50 de descuento en el plan Mensual Full', 'MONTO_FIJO', 50,
       (SELECT id FROM gimnasio.planes WHERE nombre = 'Mensual Full'),
       CURRENT_DATE, CURRENT_DATE + 90, 100
WHERE NOT EXISTS (SELECT 1 FROM gimnasio.promociones WHERE codigo = 'VERANO50');

-- --- Productos canjeables --------------------------------------------
INSERT INTO gimnasio.productos (nombre, descripcion, costo_en_puntos, stock)
VALUES
  ('Botella deportiva',   'Botella de 750 ml con logo del gimnasio', 150, 40),
  ('Camiseta dry-fit',    'Camiseta técnica talla S/M/L',            400, 25),
  ('Toalla de gimnasio',  'Toalla de microfibra',                    200, 30),
  ('Batido de proteína',  'Batido preparado en la barra nutricional',120, 100),
  ('Guantes de agarre',   'Guantes acolchados para pesas',           320, 15)
ON CONFLICT (nombre) DO NOTHING;

-- --- Socios de demostración ------------------------------------------
INSERT INTO gimnasio.socios (documento, nombres, apellidos, correo, telefono, fecha_nacimiento, registrado_por)
SELECT v.documento, v.nombres, v.apellidos, v.correo, v.telefono, v.nacimiento,
       (SELECT id FROM gimnasio.staff WHERE usuario = 'operador')
FROM (VALUES
  ('0801199012345', 'María',   'López',    'maria.lopez@mail.com',   '9999-1111', DATE '1990-04-12'),
  ('0801199523456', 'Carlos',  'Martínez', 'carlos.mtz@mail.com',    '9999-2222', DATE '1995-09-30'),
  ('0501198834567', 'Ana',     'Reyes',    'ana.reyes@mail.com',     '9999-3333', DATE '1988-01-05'),
  ('0801200045678', 'Diego',   'Fuentes',  'diego.fuentes@mail.com', '9999-4444', DATE '2000-07-21'),
  ('0301199256789', 'Lucía',   'Padilla',  'lucia.padilla@mail.com', '9999-5555', DATE '1992-11-17')
) AS v(documento, nombres, apellidos, correo, telefono, nacimiento)
WHERE NOT EXISTS (SELECT 1 FROM gimnasio.socios s WHERE s.documento = v.documento);

-- --- Membresías vigentes de demostración ------------------------------
DO $$
DECLARE
  v_socio   RECORD;
  v_plan    RECORD;
  v_staff   BIGINT;
  v_mem     BIGINT;
  v_inicio  DATE;
BEGIN
  SELECT id INTO v_staff FROM gimnasio.staff WHERE usuario = 'operador';

  FOR v_socio IN
    SELECT s.id, row_number() OVER (ORDER BY s.id) AS n
    FROM gimnasio.socios s
    WHERE NOT EXISTS (SELECT 1 FROM gimnasio.membresias m WHERE m.socio_id = s.id)
  LOOP
    SELECT * INTO v_plan FROM gimnasio.planes
      WHERE activo ORDER BY id OFFSET ((v_socio.n - 1) % 3) LIMIT 1;

    v_inicio := CURRENT_DATE - ((v_socio.n * 4)::INTEGER);

    INSERT INTO gimnasio.membresias
      (socio_id, plan_id, fecha_inicio, fecha_fin, precio_lista, descuento, precio_final,
       estado, registrada_por)
    VALUES
      (v_socio.id, v_plan.id, v_inicio,
       gimnasio.fn_calcular_fecha_fin(v_inicio, v_plan.duracion_dias),
       v_plan.precio, 0, v_plan.precio, 'VIGENTE', v_staff)
    RETURNING id INTO v_mem;

    INSERT INTO gimnasio.pagos (membresia_id, monto, metodo, registrado_por)
    VALUES (v_mem, v_plan.precio, 'EFECTIVO', v_staff);

    INSERT INTO gimnasio.movimientos_puntos (socio_id, puntos, origen, descripcion, membresia_id, registrado_por)
    VALUES (v_socio.id, v_plan.puntos_otorgados, 'COMPRA_MEMBRESIA',
            'Puntos por compra de ' || v_plan.nombre, v_mem, v_staff);

    -- Asistencias intercaladas para poder ver días asistidos vs. faltados
    INSERT INTO gimnasio.asistencias (socio_id, membresia_id, fecha, hora_ingreso, registrada_por)
    SELECT v_socio.id, v_mem, d::DATE, d::DATE + TIME '18:30', v_staff
    FROM generate_series(v_inicio, CURRENT_DATE - 1, INTERVAL '2 day') AS d
    ON CONFLICT (socio_id, fecha) DO NOTHING;
  END LOOP;
END $$;

-- --- Socio baneado de ejemplo ----------------------------------------
UPDATE gimnasio.socios
   SET baneado = TRUE,
       motivo_baneo = 'Conducta inapropiada con otros socios',
       baneado_en = now(),
       baneado_hasta = CURRENT_DATE + 30,
       baneado_por = (SELECT id FROM gimnasio.staff WHERE usuario = 'admin')
 WHERE documento = '0801200045678' AND NOT baneado;

SELECT gimnasio.fn_vencer_membresias();

COMMIT;
