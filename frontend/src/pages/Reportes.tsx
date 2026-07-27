import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import { Mensaje, dinero, fechaHora } from '../components/comunes';

interface IngresoPorPlan {
  plan: string;
  operaciones: number;
  ingresos: string;
}

interface RespuestaIngresos {
  desde: string;
  hasta: string;
  total: number;
  datos: IngresoPorPlan[];
}

interface EventoAuditoria {
  id: number;
  usuario: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  ip: string | null;
  creado_en: string;
}

const hoy = new Date().toISOString().slice(0, 10);
const inicioMes = `${hoy.slice(0, 8)}01`;

export function Reportes(): JSX.Element {
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy);
  const [ingresos, setIngresos] = useState<RespuestaIngresos | null>(null);
  const [auditoria, setAuditoria] = useState<EventoAuditoria[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [reporte, log] = await Promise.all([
        api<RespuestaIngresos>(`/api/reportes/ingresos?desde=${desde}&hasta=${hasta}`),
        api<{ datos: EventoAuditoria[] }>('/api/reportes/auditoria?limite=30'),
      ]);
      setIngresos(reporte);
      setAuditoria(log.datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los reportes');
    }
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <>
      <h1>Reportes</h1>
      <p className="subtitulo">Ingresos por plan y bitácora de auditoría del sistema.</p>

      <Mensaje tipo="error" texto={error} />

      <div className="panel">
        <h2>Ingresos por plan</h2>
        <div className="fila">
          <div>
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <button onClick={() => void cargar()}>Actualizar</button>
        </div>

        {!ingresos || ingresos.datos.length === 0 ? (
          <div className="vacio">No hay ingresos registrados en el rango seleccionado.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Operaciones</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {ingresos.datos.map((fila) => (
                <tr key={fila.plan}>
                  <td>{fila.plan}</td>
                  <td>{fila.operaciones}</td>
                  <td>{dinero(fila.ingresos)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td />
                <td>
                  <strong>{dinero(ingresos.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Auditoría reciente</h2>
        {auditoria.length === 0 ? (
          <div className="vacio">Sin eventos registrados.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>ID</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {auditoria.map((evento) => (
                <tr key={evento.id}>
                  <td>{fechaHora(evento.creado_en)}</td>
                  <td>{evento.usuario}</td>
                  <td>{evento.accion.replace(/_/g, ' ')}</td>
                  <td>{evento.entidad}</td>
                  <td>{evento.entidad_id ?? '—'}</td>
                  <td>{evento.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
