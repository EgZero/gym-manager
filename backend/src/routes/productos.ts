import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { noEncontrado } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam } from '../utils';

export const productosRouter = Router();

interface FilaProducto {
  id: number;
  nombre: string;
  descripcion: string | null;
  costo_en_puntos: number;
  stock: number;
  activo: boolean;
}

const SELECT_PRODUCTO = `
  SELECT id, nombre, descripcion, costo_en_puntos, stock, activo, creado_en, actualizado_en
    FROM gimnasio.productos`;

const productoSchema = z.object({
  nombre: z.string().trim().min(3).max(80),
  descripcion: z.string().trim().max(300).nullish(),
  costo_en_puntos: z.coerce.number().int().positive().max(100000),
  stock: z.coerce.number().int().min(0).max(100000).default(0),
  activo: z.boolean().default(true),
});

productosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { solo_disponibles } = z
      .object({ solo_disponibles: z.enum(['true', 'false']).default('false') })
      .parse(req.query);

    const filas = await consultar<FilaProducto>(
      `${SELECT_PRODUCTO}
        WHERE (NOT $1::BOOLEAN OR (activo AND stock > 0))
        ORDER BY activo DESC, costo_en_puntos ASC`,
      [solo_disponibles === 'true'],
    );
    res.json({ datos: filas });
  }),
);

productosRouter.post(
  '/',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const datos = productoSchema.parse(req.body);
    const producto = await consultarUno<FilaProducto>(
      `INSERT INTO gimnasio.productos (nombre, descripcion, costo_en_puntos, stock, activo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, descripcion, costo_en_puntos, stock, activo, creado_en, actualizado_en`,
      [datos.nombre, datos.descripcion ?? null, datos.costo_en_puntos, datos.stock, datos.activo],
    );
    await auditar(req, {
      accion: 'CREAR_PRODUCTO',
      entidad: 'productos',
      entidadId: producto?.id,
      nuevos: producto,
    });
    res.status(201).json(producto);
  }),
);

productosRouter.put(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const datos = productoSchema.partial().parse(req.body);
    const previo = await consultarUno<FilaProducto>(`${SELECT_PRODUCTO} WHERE id = $1`, [id]);
    if (!previo) throw noEncontrado('Producto');

    const producto = await consultarUno<FilaProducto>(
      `UPDATE gimnasio.productos
          SET nombre          = COALESCE($2, nombre),
              descripcion     = COALESCE($3, descripcion),
              costo_en_puntos = COALESCE($4, costo_en_puntos),
              stock           = COALESCE($5, stock),
              activo          = COALESCE($6, activo)
        WHERE id = $1
      RETURNING id, nombre, descripcion, costo_en_puntos, stock, activo, creado_en, actualizado_en`,
      [
        id,
        datos.nombre ?? null,
        datos.descripcion ?? null,
        datos.costo_en_puntos ?? null,
        datos.stock ?? null,
        datos.activo ?? null,
      ],
    );
    await auditar(req, {
      accion: 'ACTUALIZAR_PRODUCTO',
      entidad: 'productos',
      entidadId: id,
      previos: previo,
      nuevos: producto,
    });
    res.json(producto);
  }),
);

productosRouter.delete(
  '/:id',
  soloAdministrador,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const previo = await consultarUno<FilaProducto>(`${SELECT_PRODUCTO} WHERE id = $1`, [id]);
    if (!previo) throw noEncontrado('Producto');

    const canjeado = await consultarUno<{ total: string }>(
      'SELECT COUNT(*)::TEXT AS total FROM gimnasio.movimientos_puntos WHERE producto_id = $1',
      [id],
    );

    if (Number(canjeado?.total ?? 0) > 0) {
      await consultarUno('UPDATE gimnasio.productos SET activo = FALSE WHERE id = $1 RETURNING id', [id]);
      await auditar(req, {
        accion: 'DESACTIVAR_PRODUCTO',
        entidad: 'productos',
        entidadId: id,
        previos: previo,
      });
      res.json({ mensaje: 'El producto tiene canjes registrados: se desactivó en lugar de eliminarse' });
      return;
    }

    await consultarUno('DELETE FROM gimnasio.productos WHERE id = $1 RETURNING id', [id]);
    await auditar(req, {
      accion: 'ELIMINAR_PRODUCTO',
      entidad: 'productos',
      entidadId: id,
      previos: previo,
    });
    res.json({ mensaje: 'Producto eliminado correctamente' });
  }),
);
