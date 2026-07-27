/**
 * Pruebas de integración de la API contra una base PostgreSQL real.
 * En CI el servicio de Postgres lo levanta .github/workflows/ci.yml.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import type { Express } from 'express';

process.env.JWT_SECRET ??= 'secreto-de-pruebas-con-mas-de-32-caracteres!!';
process.env.DATABASE_URL ??= 'postgresql://gymapp:devlocal@127.0.0.1:5432/gymdb';
process.env.NODE_ENV = 'test';

// Las importaciones se hacen después de fijar el entorno para que config.ts lo lea.
/* eslint-disable @typescript-eslint/no-var-requires */
const { crearApp } = require('../src/app') as typeof import('../src/app');
const { cerrarPool, consultarUno } = require('../src/db') as typeof import('../src/db');
/* eslint-enable @typescript-eslint/no-var-requires */

let app: Express;
let tokenAdmin = '';
let tokenOperador = '';
const documentoPrueba = `TEST${Date.now()}`.slice(0, 20);
let socioId = 0;
let planId = 0;

before(async () => {
  app = crearApp();
  const admin = await request(app)
    .post('/api/auth/login')
    .send({ usuario: 'admin', password: 'Admin.2026' });
  assert.equal(admin.status, 200, `login admin falló: ${JSON.stringify(admin.body)}`);
  tokenAdmin = admin.body.token;

  const operador = await request(app)
    .post('/api/auth/login')
    .send({ usuario: 'operador', password: 'Operador.2026' });
  assert.equal(operador.status, 200);
  tokenOperador = operador.body.token;
});

after(async () => {
  if (socioId) {
    await consultarUno('DELETE FROM gimnasio.socios WHERE id = $1 RETURNING id', [socioId]).catch(
      () => undefined,
    );
  }
  if (planId) {
    await consultarUno('DELETE FROM gimnasio.planes WHERE id = $1 RETURNING id', [planId]).catch(
      () => undefined,
    );
  }
  await cerrarPool();
});

describe('salud y autenticación', () => {
  it('responde el healthcheck sin token', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.base_datos, 'conectada');
  });

  it('rechaza credenciales inválidas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'admin', password: 'clave-incorrecta' });
    assert.equal(res.status, 401);
  });

  it('bloquea rutas protegidas sin token', async () => {
    const res = await request(app).get('/api/socios');
    assert.equal(res.status, 401);
  });
});

describe('RN-01 · el alta de staff es exclusiva de PostgreSQL', () => {
  it('la API rechaza crear staff aunque el actor sea administrador', async () => {
    const res = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ usuario: 'nuevo', password: 'Clave.1234', rol: 'OPERADOR' });
    assert.equal(res.status, 403);
    assert.equal(res.body.codigo, 'ALTA_SOLO_EN_POSTGRES');
  });

  it('el operador no puede listar staff', async () => {
    const res = await request(app)
      .get('/api/staff')
      .set('Authorization', `Bearer ${tokenOperador}`);
    assert.equal(res.status, 403);
  });
});

describe('CRUD de planes', () => {
  it('el administrador crea, actualiza y elimina un plan', async () => {
    const creado = await request(app)
      .post('/api/planes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Plan de prueba ${Date.now()}`,
        precio: 100,
        duracion_dias: 30,
        puntos_otorgados: 10,
      });
    assert.equal(creado.status, 201);
    planId = creado.body.id;

    const actualizado = await request(app)
      .put(`/api/planes/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precio: 150 });
    assert.equal(actualizado.status, 200);
    assert.equal(Number(actualizado.body.precio), 150);

    const detalle = await request(app)
      .get(`/api/planes/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    assert.equal(detalle.body.historial_precios.length, 1);
  });

  it('el operador no puede crear planes', async () => {
    const res = await request(app)
      .post('/api/planes')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ nombre: 'No permitido', precio: 10, duracion_dias: 30 });
    assert.equal(res.status, 403);
  });
});

