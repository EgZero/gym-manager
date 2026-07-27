import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { noEncontrado } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam } from '../utils';

export const promocionesRouter = Router();

interface FilaPromocion {
  id: number;
  codigo: string;
  descripcion: string;
  tipo: 'PORCENTAJE' | 'MONTO_FIJO';
  valor: string;
  plan_id: number | null;
  plan_nombre: string | null;
  vigente_desde: string;
  vigente_hasta: string;
  usos_maximos: number | null;
  usos_actuales: number;
  activo: boolean;
}

const SELECT_PROMO = `
  SELECT p.id, p.codigo, p.descripcion, p.tipo, p.valor, p.plan_id, pl.nombre AS plan_nombre,
         p.vigente_desde, p.vigente_hasta, p.usos_maximos, p.usos_actuales, p.activo,
         (p.activo
           AND CURRENT_DATE BETWEEN p.vigente_desde AND p.vigente_hasta
           AND (p.usos_maximos IS NULL OR p.usos_actuales < p.usos_maximos)) AS disponible
    FROM gimnasio.promociones p
    LEFT JOIN gimnasio.planes pl ON pl.id = p.plan_id`;

const promocionSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, 'Solo letras, números, guion y guion bajo'),
    descripcion: z.string().trim().min(3).max(200),
    tipo: z.enum(['PORCENTAJE', 'MONTO_FIJO']),
    valor: z.coerce.number().positive().max(999999),
    plan_id: z.coerce.number().int().positive().nullish(),
    vigente_desde: z.string().date().optional(),
    vigente_hasta: z.string().date(),
    usos_maximos: z.coerce.number().int().positive().nullish(),
    activo: z.boolean().default(true),
  })
  .refine((d) => d.tipo !== 'PORCENTAJE' || d.valor <= 100, {
    message: 'Un descuento porcentual no puede superar el 100%',
    path: ['valor'],
  });

promocionesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { solo_disponibles } = z
      .object({ solo_disponibles: z.enum(['true', 'false']).default('false') })
      .parse(req.query);

    const filas = await consultar<FilaPromocion>(
      `${SELECT_PROMO}
        WHERE (NOT $1::BOOLEAN OR (p.activo
              AND CURRENT_DATE BETWEEN p.vigente_desde AND p.vigente_hasta
              AND (p.usos_maximos IS NULL OR p.usos_actuales < p.usos_maximos)))
        ORDER BY p.activo DESC, p.vigente_hasta DESC`,
      [solo_disponibles === 'true'],
    );
    res.json({ datos: filas });
  }),
);

promocionesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const promo = await consultarUno<FilaPromocion>(`${SELECT_PROMO} WHERE p.id = $1`, [id]);
    if (!promo) throw noEncontrado('Promoción');
    res.json(promo);
  }),
);

promocionesRouter.post(
  '/',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const datos = promocionSchema.parse(req.body);
    const promo = await consultarUno<FilaPromocion>(
      `INSERT INTO gimnasio.promociones
         (codigo, descripcion, tipo, valor, plan_id, vigente_desde, vigente_hasta, usos_maximos, activo)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::DATE, CURRENT_DATE), $7, $8, $9)
       RETURNING id`,
      [
        datos.codigo,
        datos.descripcion,
        datos.tipo,
        datos.valor,
        datos.plan_id ?? null,
        datos.vigente_desde ?? null,
        datos.vigente_hasta,
        datos.usos_maximos ?? null,
        datos.activo,
      ],
    );
    const creada = await consultarUno<FilaPromocion>(`${SELECT_PROMO} WHERE p.id = $1`, [promo?.id]);
    await auditar(req, {
      accion: 'CREAR_PROMOCION',
      entidad: 'promociones',
      entidadId: promo?.id,
      nuevos: creada,
    });
    res.status(201).json(creada);
  }),
);

promocionesRouter.put(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const datos = promocionSchema.innerType().partial().parse(req.body);
    const previa = await consultarUno<FilaPromocion>(`${SELECT_PROMO} WHERE p.id = $1`, [id]);
    if (!previa) throw noEncontrado('Promoción');

    await consultarUno(
      `UPDATE gimnasio.promociones
          SET codigo        = COALESCE($2, codigo),
              descripcion   = COALESCE($3, descripcion),
              tipo          = COALESCE($4::gimnasio.tipo_promocion, tipo),
              valor         = COALESCE($5, valor),
              plan_id       = COALESCE($6, plan_id),
              vigente_desde = COALESCE($7::DATE, vigente_desde),
              vigente_hasta = COALESCE($8::DATE, vigente_hasta),
              usos_maximos  = COALESCE($9, usos_maximos),
              activo        = COALESCE($10, activo)
        WHERE id = $1 RETURNING id`,
      [
        id,
        datos.codigo ?? null,
        datos.descripcion ?? null,
        datos.tipo ?? null,
        datos.valor ?? null,
        datos.plan_id ?? null,
        datos.vigente_desde ?? null,
        datos.vigente_hasta ?? null,
        datos.usos_maximos ?? null,
        datos.activo ?? null,
      ],
    );
    const actualizada = await consultarUno<FilaPromocion>(`${SELECT_PROMO} WHERE p.id = $1`, [id]);
    await auditar(req, {
      accion: 'ACTUALIZAR_PROMOCION',
      entidad: 'promociones',
      entidadId: id,
      previos: previa,
      nuevos: actualizada,
    });
    res.json(actualizada);
  }),
);

/** RF-04.3: baja lógica si la promoción ya fue utilizada. */
promocionesRouter.delete(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const previa = await consultarUno<FilaPromocion>(`${SELECT_PROMO} WHERE p.id = $1`, [id]);
    if (!previa) throw noEncontrado('Promoción');

    if (previa.usos_actuales > 0) {
      await consultarUno('UPDATE gimnasio.promociones SET activo = FALSE WHERE id = $1 RETURNING id', [
        id,
      ]);
      await auditar(req, {
        accion: 'DESACTIVAR_PROMOCION',
        entidad: 'promociones',
        entidadId: id,
        previos: previa,
      });
      res.json({ mensaje: 'La promoción ya fue utilizada: se desactivó en lugar de eliminarse' });
      return;
    }

    await consultarUno('DELETE FROM gimnasio.promociones WHERE id = $1 RETURNING id', [id]);
    await auditar(req, {
      accion: 'ELIMINAR_PROMOCION',
      entidad: 'promociones',
      entidadId: id,
      previos: previa,
    });
    res.json({ mensaje: 'Promoción eliminada correctamente' });
  }),
);
