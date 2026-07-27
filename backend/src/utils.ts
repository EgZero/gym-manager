import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db';

/** Envuelve un handler asíncrono para que sus rechazos lleguen al manejador de errores. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const idParam = z.coerce.number().int().positive();

export const paginacionSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export function offset(pagina: number, limite: number): number {
  return (pagina - 1) * limite;
}

/** Registra una operación de escritura en gimnasio.auditoria (RF-11). */
export async function auditar(
  req: Request,
  datos: {
    accion: string;
    entidad: string;
    entidadId?: number | string | null;
    previos?: unknown;
    nuevos?: unknown;
  },
  cliente?: PoolClient,
): Promise<void> {
  const ejecutor = cliente ?? pool;
  try {
    await ejecutor.query(
      `INSERT INTO gimnasio.auditoria
         (staff_id, usuario, accion, entidad, entidad_id, datos_previos, datos_nuevos, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.sesion?.id ?? null,
        req.sesion?.usuario ?? 'anonimo',
        datos.accion,
        datos.entidad,
        datos.entidadId != null ? String(datos.entidadId) : null,
        datos.previos ? JSON.stringify(datos.previos) : null,
        datos.nuevos ? JSON.stringify(datos.nuevos) : null,
        req.ip ?? null,
      ],
    );
  } catch (error) {
    // La auditoría nunca debe tumbar la operación principal
    console.error('[auditoria] no se pudo registrar el evento:', error);
  }
}
