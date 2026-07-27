import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { consultar, consultarUno, enTransaccion } from '../db';
import { noEncontrado } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam, offset, paginacionSchema } from '../utils';

export const asistenciasRouter = Router();

const checkinSchema = z
  .object({
    socio_id: z.coerce.number().int().positive().optional(),
    documento: z.string().trim().min(3).max(20).optional(),
  })
  .refine((d) => d.socio_id !== undefined || d.documento !== undefined, {
    message: 'Debe indicar socio_id o documento',
  });

/** RF-07: check-in. Las validaciones de baneo y membresía vigente viven en el trigger de la BD. */
asistenciasRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const datos = checkinSchema.parse(req.body);
    const staffId = req.sesion?.id ?? null;

    const socio = await consultarUno<{ id: number; nombre: string }>(
      `SELECT id, nombres || ' ' || apellidos AS nombre
         FROM gimnasio.socios
        WHERE ($1::BIGINT IS NOT NULL AND id = $1::BIGINT)
           OR ($2::TEXT IS NOT NULL AND documento = $2::TEXT)`,
      [datos.socio_id ?? null, datos.documento ?? null],
    );
    if (!socio) throw noEncontrado('Socio');

    const resultado = await enTransaccion(async (cliente) => {
      const asistencia = (
        await cliente.query<{ id: number; fecha: string; membresia_id: number }>(
          `INSERT INTO gimnasio.asistencias (socio_id, registrada_por)
           VALUES ($1, $2) RETURNING id, fecha, membresia_id`,
          [socio.id, staffId],
        )
      ).rows[0];

      if (config.negocio.puntosPorAsistencia > 0) {
        await cliente.query(
          `INSERT INTO gimnasio.movimientos_puntos
             (socio_id, puntos, origen, descripcion, asistencia_id, registrado_por)
           VALUES ($1, $2, 'ASISTENCIA', 'Puntos por asistencia diaria', $3, $4)`,
          [socio.id, config.negocio.puntosPorAsistencia, asistencia?.id, staffId],
        );
      }

      const estado = (
        await cliente.query(
          `SELECT nombre_completo, plan_nombre, dias_restantes, dias_asistidos,
                  dias_faltados, puntos
             FROM gimnasio.vw_socios_estado WHERE id = $1`,
          [socio.id],
        )
      ).rows[0];

      return { asistencia, socio: estado };
    });

    await auditar(req, {
      accion: 'REGISTRAR_ASISTENCIA',
      entidad: 'asistencias',
      entidadId: resultado.asistencia?.id,
      nuevos: { socio_id: socio.id },
    });
    res.status(201).json(resultado);
  }),
);

asistenciasRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const f = paginacionSchema
      .extend({
        socio_id: z.coerce.number().int().positive().optional(),
        desde: z.string().date().optional(),
        hasta: z.string().date().optional(),
      })
      .parse(req.query);

    const datos = await consultar(
      `SELECT a.id, a.socio_id, s.documento, s.nombres || ' ' || s.apellidos AS socio,
              a.fecha, a.hora_ingreso, st.usuario AS registrada_por
         FROM gimnasio.asistencias a
         JOIN gimnasio.socios s ON s.id = a.socio_id
         LEFT JOIN gimnasio.staff st ON st.id = a.registrada_por
        WHERE ($1::BIGINT IS NULL OR a.socio_id = $1)
          AND ($2::DATE IS NULL OR a.fecha >= $2::DATE)
          AND ($3::DATE IS NULL OR a.fecha <= $3::DATE)
        ORDER BY a.hora_ingreso DESC
        LIMIT $4 OFFSET $5`,
      [
        f.socio_id ?? null,
        f.desde ?? null,
        f.hasta ?? null,
        f.limite,
        offset(f.pagina, f.limite),
      ],
    );
    res.json({ datos, paginacion: { pagina: f.pagina, limite: f.limite } });
  }),
);

asistenciasRouter.get(
  '/hoy',
  asyncHandler(async (_req, res) => {
    const datos = await consultar(
      `SELECT a.id, a.socio_id, s.documento, s.nombres || ' ' || s.apellidos AS socio,
              a.hora_ingreso, st.usuario AS registrada_por
         FROM gimnasio.asistencias a
         JOIN gimnasio.socios s ON s.id = a.socio_id
         LEFT JOIN gimnasio.staff st ON st.id = a.registrada_por
        WHERE a.fecha = CURRENT_DATE
        ORDER BY a.hora_ingreso DESC`,
    );
    res.json({ datos, total: datos.length });
  }),
);

/** RF-07.5: corrección de una asistencia mal registrada (solo administrador). */
asistenciasRouter.delete(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const eliminada = await enTransaccion(async (cliente) => {
      const previa = (
        await cliente.query('SELECT * FROM gimnasio.asistencias WHERE id = $1', [id])
      ).rows[0];
      if (!previa) throw noEncontrado('Asistencia');

      // Revierte los puntos otorgados por esa asistencia
      await cliente.query(
        'DELETE FROM gimnasio.movimientos_puntos WHERE asistencia_id = $1 AND origen = $2',
        [id, 'ASISTENCIA'],
      );
      await cliente.query('DELETE FROM gimnasio.asistencias WHERE id = $1', [id]);
      return previa;
    });

    await auditar(req, {
      accion: 'ELIMINAR_ASISTENCIA',
      entidad: 'asistencias',
      entidadId: id,
      previos: eliminada,
    });
    res.json({ mensaje: 'Asistencia eliminada correctamente' });
  }),
);
