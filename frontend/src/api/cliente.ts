const BASE = import.meta.env.VITE_API_URL ?? '';

let estadoSesion: { token: string | null; usuario: UsuarioSesion | null } = {
  token: null,
  usuario: null,
};

export type Rol = 'ADMINISTRADOR' | 'OPERADOR';

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

export class ApiError extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ApiError';
  }
}

export const sesion = {
  token: (): string | null => estadoSesion.token,
  usuario: (): UsuarioSesion | null => estadoSesion.usuario,
  guardar: (token: string, usuario: UsuarioSesion): void => {
    estadoSesion = { token, usuario };
  },
  limpiar: (): void => {
    estadoSesion = { token: null, usuario: null };
  },
};

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
}

export async function api<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const token = sesion.token();
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  });

  if (respuesta.status === 401 && !ruta.startsWith('/api/auth/login')) {
    sesion.limpiar();
    window.location.hash = '#/login';
    throw new ApiError(401, 'La sesión expiró. Vuelva a iniciar sesión.');
  }

  const texto = await respuesta.text();
  const datos = texto ? (JSON.parse(texto) as unknown) : null;

  if (!respuesta.ok) {
    const cuerpo = datos as { error?: string; codigo?: string; detalles?: unknown } | null;
    const detalles = Array.isArray(cuerpo?.detalles)
      ? ` (${(cuerpo?.detalles as { campo: string; mensaje: string }[])
          .map((d) => `${d.campo}: ${d.mensaje}`)
          .join('; ')})`
      : '';
    throw new ApiError(
      respuesta.status,
      `${cuerpo?.error ?? 'Error inesperado'}${detalles}`,
      cuerpo?.codigo,
    );
  }

  return datos as T;
}
