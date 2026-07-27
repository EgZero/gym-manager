/**
 * Ejecuta los archivos de backend/db/seeds en orden alfabético.
 * Requiere un rol con permiso para ejecutar gimnasio.crear_staff (dueño del esquema),
 * por eso usa MIGRATION_DATABASE_URL cuando está definida.
 *
 *   npm run seed
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from '../config';

const DIRECTORIO_SEEDS = resolve(__dirname, '../../db/seeds');

const pool = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

async function sembrar(): Promise<void> {
  const archivos = readdirSync(DIRECTORIO_SEEDS)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort();

  for (const archivo of archivos) {
    console.log(`[seed] ejecutando ${archivo}`);
    await pool.query(readFileSync(join(DIRECTORIO_SEEDS, archivo), 'utf8'));
  }
  console.log('[seed] datos iniciales cargados');
}

sembrar()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('[seed] error:', error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
