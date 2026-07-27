/**
 * Runner de migraciones SQL versionadas.
 * Aplica en orden los archivos de backend/db/migrations que aún no estén registrados
 * en gimnasio.schema_migrations. Es idempotente y seguro de ejecutar en cada despliegue.
 *
 *   npm run migrate           (desarrollo, vía tsx)
 *   npm run migrate:prod      (producción, desde dist/)
 *
 * Usa MIGRATION_DATABASE_URL si está definida: las migraciones necesitan un rol dueño
 * del esquema, mientras que la API corre con el rol restringido `gymapp`.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from '../config';

const DIRECTORIO_MIGRACIONES = resolve(__dirname, '../../db/migrations');

const pool = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

const cerrarPool = (): Promise<void> => pool.end();

async function asegurarTablaControl(): Promise<void> {
  await pool.query('CREATE SCHEMA IF NOT EXISTS gimnasio');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gimnasio.schema_migrations (
      version    TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function migrar(): Promise<void> {
  await asegurarTablaControl();

  const archivos = readdirSync(DIRECTORIO_MIGRACIONES)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort();

  const { rows: aplicadas } = await pool.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM gimnasio.schema_migrations',
  );
  const registradas = new Map(aplicadas.map((f) => [f.version, f.checksum]));

  let nuevas = 0;
  for (const archivo of archivos) {
    const sql = readFileSync(join(DIRECTORIO_MIGRACIONES, archivo), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previa = registradas.get(archivo);

    if (previa) {
      if (previa !== checksum) {
        throw new Error(
          `La migración ${archivo} ya fue aplicada pero su contenido cambió. ` +
            'Cree una nueva migración en lugar de editar una existente.',
        );
      }
      continue;
    }

    console.log(`[migrate] aplicando ${archivo}`);
    const cliente = await pool.connect();
    try {
      await cliente.query(sql);
      await cliente.query(
        'INSERT INTO gimnasio.schema_migrations (version, checksum) VALUES ($1, $2)',
        [archivo, checksum],
      );
      nuevas += 1;
    } catch (error) {
      console.error(`[migrate] falló ${archivo}`);
      throw error;
    } finally {
      cliente.release();
    }
  }

  console.log(
    nuevas === 0
      ? '[migrate] la base de datos ya está actualizada'
      : `[migrate] ${nuevas} migración(es) aplicada(s)`,
  );
}

migrar()
  .then(() => cerrarPool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('[migrate] error:', error);
    await cerrarPool().catch(() => undefined);
    process.exit(1);
  });
