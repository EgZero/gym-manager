-- =====================================================================
-- Migración 003 · Corrección del cómputo de días transcurridos
--
-- El día de alta de la membresía cuenta como día 1: con fecha_fin =
-- fecha_inicio + duracion_dias - 1, la resta de fechas devolvía 0 el
-- primer día aunque el socio ya hubiera asistido, y dias_faltados
-- quedaba desalineado respecto de dias_asistidos.
--
--   dias_transcurridos = LEAST(hoy, fecha_fin) - fecha_inicio + 1
-- =====================================================================

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
  COALESCE(GREATEST(0, LEAST(CURRENT_DATE, ma.fecha_fin) - ma.fecha_inicio + 1), 0)::INTEGER
                                             AS dias_transcurridos,
  COALESCE(GREATEST(0, ma.fecha_fin - CURRENT_DATE), 0)::INTEGER
                                             AS dias_restantes,
  COALESCE(am.total, 0)                      AS dias_asistidos,
  GREATEST(
    0,
    COALESCE(GREATEST(0, LEAST(CURRENT_DATE, ma.fecha_fin) - ma.fecha_inicio + 1), 0)::INTEGER
      - COALESCE(am.total, 0)
  )                                          AS dias_faltados,
  COALESCE(pt.saldo, 0)                      AS puntos
FROM gimnasio.socios s
LEFT JOIN membresia_actual ma       ON ma.socio_id = s.id
LEFT JOIN asistencias_membresia am  ON am.socio_id = s.id AND am.membresia_id = ma.membresia_id
LEFT JOIN puntos pt                 ON pt.socio_id = s.id;

COMMENT ON VIEW gimnasio.vw_socios_estado IS
  'Ficha consolidada del socio: plan contratado, días transcurridos/restantes, asistidos/faltados, puntos y baneo.';
