import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: config.db.maxConexiones,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('connect', (cliente) => {
  void cliente.query('SET search_path TO gimnasio, public');
});

pool.on('error', (error) => {
  console.error('[db] error inesperado en el pool:', error.message);
});

export async function consultar<T extends QueryResultRow>(
  sql: string,
  parametros: readonly unknown[] = [],
): Promise<T[]> {
  const resultado = await pool.query<T>(sql, parametros as unknown[]);
  return resultado.rows;
}

export async function consultarUno<T extends QueryResultRow>(
  sql: string,
  parametros: readonly unknown[] = [],
): Promise<T | null> {
  const filas = await consultar<T>(sql, parametros);
  return filas[0] ?? null;
}

/** Ejecuta la función dentro de una transacción, con COMMIT/ROLLBACK automático. */
export async function enTransaccion<T>(
  trabajo: (cliente: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

export async function cerrarPool(): Promise<void> {
  await pool.end();
}
