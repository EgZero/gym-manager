const BASE = import.meta.env.VITE_API_URL ?? '';
const CLAVE_TOKEN = 'gym.token';
const CLAVE_USUARIO = 'gym.usuario';

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
  token: (): string | null => localStorage.getItem(CLAVE_TOKEN),
  usuario: (): UsuarioSesion | null => {
    const crudo = localStorage.getItem(CLAVE_USUARIO);
    return crudo ? (JSON.parse(crudo) as UsuarioSesion) : null;
  },
  guardar: (token: string, usuario: UsuarioSesion): void => {
    localStorage.setItem(CLAVE_TOKEN, token);
    localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
  },
  limpiar: (): void => {
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem(CLAVE_USUARIO);
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
