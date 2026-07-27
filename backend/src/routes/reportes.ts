import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler } from '../utils';

export const reportesRouter = Router();

/** RF-10.1 / RF-10.2: tablero. El operador recibe solo los indicadores operativos. */
reportesRouter.get(
  '/tablero',
  asyncHandler(async (req, res) => {
    await consultarUno('SELECT gimnasio.fn_vencer_membresias() AS afectadas');

    const operativo = await consultarUno<{
      socios_activos: string;
      socios_vigentes: string;
      socios_baneados: string;
      asistencias_hoy: string;
      por_vencer: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM gimnasio.socios WHERE activo)::TEXT AS socios_activos,
         (SELECT COUNT(*) FROM gimnasio.vw_socios_estado WHERE estado_membresia = 'VIGENTE')::TEXT AS socios_vigentes,
         (SELECT COUNT(*) FROM gimnasio.socios WHERE baneado)::TEXT AS socios_baneados,
         (SELECT COUNT(*) FROM gimnasio.asistencias WHERE fecha = CURRENT_DATE)::TEXT AS asistencias_hoy,
         (SELECT COUNT(*) FROM gimnasio.membresias
           WHERE estado = 'VIGENTE' AND fecha_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::TEXT AS por_vencer`,
    );

    const base = {
      socios_activos: Number(operativo?.socios_activos ?? 0),
      socios_vigentes: Number(operativo?.socios_vigentes ?? 0),
      socios_baneados: Number(operativo?.socios_baneados ?? 0),
      asistencias_hoy: Number(operativo?.asistencias_hoy ?? 0),
      membresias_por_vencer: Number(operativo?.por_vencer ?? 0),
    };

    if (req.sesion?.rol !== 'ADMINISTRADOR') {
      res.json(base);
      return;
    }

    const financiero = await consultarUno<{ ingresos_mes: string; operaciones_mes: string }>(
      `SELECT COALESCE(SUM(monto), 0)::TEXT AS ingresos_mes, COUNT(*)::TEXT AS operaciones_mes
         FROM gimnasio.pagos
        WHERE pagado_en >= date_trunc('month', CURRENT_DATE)`,
    );
    const asistenciasSemana = await consultar(
      `SELECT d::DATE AS fecha,
              (SELECT COUNT(*) FROM gimnasio.asistencias a WHERE a.fecha = d::DATE)::INTEGER AS total
         FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day') AS d
        ORDER BY fecha`,
    );
    const planesTop = await consultar(
      `SELECT p.nombre, COUNT(m.id)::INTEGER AS membresias
         FROM gimnasio.planes p
         LEFT JOIN gimnasio.membresias m ON m.plan_id = p.id
        GROUP BY p.id, p.nombre
        ORDER BY membresias DESC, p.nombre
        LIMIT 5`,
    );

    res.json({
      ...base,
      ingresos_mes: Number(financiero?.ingresos_mes ?? 0),
      operaciones_mes: Number(financiero?.operaciones_mes ?? 0),
      asistencias_semana: asistenciasSemana,
      planes_top: planesTop,
    });
  }),
);

/** RF-10.3: ingresos por rango de fechas agrupados por plan. */
reportesRouter.get(
  '/ingresos',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const { desde, hasta } = z
      .object({ desde: z.string().date(), hasta: z.string().date() })
      .parse(req.query);

    const datos = await consultar(
      `SELECT pl.nombre AS plan,
              COUNT(*)::INTEGER AS operaciones,
              SUM(pg.monto)::NUMERIC(12,2) AS ingresos
         FROM gimnasio.pagos pg
         JOIN gimnasio.membresias m ON m.id = pg.membresia_id
         JOIN gimnasio.planes pl ON pl.id = m.plan_id
        WHERE pg.pagado_en::DATE BETWEEN $1::DATE AND $2::DATE
        GROUP BY pl.nombre
        ORDER BY ingresos DESC`,
      [desde, hasta],
    );
    const total = datos.reduce(
      (acumulado, fila) => acumulado + Number((fila as { ingresos: string }).ingresos),
      0,
    );
    res.json({ desde, hasta, total, datos });
  }),
);

reportesRouter.get(
  '/auditoria',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(
      req.query,
    );
    const datos = await consultar(
      `SELECT id, usuario, accion, entidad, entidad_id, ip, creado_en
         FROM gimnasio.auditoria
        ORDER BY creado_en DESC
        LIMIT $1`,
      [limite],
    );
    res.json({ datos });
  }),
);
