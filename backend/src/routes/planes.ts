import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { noEncontrado } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam } from '../utils';

export const planesRouter = Router();

interface FilaPlan {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: string;
  duracion_dias: number;
  puntos_otorgados: number;
  costo_en_puntos: number | null;
  activo: boolean;
}

const SELECT_PLAN = `
  SELECT id, nombre, descripcion, precio, duracion_dias, puntos_otorgados, costo_en_puntos,
         activo, creado_en, actualizado_en
    FROM gimnasio.planes`;

const planSchema = z.object({
  nombre: z.string().trim().min(3).max(80),
  descripcion: z.string().trim().max(500).nullish(),
  precio: z.coerce.number().min(0).max(999999),
  duracion_dias: z.coerce.number().int().min(1).max(3650),
  puntos_otorgados: z.coerce.number().int().min(0).max(100000).default(0),
  costo_en_puntos: z.coerce.number().int().positive().nullish(),
  activo: z.boolean().default(true),
});

// Listar: administrador y operador (el operador necesita los precios para vender)
planesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { incluir_inactivos } = z
      .object({ incluir_inactivos: z.enum(['true', 'false']).default('false') })
      .parse(req.query);

    const filas = await consultar<FilaPlan>(
      `${SELECT_PLAN}
        WHERE ($1::BOOLEAN OR activo)
        ORDER BY activo DESC, precio ASC`,
      [incluir_inactivos === 'true'],
    );
    res.json({ datos: filas });
  }),
);

planesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const plan = await consultarUno<FilaPlan>(`${SELECT_PLAN} WHERE id = $1`, [id]);
    if (!plan) throw noEncontrado('Plan');
    const historial = await consultar(
      `SELECT precio_anterior, precio_nuevo, cambiado_en
         FROM gimnasio.historial_precios_plan
        WHERE plan_id = $1 ORDER BY cambiado_en DESC LIMIT 20`,
      [id],
    );
    res.json({ ...plan, historial_precios: historial });
  }),
);

planesRouter.post(
  '/',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const datos = planSchema.parse(req.body);
    const plan = await consultarUno<FilaPlan>(
      `INSERT INTO gimnasio.planes
         (nombre, descripcion, precio, duracion_dias, puntos_otorgados, costo_en_puntos, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre, descripcion, precio, duracion_dias, puntos_otorgados,
                 costo_en_puntos, activo, creado_en, actualizado_en`,
      [
        datos.nombre,
        datos.descripcion ?? null,
        datos.precio,
        datos.duracion_dias,
        datos.puntos_otorgados,
        datos.costo_en_puntos ?? null,
        datos.activo,
      ],
    );
    await auditar(req, {
      accion: 'CREAR_PLAN',
      entidad: 'planes',
      entidadId: plan?.id,
      nuevos: plan,
    });
    res.status(201).json(plan);
  }),
);

planesRouter.put(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const datos = planSchema.partial().parse(req.body);
    const previo = await consultarUno<FilaPlan>(`${SELECT_PLAN} WHERE id = $1`, [id]);
    if (!previo) throw noEncontrado('Plan');

    const plan = await consultarUno<FilaPlan>(
      `UPDATE gimnasio.planes
          SET nombre           = COALESCE($2, nombre),
              descripcion      = COALESCE($3, descripcion),
              precio           = COALESCE($4, precio),
              duracion_dias    = COALESCE($5, duracion_dias),
              puntos_otorgados = COALESCE($6, puntos_otorgados),
              costo_en_puntos  = COALESCE($7, costo_en_puntos),
              activo           = COALESCE($8, activo)
        WHERE id = $1
      RETURNING id, nombre, descripcion, precio, duracion_dias, puntos_otorgados,
                costo_en_puntos, activo, creado_en, actualizado_en`,
      [
        id,
        datos.nombre ?? null,
        datos.descripcion ?? null,
        datos.precio ?? null,
        datos.duracion_dias ?? null,
        datos.puntos_otorgados ?? null,
        datos.costo_en_puntos ?? null,
        datos.activo ?? null,
      ],
    );
    await auditar(req, {
      accion: 'ACTUALIZAR_PLAN',
      entidad: 'planes',
      entidadId: id,
      previos: previo,
      nuevos: plan,
    });
    res.json(plan);
  }),
);

/** RF-03.4: baja lógica si el plan ya tiene membresías vendidas. */
planesRouter.delete(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const previo = await consultarUno<FilaPlan>(`${SELECT_PLAN} WHERE id = $1`, [id]);
    if (!previo) throw noEncontrado('Plan');

    const enUso = await consultarUno<{ total: string }>(
      'SELECT COUNT(*)::TEXT AS total FROM gimnasio.membresias WHERE plan_id = $1',
      [id],
    );

    if (Number(enUso?.total ?? 0) > 0) {
      const plan = await consultarUno<FilaPlan>(
        `UPDATE gimnasio.planes SET activo = FALSE WHERE id = $1
         RETURNING id, nombre, descripcion, precio, duracion_dias, puntos_otorgados,
                   costo_en_puntos, activo, creado_en, actualizado_en`,
        [id],
      );
      await auditar(req, {
        accion: 'DESACTIVAR_PLAN',
        entidad: 'planes',
        entidadId: id,
        previos: previo,
      });
      res.json({
        mensaje: 'El plan tiene membresías asociadas: se desactivó en lugar de eliminarse',
        plan,
      });
      return;
    }

    await consultarUno('DELETE FROM gimnasio.planes WHERE id = $1 RETURNING id', [id]);
    await auditar(req, {
      accion: 'ELIMINAR_PLAN',
      entidad: 'planes',
      entidadId: id,
      previos: previo,
    });
    res.json({ mensaje: 'Plan eliminado correctamente' });
  }),
);
