export class AppError extends Error {
  constructor(
    readonly estado: number,
    message: string,
    readonly codigo?: string,
    readonly detalles?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const noEncontrado = (recurso: string): AppError =>
  new AppError(404, `${recurso} no encontrado`, 'NO_ENCONTRADO');

export const conflicto = (mensaje: string): AppError =>
  new AppError(409, mensaje, 'CONFLICTO');

export const noProcesable = (mensaje: string): AppError =>
  new AppError(422, mensaje, 'NO_PROCESABLE');

export const prohibido = (mensaje: string): AppError =>
  new AppError(403, mensaje, 'PROHIBIDO');

export const noAutorizado = (mensaje: string): AppError =>
  new AppError(401, mensaje, 'NO_AUTORIZADO');
