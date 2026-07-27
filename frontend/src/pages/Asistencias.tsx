import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/cliente';
import type { Asistencia, Listado } from '../api/tipos';
import { Mensaje, fechaHora } from '../components/comunes';

interface RespuestaCheckin {
  socio: {
    nombre_completo: string;
    plan_nombre: string | null;
    dias_restantes: number;
    dias_asistidos: number;
    dias_faltados: number;
    puntos: number;
  };
}

export function Asistencias({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const [documento, setDocumento] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [asistencias, setAsistencias] = useState<Asistencia[]>([]);

  const cargar = useCallback(async () => {
    try {
      setAsistencias((await api<Listado<Asistencia>>('/api/asistencias/hoy')).datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar asistencias');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function registrar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setExito(null);
    setRegistrando(true);
    try {
      const respuesta = await api<RespuestaCheckin>('/api/asistencias', {
        metodo: 'POST',
        cuerpo: { documento: documento.trim() },
      });
      const s = respuesta.socio;
      setExito(
        `Ingreso registrado: ${s.nombre_completo} · ${s.plan_nombre ?? 'sin plan'} · ` +
          `${s.dias_restantes} días restantes · ${s.dias_asistidos} asistidos / ${s.dias_faltados} faltados · ` +
          `${s.puntos} puntos`,
      );
      setDocumento('');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la asistencia');
    } finally {
      setRegistrando(false);
    }
  }

  async function eliminar(id: number): Promise<void> {
    if (!confirm('¿Eliminar esta asistencia?')) return;
    try {
      await api(`/api/asistencias/${id}`, { metodo: 'DELETE' });
      setExito('Asistencia eliminada');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la asistencia');
    }
  }

  return (
    <>
      <h1>Control de asistencias</h1>
      <p className="subtitulo">
        Registre el ingreso del socio por documento. Los días del plan corren por calendario, asista o no.
      </p>

      <Mensaje tipo="error" texto={error} />
      <Mensaje tipo="exito" texto={exito} />

      <div className="panel">
        <h2>Registrar ingreso</h2>
        <form className="fila" onSubmit={registrar}>
          <div className="crecer">
            <input
              placeholder="Documento del socio"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button type="submit" disabled={registrando}>
            {registrando ? 'Registrando…' : 'Registrar asistencia'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Asistencias de hoy ({asistencias.length})</h2>
        {asistencias.length === 0 ? (
          <div className="vacio">Todavía no hay ingresos registrados hoy.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Socio</th>
                <th>Hora</th>
                {esAdmin && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {asistencias.map((a) => (
                <tr key={a.id}>
                  <td>{a.documento}</td>
                  <td>{a.socio}</td>
                  <td>{fechaHora(a.hora_ingreso)}</td>
                  {esAdmin && (
                    <td>
                      <button className="peligro pequeno" onClick={() => void eliminar(a.id)}>
                        Eliminar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
