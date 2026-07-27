import 'dotenv/config';

function requerido(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre] ?? porDefecto;
  if (valor === undefined || valor === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${nombre}`);
  }
  return valor;
}

function numero(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre];
  if (!crudo) return porDefecto;
  const valor = Number(crudo);
  if (Number.isNaN(valor)) throw new Error(`La variable ${nombre} debe ser numérica`);
  return valor;
}

export const config = {
  entorno: process.env.NODE_ENV ?? 'development',
  puerto: numero('PORT', 4000),
  origenCors: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  db: {
    url: requerido('DATABASE_URL', 'postgresql://gymapp:devlocal@127.0.0.1:5432/gymdb'),
    ssl: process.env.PGSSL === 'true',
    maxConexiones: numero('PG_MAX_POOL', 10),
  },
  jwt: {
    secreto: requerido('JWT_SECRET', 'secreto-de-desarrollo-no-usar-en-produccion'),
    expiracion: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  seguridad: {
    maxIntentosLogin: numero('MAX_INTENTOS_LOGIN', 5),
    bloqueoMinutos: numero('BLOQUEO_MINUTOS', 15),
  },
  negocio: {
    puntosPorAsistencia: numero('PUNTOS_POR_ASISTENCIA', 2),
  },
} as const;

export const esProduccion = config.entorno === 'production';

if (esProduccion && config.jwt.secreto.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}