describe('CRUD de socios, membresías, asistencias y puntos', () => {
  it('el operador registra un socio', async () => {
    const res = await request(app)
      .post('/api/socios')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({
        documento: documentoPrueba,
        nombres: 'Socio',
        apellidos: 'De Prueba',
        correo: 'socio.prueba@mail.com',
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    socioId = res.body.id;
    assert.equal(res.body.estado_membresia, 'SIN_MEMBRESIA');
    assert.equal(res.body.puntos, 0);
  });

  it('rechaza documentos duplicados', async () => {
    const res = await request(app)
      .post('/api/socios')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ documento: documentoPrueba, nombres: 'Otro', apellidos: 'Socio' });
    assert.equal(res.status, 409);
  });

  it('impide el check-in sin membresía vigente', async () => {
    const res = await request(app)
      .post('/api/asistencias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId });
    assert.equal(res.status, 409);
  });

  it('vende una membresía y acredita puntos', async () => {
    const res = await request(app)
      .post('/api/membresias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId, plan_id: planId, metodo_pago: 'EFECTIVO' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.precio_final, 150);
    assert.equal(res.body.puntos_acreditados, 10);
  });

  it('impide dos membresías vigentes solapadas', async () => {
    const res = await request(app)
      .post('/api/membresias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId, plan_id: planId });
    assert.equal(res.status, 409);
  });

  it('registra la asistencia y cuenta días por calendario', async () => {
    const res = await request(app)
      .post('/api/asistencias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ documento: documentoPrueba });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.socio.dias_asistidos, 1);
    assert.equal(res.body.socio.dias_restantes, 30);
    // Día 0 del plan: aún no transcurrió ningún día, por eso no hay faltas
    assert.equal(res.body.socio.dias_faltados, 0);
  });

  it('rechaza una segunda asistencia el mismo día', async () => {
    const res = await request(app)
      .post('/api/asistencias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ documento: documentoPrueba });
    assert.equal(res.status, 409);
  });

  it('rechaza un canje con saldo insuficiente', async () => {
    const productos = await request(app)
      .get('/api/productos?solo_disponibles=true')
      .set('Authorization', `Bearer ${tokenOperador}`);
    const caro = productos.body.datos.at(-1);
    const res = await request(app)
      .post('/api/puntos/canjear/producto')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId, producto_id: caro.id });
    assert.equal(res.status, 422);
  });

  it('canjea puntos por un producto tras un ajuste del administrador', async () => {
    const productos = await request(app)
      .get('/api/productos?solo_disponibles=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const producto = productos.body.datos[0];

    const ajuste = await request(app)
      .post('/api/puntos/ajuste')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ socio_id: socioId, puntos: producto.costo_en_puntos, motivo: 'Ajuste de prueba' });
    assert.equal(ajuste.status, 201);

    const canje = await request(app)
      .post('/api/puntos/canjear/producto')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId, producto_id: producto.id });
    assert.equal(canje.status, 201, JSON.stringify(canje.body));
    assert.equal(canje.body.puntos_debitados, producto.costo_en_puntos);
  });

  it('el administrador banea al socio y bloquea su acceso', async () => {
    const baneo = await request(app)
      .post(`/api/socios/${socioId}/banear`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Prueba automatizada de baneo' });
    assert.equal(baneo.status, 200);
    assert.equal(baneo.body.baneado, true);

    const compra = await request(app)
      .post('/api/membresias')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ socio_id: socioId, plan_id: planId });
    assert.equal(compra.status, 409);

    const desbaneo = await request(app)
      .post(`/api/socios/${socioId}/desbanear`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    assert.equal(desbaneo.body.baneado, false);
  });

  it('el operador no puede banear socios', async () => {
    const res = await request(app)
      .post(`/api/socios/${socioId}/banear`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ motivo: 'Intento no autorizado' });
    assert.equal(res.status, 403);
  });

  it('da de baja lógica al socio con historial', async () => {
    const res = await request(app)
      .delete(`/api/socios/${socioId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    assert.equal(res.status, 200);
    assert.match(res.body.mensaje, /baja lógica/);
  });
});

describe('reportes', () => {
  it('el tablero del administrador incluye datos financieros', async () => {
    const res = await request(app)
      .get('/api/reportes/tablero')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    assert.equal(res.status, 200);
    assert.ok('ingresos_mes' in res.body);
  });

  it('el tablero del operador no expone ingresos', async () => {
    const res = await request(app)
      .get('/api/reportes/tablero')
      .set('Authorization', `Bearer ${tokenOperador}`);
    assert.equal(res.status, 200);
    assert.ok(!('ingresos_mes' in res.body));
  });
});
