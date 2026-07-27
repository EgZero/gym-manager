import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { consultarUno } from '../db';
import { AppError, noAutorizado, prohibido } from '../errors';
import { firmarToken, requiereAutenticacion, type Rol } from '../middleware/auth';
import { asyncHandler, auditar } from '../utils';

export const authRouter = Router();

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intente en 15 minutos.' },
});

const loginSchema = z.object({
  usuario: z.string().trim().min(3).max(40),
  password: z.string().min(1).max(200),
});

interface FilaStaff {
  id: number;
  usuario: string;
  hash_password: string;
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
}

authRouter.post(
  '/login',
  limitadorLogin,
  asyncHandler(async (req, res) => {
    const { usuario, password } = loginSchema.parse(req.body);

    const staff = await consultarUno<FilaStaff>(
      `SELECT id, usuario, hash_password, nombre_completo, rol, activo,
              intentos_fallidos, bloqueado_hasta
         FROM gimnasio.staff
        WHERE usuario = $1`,
      [usuario],
    );

    // Respuesta uniforme para no filtrar qué usuarios existen (RNF-01)
    if (!staff) throw noAutorizado('Usuario o contraseña incorrectos');

    if (staff.bloqueado_hasta && staff.bloqueado_hasta > new Date()) {
      throw new AppError(
        423,
        `Cuenta bloqueada temporalmente hasta ${staff.bloqueado_hasta.toISOString()}`,
        'BLOQUEADO',
      );
    }
    if (!staff.activo) throw prohibido('La cuenta está desactivada. Contacte al administrador.');

    const valida = await bcrypt.compare(password, staff.hash_password);
    if (!valida) {
      const intentos = staff.intentos_fallidos + 1;
      const debeBloquear = intentos >= config.seguridad.maxIntentosLogin;
      await consultarUno(
        `UPDATE gimnasio.staff
            SET intentos_fallidos = $2,
                bloqueado_hasta = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE bloqueado_hasta END
          WHERE id = $1
          RETURNING id`,
        [staff.id, debeBloquear ? 0 : intentos, debeBloquear, config.seguridad.bloqueoMinutos],
      );
      throw noAutorizado('Usuario o contraseña incorrectos');
    }

    await consultarUno(
      `UPDATE gimnasio.staff
          SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now()
        WHERE id = $1 RETURNING id`,
      [staff.id],
    );

    const sesion = {
      id: staff.id,
      usuario: staff.usuario,
      nombre: staff.nombre_completo,
      rol: staff.rol,
    };
    req.sesion = sesion;
    await auditar(req, { accion: 'LOGIN', entidad: 'staff', entidadId: staff.id });

    res.json({ token: firmarToken(sesion), usuario: sesion });
  }),
);

authRouter.get(
  '/perfil',
  requiereAutenticacion,
  asyncHandler(async (req, res) => {
    const perfil = await consultarUno(
      `SELECT id, usuario, nombre_completo, correo, telefono, rol, ultimo_acceso
         FROM gimnasio.staff WHERE id = $1`,
      [req.sesion?.id],
    );
    res.json(perfil);
  }),
);

const cambioPasswordSchema = z.object({
  passwordActual: z.string().min(1),
  passwordNueva: z.string().min(8).max(200),
});

authRouter.post(
  '/cambiar-password',
  requiereAutenticacion,
  asyncHandler(async (req, res) => {
    const { passwordActual, passwordNueva } = cambioPasswordSchema.parse(req.body);
    const staff = await consultarUno<{ hash_password: string }>(
      'SELECT hash_password FROM gimnasio.staff WHERE id = $1',
      [req.sesion?.id],
    );
    if (!staff || !(await bcrypt.compare(passwordActual, staff.hash_password))) {
      throw noAutorizado('La contraseña actual no es correcta');
    }
    const hash = await bcrypt.hash(passwordNueva, 10);
    await consultarUno(
      'UPDATE gimnasio.staff SET hash_password = $2 WHERE id = $1 RETURNING id',
      [req.sesion?.id, hash],
    );
    await auditar(req, {
      accion: 'CAMBIAR_PASSWORD',
      entidad: 'staff',
      entidadId: req.sesion?.id,
    });
    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  }),
);
