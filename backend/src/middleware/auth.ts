import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { noAutorizado, prohibido } from '../errors';

export type Rol = 'ADMINISTRADOR' | 'OPERADOR';

export interface Sesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

declare module 'express-serve-static-core' {
  interface Request {
    sesion?: Sesion;
  }
}

interface PayloadJwt {
  sub: string;
  usuario: string;
  nombre: string;
  rol: Rol;
}

export function firmarToken(sesion: Sesion): string {
  const payload: PayloadJwt = {
    sub: String(sesion.id),
    usuario: sesion.usuario,
    nombre: sesion.nombre,
    rol: sesion.rol,
  };
  return jwt.sign(payload, config.jwt.secreto, {
    expiresIn: config.jwt.expiracion,
  } as jwt.SignOptions);
}

export function requiereAutenticacion(req: Request, _res: Response, next: NextFunction): void {
  const cabecera = req.headers.authorization;
  if (!cabecera?.startsWith('Bearer ')) {
    next(noAutorizado('Se requiere un token de acceso'));
    return;
  }
  try {
    const payload = jwt.verify(cabecera.slice(7), config.jwt.secreto) as PayloadJwt;
    req.sesion = {
      id: Number(payload.sub),
      usuario: payload.usuario,
      nombre: payload.nombre,
      rol: payload.rol,
    };
    next();
  } catch {
    next(noAutorizado('Token inválido o expirado'));
  }
}

export function requiereRol(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.sesion) {
      next(noAutorizado('Se requiere un token de acceso'));
      return;
    }
    if (!roles.includes(req.sesion.rol)) {
      next(prohibido('No tiene permisos para realizar esta operación'));
      return;
    }
    next();
  };
}

export const soloAdministrador = requiereRol('ADMINISTRADOR');
