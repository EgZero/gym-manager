import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { conflicto, noEncontrado } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam, offset, paginacionSchema } from '../utils';

export const sociosRouter = Router();

interface FilaSocioEstado {
  id: number;
  documento: string;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
  baneado: boolean;
  motivo_baneo: string | null;
  plan_nombre: string | null;
  estado_membresia: 'VIGENTE' | 'VENCIDA' | 'SIN_MEMBRESIA';
  dias_plan: number;
  dias_transcurridos: number;
  dias_restantes: number;
  dias_asistidos: number;
  dias_faltados: number;
  puntos: number;
}

const socioSchema = z.object({
  documento: z
    .string()
    .trim()
    .min(5)
    .max(20)
    .regex(/^[0-9A-Za-z-]+$/, 'Documento inválido'),
  nombres: z.string().trim().min(2).max(60),
  apellidos: z.string().trim().min(2).max(60),
  correo: z.string().trim().email().max(120).nullish(),
  telefono: z.string().trim().max(30).nullish(),
  fecha_nacimiento: z.string().date().nullish(),
  direccion: z.string().trim().max(200).nullish(),
  contacto_emergencia: z.string().trim().max(120).nullish(),
});

const filtrosSchema = paginacionSchema.extend({
  busqueda: z.string().trim().max(80).optional(),
  estado: z.enum(['VIGENTE', 'VENCIDA', 'SIN_MEMBRESIA']).optional(),
  baneado: z.enum(['true', 'false']).optional(),
  incluir_inactivos: z.enum(['true', 'false']).default('false'),
});

sociosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const f = filtrosSchema.parse(req.query);
    const parametros = [
      f.busqueda ? `%${f.busqueda.toLowerCase()}%` : null,
      f.estado ?? null,
      f.baneado === undefined ? null : f.baneado === 'true',
      f.incluir_inactivos === 'true',
      f.limite,
      offset(f.pagina, f.limite),
    ];

    const filtroSql = `
      WHERE ($1::TEXT IS NULL OR lower(nombre_completo) LIKE $1 OR lower(documento) LIKE $1)
        AND ($2::TEXT IS NULL OR estado_membresia = $2)
        AND ($3::BOOLEAN IS NULL OR baneado = $3)
        AND ($4::BOOLEAN OR activo)`;

    const datos = await consultar<FilaSocioEstado>(
      `SELECT * FROM gimnasio.vw_socios_estado ${filtroSql}
        ORDER BY apellidos, nombres
        LIMIT $5 OFFSET $6`,
      parametros,
    );
    const total = await consultarUno<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM gimnasio.vw_socios_estado ${filtroSql}`,
      parametros.slice(0, 4),
    );

    res.json({
      datos,
      paginacion: {
        pagina: f.pagina,
        limite: f.limite,
        total: Number(total?.total ?? 0),
      },
    });
  }),
);

sociosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE id = $1',
      [id],
    );
    if (!socio) throw noEncontrado('Socio');

    const membresias = await consultar(
      `SELECT m.id, m.fecha_inicio, m.fecha_fin, m.estado, m.precio_lista, m.descuento,
              m.precio_final, m.pagada_con_puntos, p.nombre AS plan_nombre, pr.codigo AS promocion
         FROM gimnasio.membresias m
         JOIN gimnasio.planes p ON p.id = m.plan_id
         LEFT JOIN gimnasio.promociones pr ON pr.id = m.promocion_id
        WHERE m.socio_id = $1
        ORDER BY m.fecha_inicio DESC`,
      [id],
    );
    const asistencias = await consultar(
      `SELECT id, fecha, hora_ingreso FROM gimnasio.asistencias
        WHERE socio_id = $1 ORDER BY fecha DESC LIMIT 60`,
      [id],
    );
    const movimientosPuntos = await consultar(
      `SELECT id, puntos, origen, descripcion, creado_en
         FROM gimnasio.movimientos_puntos
        WHERE socio_id = $1 ORDER BY creado_en DESC LIMIT 50`,
      [id],
    );

    res.json({ ...socio, membresias, asistencias, movimientos_puntos: movimientosPuntos });
  }),
);

sociosRouter.get(
  '/documento/:documento',
  asyncHandler(async (req, res) => {
    const documento = z.string().trim().min(3).max(20).parse(req.params.documento);
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE documento = $1',
      [documento],
    );
    if (!socio) throw noEncontrado('Socio');
    res.json(socio);
  }),
);

sociosRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const datos = socioSchema.parse(req.body);
    const creado = await consultarUno<{ id: number }>(
      `INSERT INTO gimnasio.socios
         (documento, nombres, apellidos, correo, telefono, fecha_nacimiento, direccion,
          contacto_emergencia, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        datos.documento,
        datos.nombres,
        datos.apellidos,
        datos.correo ?? null,
        datos.telefono ?? null,
        datos.fecha_nacimiento ?? null,
        datos.direccion ?? null,
        datos.contacto_emergencia ?? null,
        req.sesion?.id ?? null,
      ],
    );
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE id = $1',
      [creado?.id],
    );
    await auditar(req, {
      accion: 'CREAR_SOCIO',
      entidad: 'socios',
      entidadId: creado?.id,
      nuevos: socio,
    });
    res.status(201).json(socio);
  }),
);

sociosRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const datos = socioSchema.partial().parse(req.body);
    const previo = await consultarUno('SELECT * FROM gimnasio.socios WHERE id = $1', [id]);
    if (!previo) throw noEncontrado('Socio');

    await consultarUno(
      `UPDATE gimnasio.socios
          SET documento           = COALESCE($2, documento),
              nombres             = COALESCE($3, nombres),
              apellidos           = COALESCE($4, apellidos),
              correo              = COALESCE($5, correo),
              telefono            = COALESCE($6, telefono),
              fecha_nacimiento    = COALESCE($7::DATE, fecha_nacimiento),
              direccion           = COALESCE($8, direccion),
              contacto_emergencia = COALESCE($9, contacto_emergencia)
        WHERE id = $1 RETURNING id`,
      [
        id,
        datos.documento ?? null,
        datos.nombres ?? null,
        datos.apellidos ?? null,
        datos.correo ?? null,
        datos.telefono ?? null,
        datos.fecha_nacimiento ?? null,
        datos.direccion ?? null,
        datos.contacto_emergencia ?? null,
      ],
    );
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE id = $1',
      [id],
    );
    await auditar(req, {
      accion: 'ACTUALIZAR_SOCIO',
      entidad: 'socios',
      entidadId: id,
      previos: previo,
      nuevos: socio,
    });
    res.json(socio);
  }),
);

/** RF-05.5: baja lógica si tiene historial; borrado físico solo si no tiene movimientos. */
sociosRouter.delete(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const previo = await consultarUno('SELECT * FROM gimnasio.socios WHERE id = $1', [id]);
    if (!previo) throw noEncontrado('Socio');

    const historial = await consultarUno<{ total: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM gimnasio.membresias WHERE socio_id = $1) +
         (SELECT COUNT(*) FROM gimnasio.asistencias WHERE socio_id = $1) +
         (SELECT COUNT(*) FROM gimnasio.movimientos_puntos WHERE socio_id = $1)
       )::TEXT AS total`,
      [id],
    );

    if (Number(historial?.total ?? 0) > 0) {
      await consultarUno('UPDATE gimnasio.socios SET activo = FALSE WHERE id = $1 RETURNING id', [id]);
      await auditar(req, {
        accion: 'DESACTIVAR_SOCIO',
        entidad: 'socios',
        entidadId: id,
        previos: previo,
      });
      res.json({ mensaje: 'El socio tiene historial: se dio de baja lógica' });
      return;
    }

    await consultarUno('DELETE FROM gimnasio.socios WHERE id = $1 RETURNING id', [id]);
    await auditar(req, {
      accion: 'ELIMINAR_SOCIO',
      entidad: 'socios',
      entidadId: id,
      previos: previo,
    });
    res.json({ mensaje: 'Socio eliminado correctamente' });
  }),
);

sociosRouter.patch(
  '/:id/reactivar',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const fila = await consultarUno('UPDATE gimnasio.socios SET activo = TRUE WHERE id = $1 RETURNING id', [
      id,
    ]);
    if (!fila) throw noEncontrado('Socio');
    await auditar(req, { accion: 'REACTIVAR_SOCIO', entidad: 'socios', entidadId: id });
    res.json({ mensaje: 'Socio reactivado' });
  }),
);

// --- Baneo (RF-05.6 / RF-05.7) ---------------------------------------
const baneoSchema = z.object({
  motivo: z.string().trim().min(5).max(300),
  baneado_hasta: z.string().date().nullish(),
});

sociosRouter.post(
  '/:id/banear',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const datos = baneoSchema.parse(req.body);
    const previo = await consultarUno<{ baneado: boolean }>(
      'SELECT baneado FROM gimnasio.socios WHERE id = $1',
      [id],
    );
    if (!previo) throw noEncontrado('Socio');
    if (previo.baneado) throw conflicto('El socio ya se encuentra baneado');

    await consultarUno(
      `UPDATE gimnasio.socios
          SET baneado = TRUE, motivo_baneo = $2, baneado_en = now(),
              baneado_hasta = $3::DATE, baneado_por = $4
        WHERE id = $1 RETURNING id`,
      [id, datos.motivo, datos.baneado_hasta ?? null, req.sesion?.id ?? null],
    );
    await auditar(req, {
      accion: 'BANEAR_SOCIO',
      entidad: 'socios',
      entidadId: id,
      nuevos: datos,
    });
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE id = $1',
      [id],
    );
    res.json(socio);
  }),
);

sociosRouter.post(
  '/:id/desbanear',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const fila = await consultarUno(
      `UPDATE gimnasio.socios
          SET baneado = FALSE, motivo_baneo = NULL, baneado_en = NULL,
              baneado_hasta = NULL, baneado_por = NULL
        WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!fila) throw noEncontrado('Socio');
    await auditar(req, { accion: 'DESBANEAR_SOCIO', entidad: 'socios', entidadId: id });
    const socio = await consultarUno<FilaSocioEstado>(
      'SELECT * FROM gimnasio.vw_socios_estado WHERE id = $1',
      [id],
    );
    res.json(socio);
  }),
);
