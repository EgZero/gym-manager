import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { esProduccion } from '../config';

interface ErrorPostgres {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

const MENSAJES_RESTRICCION: Record<string, string> = {
  socios_documento_key: 'Ya existe un socio con ese documento',
  staff_usuario_key: 'Ya existe un usuario con ese nombre',
  staff_correo_key: 'Ya existe un usuario con ese correo',
  planes_nombre_key: 'Ya existe un plan con ese nombre',
  promociones_codigo_key: 'Ya existe una promoción con ese código',
  productos_nombre_key: 'Ya existe un producto con ese nombre',
  ux_asistencia_dia: 'El socio ya registró su asistencia el día de hoy',
  ux_membresia_vigente_por_socio: 'El socio ya tiene una membresía vigente',
};

export function manejadorErrores(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.estado).json({
      error: error.message,
      codigo: error.codigo,
      detalles: error.detalles,
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Datos inválidos',
      codigo: 'VALIDACION',
      detalles: error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensaje: i.message,
      })),
    });
    return;
  }

  const pg = error as ErrorPostgres;
  if (pg?.code === '23505') {
    const mensaje = (pg.constraint && MENSAJES_RESTRICCION[pg.constraint]) ?? 'Registro duplicado';
    res.status(409).json({ error: mensaje, codigo: 'DUPLICADO' });
    return;
  }
  if (pg?.code === '23503') {
    res.status(409).json({
      error: 'La operación viola una referencia existente',
      codigo: 'REFERENCIA',
    });
    return;
  }
  // Excepciones RAISE de los triggers de negocio (saldo, baneo, membresía)
  if (pg?.code === '23514' || pg?.code === 'P0001') {
    res.status(409).json({
      error: pg.message ?? 'Regla de negocio violada',
      codigo: 'REGLA_NEGOCIO',
    });
    return;
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({
    error: 'Error interno del servidor',
    codigo: 'INTERNO',
    detalles: esProduccion ? undefined : String(error),
  });
}

export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}
