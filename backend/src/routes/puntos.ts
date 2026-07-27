import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno, enTransaccion } from '../db';
import { conflicto, noEncontrado, noProcesable } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam } from '../utils';

export const puntosRouter = Router();

puntosRouter.get(
  '/socio/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const saldo = await consultarUno<{ saldo: number }>(
      'SELECT gimnasio.fn_saldo_puntos($1) AS saldo',
      [id],
    );
    const movimientos = await consultar(
      `SELECT mp.id, mp.puntos, mp.origen, mp.descripcion, mp.creado_en,
              pr.nombre AS producto, st.usuario AS registrado_por
         FROM gimnasio.movimientos_puntos mp
         LEFT JOIN gimnasio.productos pr ON pr.id = mp.producto_id
         LEFT JOIN gimnasio.staff st ON st.id = mp.registrado_por
        WHERE mp.socio_id = $1
        ORDER BY mp.creado_en DESC
        LIMIT 100`,
      [id],
    );
    res.json({ saldo: saldo?.saldo ?? 0, movimientos });
  }),
);

/** RF-08.4: canje de puntos por un producto del catálogo. */
puntosRouter.post(
  '/canjear/producto',
  asyncHandler(async (req, res) => {
    const { socio_id, producto_id } = z
      .object({
        socio_id: z.coerce.number().int().positive(),
        producto_id: z.coerce.number().int().positive(),
      })
      .parse(req.body);
    const staffId = req.sesion?.id ?? null;

    const resultado = await enTransaccion(async (cliente) => {
      const socio = (
        await cliente.query<{ id: number; baneado: boolean }>(
          'SELECT id, baneado FROM gimnasio.socios WHERE id = $1 FOR UPDATE',
          [socio_id],
        )
      ).rows[0];
      if (!socio) throw noEncontrado('Socio');
      if (socio.baneado) throw conflicto('El socio está baneado y no puede canjear puntos');

      const producto = (
        await cliente.query<{ id: number; nombre: string; costo_en_puntos: number; stock: number; activo: boolean }>(
          'SELECT id, nombre, costo_en_puntos, stock, activo FROM gimnasio.productos WHERE id = $1 FOR UPDATE',
          [producto_id],
        )
      ).rows[0];
      if (!producto) throw noEncontrado('Producto');
      if (!producto.activo) throw noProcesable('El producto no está disponible para canje');
      if (producto.stock <= 0) throw conflicto('El producto no tiene stock disponible');

      const saldo = (
        await cliente.query<{ saldo: number }>('SELECT gimnasio.fn_saldo_puntos($1) AS saldo', [socio_id])
      ).rows[0];
      const disponible = saldo?.saldo ?? 0;
      if (disponible < producto.costo_en_puntos) {
        throw noProcesable(
          `Saldo insuficiente: el socio tiene ${disponible} puntos y el canje requiere ${producto.costo_en_puntos}`,
        );
      }

      await cliente.query('UPDATE gimnasio.productos SET stock = stock - 1 WHERE id = $1', [producto.id]);
      const movimiento = (
        await cliente.query<{ id: number }>(
          `INSERT INTO gimnasio.movimientos_puntos
             (socio_id, puntos, origen, descripcion, producto_id, registrado_por)
           VALUES ($1, $2, 'CANJE_PRODUCTO', $3, $4, $5) RETURNING id`,
          [socio_id, -producto.costo_en_puntos, `Canje de ${producto.nombre}`, producto.id, staffId],
        )
      ).rows[0];

      return {
        movimiento_id: movimiento?.id,
        producto: producto.nombre,
        puntos_debitados: producto.costo_en_puntos,
        saldo_restante: disponible - producto.costo_en_puntos,
      };
    });

    await auditar(req, {
      accion: 'CANJEAR_PRODUCTO',
      entidad: 'movimientos_puntos',
      entidadId: resultado.movimiento_id,
      nuevos: resultado,
    });
    res.status(201).json(resultado);
  }),
);

