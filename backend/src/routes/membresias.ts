import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { consultar, consultarUno, enTransaccion } from '../db';
import { conflicto, noEncontrado, noProcesable } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam, offset, paginacionSchema } from '../utils';

export const membresiasRouter = Router();

interface FilaPlan {
  id: number;
  nombre: string;
  precio: string;
  duracion_dias: number;
  puntos_otorgados: number;
  activo: boolean;
}

interface FilaPromocion {
  id: number;
  codigo: string;
  tipo: 'PORCENTAJE' | 'MONTO_FIJO';
  valor: string;
  plan_id: number | null;
  vigente_desde: string;
  vigente_hasta: string;
  usos_maximos: number | null;
  usos_actuales: number;
  activo: boolean;
}

const ventaSchema = z.object({
  socio_id: z.coerce.number().int().positive(),
  plan_id: z.coerce.number().int().positive(),
  promocion_id: z.coerce.number().int().positive().nullish(),
  fecha_inicio: z.string().date().optional(),
  metodo_pago: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA']).default('EFECTIVO'),
  referencia_pago: z.string().trim().max(80).nullish(),
});

/** RF-04.4 / RF-04.5: valida la promoción y calcula el descuento aplicable. */
export function calcularDescuento(precio: number, promocion: FilaPromocion): number {
  const valor = Number(promocion.valor);
  const descuento = promocion.tipo === 'PORCENTAJE' ? (precio * valor) / 100 : valor;
  return Math.min(Math.round(descuento * 100) / 100, precio);
}

async function validarPromocion(
  cliente: PoolClient,
  promocionId: number,
  planId: number,
  fechaInicio: string,
): Promise<FilaPromocion> {
  const { rows } = await cliente.query<FilaPromocion>(
    'SELECT * FROM gimnasio.promociones WHERE id = $1 FOR UPDATE',
    [promocionId],
  );
  const promocion = rows[0];
  if (!promocion) throw noEncontrado('Promoción');
  if (!promocion.activo) throw noProcesable('La promoción está desactivada');
  if (fechaInicio < promocion.vigente_desde || fechaInicio > promocion.vigente_hasta) {
    throw noProcesable('La promoción no está vigente para la fecha indicada');
  }
  if (promocion.usos_maximos !== null && promocion.usos_actuales >= promocion.usos_maximos) {
    throw noProcesable('La promoción agotó sus usos disponibles');
  }
  if (promocion.plan_id !== null && promocion.plan_id !== planId) {
    throw noProcesable('La promoción no aplica al plan seleccionado');
  }
  return promocion;
}

/** RF-06: venta de membresía con pago, puntos y control de solapamiento. */
membresiasRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const datos = ventaSchema.parse(req.body);
    const staffId = req.sesion?.id ?? null;

    const resultado = await enTransaccion(async (cliente) => {
      const socio = (
        await cliente.query<{ id: number; baneado: boolean; activo: boolean }>(
          'SELECT id, baneado, activo FROM gimnasio.socios WHERE id = $1 FOR UPDATE',
          [datos.socio_id],
        )
      ).rows[0];
      if (!socio) throw noEncontrado('Socio');
      if (!socio.activo) throw conflicto('El socio está dado de baja');
      if (socio.baneado) throw conflicto('El socio está baneado y no puede comprar membresías');

      const plan = (
        await cliente.query<FilaPlan>('SELECT * FROM gimnasio.planes WHERE id = $1', [datos.plan_id])
      ).rows[0];
      if (!plan) throw noEncontrado('Plan');
      if (!plan.activo) throw noProcesable('El plan está desactivado');

      // Cierra membresías ya vencidas para liberar el índice de unicidad
      await cliente.query(
        `UPDATE gimnasio.membresias SET estado = 'VENCIDA'
          WHERE socio_id = $1 AND estado = 'VIGENTE' AND fecha_fin <= CURRENT_DATE`,
        [datos.socio_id],
      );

      const vigente = (
        await cliente.query<{ id: number; fecha_fin: string }>(
          `SELECT id, fecha_fin FROM gimnasio.membresias
            WHERE socio_id = $1 AND estado = 'VIGENTE'`,
          [datos.socio_id],
        )
      ).rows[0];
      if (vigente) {
        throw conflicto(
          `El socio ya tiene una membresía vigente hasta ${vigente.fecha_fin}. ` +
            'Cancélela antes de vender una nueva.',
        );
      }

      const fechaInicio =
        datos.fecha_inicio ?? new Date().toISOString().slice(0, 10);

      const precioLista = Number(plan.precio);
      let descuento = 0;
      let promocionId: number | null = null;

      if (datos.promocion_id) {
        const promocion = await validarPromocion(
          cliente,
          datos.promocion_id,
          plan.id,
          fechaInicio,
        );
        descuento = calcularDescuento(precioLista, promocion);
        promocionId = promocion.id;
        await cliente.query(
          'UPDATE gimnasio.promociones SET usos_actuales = usos_actuales + 1 WHERE id = $1',
          [promocion.id],
        );
      }

      const precioFinal = Math.round((precioLista - descuento) * 100) / 100;

      const membresia = (
        await cliente.query<{ id: number; fecha_fin: string }>(
          `INSERT INTO gimnasio.membresias
             (socio_id, plan_id, promocion_id, fecha_inicio, fecha_fin,
              precio_lista, descuento, precio_final, estado, registrada_por)
           VALUES ($1, $2, $3, $4::DATE, gimnasio.fn_calcular_fecha_fin($4::DATE, $5),
                   $6, $7, $8, 'VIGENTE', $9)
           RETURNING id, fecha_fin`,
          [
            datos.socio_id,
            plan.id,
            promocionId,
            fechaInicio,
            plan.duracion_dias,
            precioLista,
            descuento,
            precioFinal,
            staffId,
          ],
        )
      ).rows[0];

      await cliente.query(
        `INSERT INTO gimnasio.pagos (membresia_id, monto, metodo, referencia, registrado_por)
         VALUES ($1, $2, $3, $4, $5)`,
        [membresia?.id, precioFinal, datos.metodo_pago, datos.referencia_pago ?? null, staffId],
      );

      if (plan.puntos_otorgados > 0) {
        await cliente.query(
          `INSERT INTO gimnasio.movimientos_puntos
             (socio_id, puntos, origen, descripcion, membresia_id, registrado_por)
           VALUES ($1, $2, 'COMPRA_MEMBRESIA', $3, $4, $5)`,
          [
            datos.socio_id,
            plan.puntos_otorgados,
            `Puntos por compra del plan ${plan.nombre}`,
            membresia?.id,
            staffId,
          ],
        );
      }

      return {
        id: membresia?.id,
        fecha_inicio: fechaInicio,
        fecha_fin: membresia?.fecha_fin,
        precio_lista: precioLista,
        descuento,
        precio_final: precioFinal,
        puntos_acreditados: plan.puntos_otorgados,
        plan: plan.nombre,
      };
    });

    await auditar(req, {
      accion: 'VENDER_MEMBRESIA',
      entidad: 'membresias',
      entidadId: resultado.id,
      nuevos: resultado,
    });
    res.status(201).json(resultado);
  }),
);

membresiasRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const f = paginacionSchema
      .extend({
        socio_id: z.coerce.number().int().positive().optional(),
        estado: z.enum(['VIGENTE', 'VENCIDA', 'CANCELADA']).optional(),
        por_vencer_dias: z.coerce.number().int().min(1).max(90).optional(),
      })
      .parse(req.query);

    const parametros = [
      f.socio_id ?? null,
      f.estado ?? null,
      f.por_vencer_dias ?? null,
      f.limite,
      offset(f.pagina, f.limite),
    ];

    const datos = await consultar(
      `SELECT m.id, m.socio_id, s.documento, s.nombres || ' ' || s.apellidos AS socio,
              p.nombre AS plan, m.fecha_inicio, m.fecha_fin, m.estado,
              m.precio_lista, m.descuento, m.precio_final, m.pagada_con_puntos,
              GREATEST(0, m.fecha_fin - CURRENT_DATE) AS dias_restantes
         FROM gimnasio.membresias m
         JOIN gimnasio.socios s ON s.id = m.socio_id
         JOIN gimnasio.planes p ON p.id = m.plan_id
        WHERE ($1::BIGINT IS NULL OR m.socio_id = $1)
          AND ($2::TEXT IS NULL OR m.estado = $2::gimnasio.estado_membresia)
          AND ($3::INT IS NULL OR (m.estado = 'VIGENTE'
               AND m.fecha_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + $3::INT))
        ORDER BY m.fecha_fin DESC
        LIMIT $4 OFFSET $5`,
      parametros,
    );
    res.json({ datos, paginacion: { pagina: f.pagina, limite: f.limite } });
  }),
);

membresiasRouter.post(
  '/:id/cancelar',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { motivo } = z.object({ motivo: z.string().trim().min(5).max(300) }).parse(req.body);

    const previa = await consultarUno<{ estado: string }>(
      'SELECT estado FROM gimnasio.membresias WHERE id = $1',
      [id],
    );
    if (!previa) throw noEncontrado('Membresía');
    if (previa.estado === 'CANCELADA') throw conflicto('La membresía ya está cancelada');

    const fila = await consultarUno(
      `UPDATE gimnasio.membresias
          SET estado = 'CANCELADA', cancelada_en = now(), motivo_cancelacion = $2
        WHERE id = $1 RETURNING id, estado, cancelada_en`,
      [id, motivo],
    );
    await auditar(req, {
      accion: 'CANCELAR_MEMBRESIA',
      entidad: 'membresias',
      entidadId: id,
      previos: previa,
      nuevos: { motivo },
    });
    res.json(fila);
  }),
);
