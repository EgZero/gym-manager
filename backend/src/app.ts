import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config, esProduccion } from './config';
import { consultarUno } from './db';
import { requiereAutenticacion } from './middleware/auth';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errores';
import { asyncHandler } from './utils';
import { authRouter } from './routes/auth';
import { staffRouter } from './routes/staff';
import { planesRouter } from './routes/planes';
import { promocionesRouter } from './routes/promociones';
import { sociosRouter } from './routes/socios';
import { membresiasRouter } from './routes/membresias';
import { asistenciasRouter } from './routes/asistencias';
import { productosRouter } from './routes/productos';
import { puntosRouter } from './routes/puntos';
import { reportesRouter } from './routes/reportes';

export function crearApp(): Express {
  const app = express();

  app.set('trust proxy', 1); // detrás de Nginx
  app.use(helmet());
  app.use(
    cors({
      origin: config.origenCors.includes('*') ? true : config.origenCors,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(morgan(esProduccion ? 'combined' : 'dev'));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      const fila = await consultarUno<{ ok: number }>('SELECT 1 AS ok');
      res.json({
        estado: 'ok',
        base_datos: fila?.ok === 1 ? 'conectada' : 'sin respuesta',
        entorno: config.entorno,
        version: process.env.APP_VERSION ?? 'dev',
        hora: new Date().toISOString(),
      });
    }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/staff', requiereAutenticacion, staffRouter);
  app.use('/api/planes', requiereAutenticacion, planesRouter);
  app.use('/api/promociones', requiereAutenticacion, promocionesRouter);
  app.use('/api/socios', requiereAutenticacion, sociosRouter);
  app.use('/api/membresias', requiereAutenticacion, membresiasRouter);
  app.use('/api/asistencias', requiereAutenticacion, asistenciasRouter);
  app.use('/api/productos', requiereAutenticacion, productosRouter);
  app.use('/api/puntos', requiereAutenticacion, puntosRouter);
  app.use('/api/reportes', requiereAutenticacion, reportesRouter);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}
