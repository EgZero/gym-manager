import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { consultar, consultarUno } from '../db';
import { AppError, noEncontrado, prohibido } from '../errors';
import { soloAdministrador } from '../middleware/auth';
import { asyncHandler, auditar, idParam } from '../utils';

export const staffRouter = Router();

staffRouter.use(soloAdministrador);

interface FilaStaff {
  id: number;
  usuario: string;
  nombre_completo: string;
  correo: string | null;
  telefono: string | null;
  rol: 'ADMINISTRADOR' | 'OPERADOR';
  activo: boolean;
  ultimo_acceso: Date | null;
  creado_en: Date;
}

const SELECT_STAFF = `
  SELECT id, usuario, nombre_completo, correo, telefono, rol, activo, ultimo_acceso, creado_en
    FROM gimnasio.staff`;

/**
 * RN-01: la creación de staff es exclusiva de PostgreSQL.
 * Se expone el endpoint únicamente para documentar el procedimiento correcto.
 */
staffRouter.post('/', (_req, _res, next) => {
  next(
    new AppError(
      403,
      'Por política del sistema, las cuentas de administrador y operador solo se crean desde ' +
        'PostgreSQL. Ejecute en el servidor: ' +
        "psql -U postgres -d gymdb -c \"SELECT gimnasio.crear_staff('usuario','Clave','Nombre Completo','OPERADOR');\"",
      'ALTA_SOLO_EN_POSTGRES',
    ),
  );
});

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rol, activo } = z
      .object({
        rol: z.enum(['ADMINISTRADOR', 'OPERADOR']).optional(),
        activo: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const filas = await consultar<FilaStaff>(
      `${SELECT_STAFF}
        WHERE ($1::TEXT IS NULL OR rol = $1::gimnasio.rol_staff)
          AND ($2::BOOLEAN IS NULL OR activo = $2::BOOLEAN)
        ORDER BY rol, usuario`,
      [rol ?? null, activo === undefined ? null : activo === 'true'],
    );
    res.json({ datos: filas });
  }),
);

staffRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const fila = await consultarUno<FilaStaff>(`${SELECT_STAFF} WHERE id = $1`, [id]);
    if (!fila) throw noEncontrado('Usuario de staff');
    res.json(fila);
  }),
);

const actualizarSchema = z.object({
  nombre_completo: z.string().trim().min(3).max(120).optional(),
  correo: z.string().trim().email().max(120).nullish(),
  telefono: z.string().trim().max(30).nullish(),
});

/** Un administrador solo puede modificar operadores (RF-02.7) y nunca a sí mismo (RF-02.6). */
async function cargarOperadorEditable(id: number, actorId: number): Promise<FilaStaff> {
  const objetivo = await consultarUno<FilaStaff>(`${SELECT_STAFF} WHERE id = $1`, [id]);
  if (!objetivo) throw noEncontrado('Usuario de staff');
  if (objetivo.id === actorId) throw prohibido('No puede modificar su propia cuenta desde aquí');
  if (objetivo.rol === 'ADMINISTRADOR') {
    throw prohibido('No puede modificar la cuenta de otro administrador');
  }
  return objetivo;
}

staffRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const cambios = actualizarSchema.parse(req.body);
    const previo = await cargarOperadorEditable(id, req.sesion?.id ?? 0);

    const fila = await consultarUno<FilaStaff>(
      `UPDATE gimnasio.staff
          SET nombre_completo = COALESCE($2, nombre_completo),
              correo          = COALESCE($3, correo),
              telefono        = COALESCE($4, telefono)
        WHERE id = $1
      RETURNING id, usuario, nombre_completo, correo, telefono, rol, activo, ultimo_acceso, creado_en`,
      [id, cambios.nombre_completo ?? null, cambios.correo ?? null, cambios.telefono ?? null],
    );
    await auditar(req, {
      accion: 'ACTUALIZAR_STAFF',
      entidad: 'staff',
      entidadId: id,
      previos: previo,
      nuevos: fila,
    });
    res.json(fila);
  }),
);

staffRouter.patch(
  '/:id/estado',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    const previo = await cargarOperadorEditable(id, req.sesion?.id ?? 0);

    const fila = await consultarUno<FilaStaff>(
      `UPDATE gimnasio.staff SET activo = $2, intentos_fallidos = 0, bloqueado_hasta = NULL
        WHERE id = $1
      RETURNING id, usuario, nombre_completo, correo, telefono, rol, activo, ultimo_acceso, creado_en`,
      [id, activo],
    );
    await auditar(req, {
      accion: activo ? 'ACTIVAR_STAFF' : 'DESACTIVAR_STAFF',
      entidad: 'staff',
      entidadId: id,
      previos: { activo: previo.activo },
      nuevos: { activo },
    });
    res.json(fila);
  }),
);

staffRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { passwordNueva } = z
      .object({ passwordNueva: z.string().min(8).max(200) })
      .parse(req.body);
    await cargarOperadorEditable(id, req.sesion?.id ?? 0);

    const hash = await bcrypt.hash(passwordNueva, 10);
    await consultarUno(
      `UPDATE gimnasio.staff
          SET hash_password = $2, intentos_fallidos = 0, bloqueado_hasta = NULL
        WHERE id = $1 RETURNING id`,
      [id, hash],
    );
    await auditar(req, { accion: 'RESET_PASSWORD_STAFF', entidad: 'staff', entidadId: id });
    res.json({ mensaje: 'Contraseña restablecida correctamente' });
  }),
);
