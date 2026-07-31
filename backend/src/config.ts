import 'dotenv/config';

const entorno = process.env.NODE_ENV ?? 'development';
export const esProduccion = entorno === 'production';

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

const secretoJwt = requerido(
  'JWT_SECRET',
  esProduccion ? undefined : 'secreto-de-desarrollo-no-usar-en-produccion',
);
const origenCors = (process.env.CORS_ORIGIN ?? (esProduccion ? '' : 'http://localhost:5173'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const urlBaseDatos = process.env.DATABASE_URL ?? (esProduccion ? undefined : 'postgresql://gymapp:devlocal@127.0.0.1:5432/gymdb');

if (esProduccion && !urlBaseDatos) {
  throw new Error('DATABASE_URL debe definirse en producción');
}

if (esProduccion && (!origenCors.length || origenCors.includes('*'))) {
  throw new Error('CORS_ORIGIN debe definir un origen explícito en producción');
}

if (esProduccion && secretoJwt.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}

if (esProduccion && secretoJwt === 'secreto-de-desarrollo-no-usar-en-produccion') {
  throw new Error('JWT_SECRET no puede usar el valor de desarrollo en producción');
}

export const config = {
  entorno,
  puerto: numero('PORT', 4000),
  origenCors,
  db: {
    url: requerido('DATABASE_URL', urlBaseDatos),
    ssl: process.env.PGSSL === 'true',
    maxConexiones: numero('PG_MAX_POOL', 10),
  },
  jwt: {
    secreto: secretoJwt,
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
