import { crearApp } from './app';
import { config } from './config';
import { cerrarPool, consultarUno } from './db';

async function principal(): Promise<void> {
  await consultarUno('SELECT 1');
  console.log('[db] conexión verificada');

  const app = crearApp();
  const servidor = app.listen(config.puerto, () => {
    console.log(`[api] GymManager escuchando en el puerto ${config.puerto} (${config.entorno})`);
  });

  const apagar = (senal: string): void => {
    console.log(`[api] recibido ${senal}, cerrando de forma ordenada...`);
    servidor.close(() => {
      void cerrarPool().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
}

principal().catch((error) => {
  console.error('[api] no se pudo iniciar el servidor:', error);
  process.exit(1);
});