/** RF-08.5: canje de puntos por un plan gratis (genera membresía con precio 0). */
puntosRouter.post(
  '/canjear/plan',
  asyncHandler(async (req, res) => {
    const { socio_id, plan_id } = z
      .object({
        socio_id: z.coerce.number().int().positive(),
        plan_id: z.coerce.number().int().positive(),
      })
      .parse(req.body);
    const staffId = req.sesion?.id ?? null;

    const resultado = await enTransaccion(async (cliente) => {
      const socio = (
        await cliente.query<{ id: number; baneado: boolean; activo: boolean }>(
          'SELECT id, baneado, activo FROM gimnasio.socios WHERE id = $1 FOR UPDATE',
          [socio_id],
        )
      ).rows[0];
      if (!socio) throw noEncontrado('Socio');
      if (!socio.activo) throw conflicto('El socio está dado de baja');
      if (socio.baneado) throw conflicto('El socio está baneado y no puede canjear puntos');

      const plan = (
        await cliente.query<{
          id: number;
          nombre: string;
          duracion_dias: number;
          costo_en_puntos: number | null;
          activo: boolean;
        }>('SELECT id, nombre, duracion_dias, costo_en_puntos, activo FROM gimnasio.planes WHERE id = $1', [
          plan_id,
        ])
      ).rows[0];
      if (!plan) throw noEncontrado('Plan');
      if (!plan.activo) throw noProcesable('El plan está desactivado');
      if (plan.costo_en_puntos === null) throw noProcesable('Este plan no se puede canjear por puntos');

      await cliente.query(
        `UPDATE gimnasio.membresias SET estado = 'VENCIDA'
          WHERE socio_id = $1 AND estado = 'VIGENTE' AND fecha_fin <= CURRENT_DATE`,
        [socio_id],
      );
      const vigente = (
        await cliente.query('SELECT id FROM gimnasio.membresias WHERE socio_id = $1 AND estado = $2', [
          socio_id,
          'VIGENTE',
        ])
      ).rows[0];
      if (vigente) throw conflicto('El socio ya tiene una membresía vigente');

      const saldo = (
        await cliente.query<{ saldo: number }>('SELECT gimnasio.fn_saldo_puntos($1) AS saldo', [socio_id])
      ).rows[0];
      const disponible = saldo?.saldo ?? 0;
      if (disponible < plan.costo_en_puntos) {
        throw noProcesable(
          `Saldo insuficiente: el socio tiene ${disponible} puntos y el plan requiere ${plan.costo_en_puntos}`,
        );
      }

      const membresia = (
        await cliente.query<{ id: number; fecha_fin: string }>(
          `INSERT INTO gimnasio.membresias
             (socio_id, plan_id, fecha_inicio, fecha_fin, precio_lista, descuento, precio_final,
              estado, pagada_con_puntos, registrada_por)
           VALUES ($1, $2, CURRENT_DATE,
                   gimnasio.fn_calcular_fecha_fin(CURRENT_DATE, $3), 0, 0, 0, 'VIGENTE', TRUE, $4)
           RETURNING id, fecha_fin`,
          [socio_id, plan.id, plan.duracion_dias, staffId],
        )
      ).rows[0];

      await cliente.query(
        `INSERT INTO gimnasio.pagos (membresia_id, monto, metodo, referencia, registrado_por)
         VALUES ($1, 0, 'PUNTOS', $2, $3)`,
        [membresia?.id, `Canje por ${plan.costo_en_puntos} puntos`, staffId],
      );

      const movimiento = (
        await cliente.query<{ id: number }>(
          `INSERT INTO gimnasio.movimientos_puntos
             (socio_id, puntos, origen, descripcion, membresia_id, registrado_por)
           VALUES ($1, $2, 'CANJE_PLAN', $3, $4, $5) RETURNING id`,
          [
            socio_id,
            -plan.costo_en_puntos,
            `Canje del plan gratis ${plan.nombre}`,
            membresia?.id,
            staffId,
          ],
        )
      ).rows[0];

      return {
        membresia_id: membresia?.id,
        movimiento_id: movimiento?.id,
        plan: plan.nombre,
        fecha_fin: membresia?.fecha_fin,
        puntos_debitados: plan.costo_en_puntos,
        saldo_restante: disponible - plan.costo_en_puntos,
      };
    });

    await auditar(req, {
      accion: 'CANJEAR_PLAN',
      entidad: 'membresias',
      entidadId: resultado.membresia_id,
      nuevos: resultado,
    });
    res.status(201).json(resultado);
  }),
);

/** RF-08.7: ajuste manual de puntos (solo administrador, con motivo obligatorio). */
puntosRouter.post(
  '/ajuste',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const { socio_id, puntos, motivo } = z
      .object({
        socio_id: z.coerce.number().int().positive(),
        puntos: z.coerce.number().int().refine((v) => v !== 0, 'El ajuste no puede ser cero'),
        motivo: z.string().trim().min(5).max(200),
      })
      .parse(req.body);

    const movimiento = await consultarUno<{ id: number }>(
      `INSERT INTO gimnasio.movimientos_puntos
         (socio_id, puntos, origen, descripcion, registrado_por)
       VALUES ($1, $2, 'AJUSTE_MANUAL', $3, $4) RETURNING id`,
      [socio_id, puntos, motivo, req.sesion?.id ?? null],
    );
    const saldo = await consultarUno<{ saldo: number }>(
      'SELECT gimnasio.fn_saldo_puntos($1) AS saldo',
      [socio_id],
    );
    await auditar(req, {
      accion: 'AJUSTE_PUNTOS',
      entidad: 'movimientos_puntos',
      entidadId: movimiento?.id,
      nuevos: { socio_id, puntos, motivo },
    });
    res.status(201).json({ movimiento_id: movimiento?.id, saldo: saldo?.saldo ?? 0 });
  }),
);
