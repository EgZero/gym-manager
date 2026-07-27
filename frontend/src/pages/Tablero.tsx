import { useEffect, useState } from 'react';
import { api, type UsuarioSesion } from '../api/cliente';
import type { Asistencia, Listado, Tablero as TableroDatos } from '../api/tipos';
import { Mensaje, dinero, fechaHora } from '../components/comunes';

export function Tablero({ usuario }: { usuario: UsuarioSesion }): JSX.Element {
  const [datos, setDatos] = useState<TableroDatos | null>(null);
  const [asistencias, setAsistencias] = useState<Asistencia[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<TableroDatos>('/api/reportes/tablero'),
      api<Listado<Asistencia>>('/api/asistencias/hoy'),
    ])
      .then(([tablero, hoy]) => {
        setDatos(tablero);
        setAsistencias(hoy.datos);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error al cargar el tablero'));
  }, []);

  const esAdmin = usuario.rol === 'ADMINISTRADOR';

  return (
    <>
      <h1>Tablero</h1>
      <p className="subtitulo">
        Resumen operativo del gimnasio · {new Date().toLocaleDateString('es-HN')}
      </p>
      <Mensaje tipo="error" texto={error} />

      <div className="tarjetas">
        <div className="tarjeta">
          <div className="etiqueta">Socios activos</div>
          <div className="valor">{datos?.socios_activos ?? '—'}</div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Membresías vigentes</div>
          <div className="valor">{datos?.socios_vigentes ?? '—'}</div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Asistencias de hoy</div>
          <div className="valor">{datos?.asistencias_hoy ?? '—'}</div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Por vencer (7 días)</div>
          <div className="valor">{datos?.membresias_por_vencer ?? '—'}</div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Socios baneados</div>
          <div className="valor">{datos?.socios_baneados ?? '—'}</div>
        </div>
        {esAdmin && (
          <div className="tarjeta">
            <div className="etiqueta">Ingresos del mes</div>
            <div className="valor">{dinero(datos?.ingresos_mes ?? 0)}</div>
          </div>
        )}
      </div>

      {esAdmin && datos?.asistencias_semana && (
        <div className="panel">
          <h2>Asistencias de los últimos 7 días</h2>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Asistencias</th>
                <th style={{ width: '55%' }}></th>
              </tr>
            </thead>
            <tbody>
              {datos.asistencias_semana.map((dia) => {
                const maximo = Math.max(1, ...datos.asistencias_semana!.map((d) => d.total));
                return (
                  <tr key={dia.fecha}>
                    <td>{new Date(dia.fecha).toLocaleDateString('es-HN')}</td>
                    <td>{dia.total}</td>
                    <td>
                      <div className="barra-progreso">
                        <div style={{ width: `${(dia.total / maximo) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>Ingresos de hoy al gimnasio</h2>
        {asistencias.length === 0 ? (
          <div className="vacio">Todavía no hay asistencias registradas hoy.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Socio</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              {asistencias.map((a) => (
                <tr key={a.id}>
                  <td>{a.documento}</td>
                  <td>{a.socio}</td>
                  <td>{fechaHora(a.hora_ingreso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
