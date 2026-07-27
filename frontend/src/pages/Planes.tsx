import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Listado, Plan } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal, dinero } from '../components/comunes';

interface FormPlan {
  nombre: string;
  descripcion: string;
  precio: string;
  duracion_dias: string;
  puntos_otorgados: string;
  costo_en_puntos: string;
  activo: boolean;
}

const FORM_VACIO: FormPlan = {
  nombre: '',
  descripcion: '',
  precio: '',
  duracion_dias: '30',
  puntos_otorgados: '0',
  costo_en_puntos: '',
  activo: true,
};

export function Planes({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<FormPlan | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setPlanes((await api<Listado<Plan>>('/api/planes?incluir_inactivos=true')).datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los planes');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar(): Promise<void> {
    if (!formulario) return;
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = {
        nombre: formulario.nombre,
        descripcion: formulario.descripcion || null,
        precio: Number(formulario.precio),
        duracion_dias: Number(formulario.duracion_dias),
        puntos_otorgados: Number(formulario.puntos_otorgados),
        costo_en_puntos: formulario.costo_en_puntos ? Number(formulario.costo_en_puntos) : null,
        activo: formulario.activo,
      };
      if (editandoId) {
        await api(`/api/planes/${editandoId}`, { metodo: 'PUT', cuerpo });
        setExito('Plan actualizado. El precio anterior quedó en el histórico.');
      } else {
        await api('/api/planes', { metodo: 'POST', cuerpo });
        setExito('Plan creado correctamente');
      }
      setFormulario(null);
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el plan');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(plan: Plan): Promise<void> {
    if (!confirm(`¿Eliminar el plan "${plan.nombre}"?`)) return;
    try {
      const respuesta = await api<{ mensaje: string }>(`/api/planes/${plan.id}`, { metodo: 'DELETE' });
      setExito(respuesta.mensaje);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el plan');
    }
  }

  return (
    <>
      <h1>Planes y costos de mensualidad</h1>
      <p className="subtitulo">
        {esAdmin
          ? 'Cree, actualice o retire los planes. Los precios ya vendidos no se modifican.'
          : 'Consulta de precios vigentes (solo el administrador puede modificarlos).'}
      </p>

      <Mensaje tipo="error" texto={error} />
      <Mensaje tipo="exito" texto={exito} />

      {esAdmin && (
        <div className="fila">
          <button
            onClick={() => {
              setFormulario(FORM_VACIO);
              setEditandoId(null);
            }}
          >
            + Nuevo plan
          </button>
        </div>
      )}

      <div className="panel">
        {planes.length === 0 ? (
          <div className="vacio">No hay planes registrados.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Descripción</th>
                <th>Precio</th>
                <th>Duración</th>
                <th>Puntos que otorga</th>
                <th>Canjeable por</th>
                <th>Estado</th>
                {esAdmin && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {planes.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.nombre}</strong>
                  </td>
                  <td>{plan.descripcion ?? '—'}</td>
                  <td>{dinero(plan.precio)}</td>
                  <td>{plan.duracion_dias} días</td>
                  <td>{plan.puntos_otorgados}</td>
                  <td>{plan.costo_en_puntos ? `${plan.costo_en_puntos} pts` : '—'}</td>
                  <td>
                    <Insignia estado={plan.activo ? 'VIGENTE' : 'NEUTRA'} />
                  </td>
                  {esAdmin && (
                    <td>
                      <div className="acciones">
                        <button
                          className="secundario pequeno"
                          onClick={() => {
                            setEditandoId(plan.id);
                            setFormulario({
                              nombre: plan.nombre,
                              descripcion: plan.descripcion ?? '',
                              precio: String(plan.precio),
                              duracion_dias: String(plan.duracion_dias),
                              puntos_otorgados: String(plan.puntos_otorgados),
                              costo_en_puntos: plan.costo_en_puntos ? String(plan.costo_en_puntos) : '',
                              activo: plan.activo,
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button className="peligro pequeno" onClick={() => void eliminar(plan)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formulario && (
        <Modal
          titulo={editandoId ? 'Editar plan' : 'Nuevo plan'}
          alCerrar={() => {
            setFormulario(null);
            setEditandoId(null);
          }}
          alGuardar={() => void guardar()}
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Nombre *" anchoTotal>
              <input
                value={formulario.nombre}
                onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Descripción" anchoTotal>
              <textarea
                rows={2}
                value={formulario.descripcion}
                onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Precio (L.) *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formulario.precio}
                onChange={(e) => setFormulario({ ...formulario, precio: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Duración (días) *">
              <input
                type="number"
                min="1"
                value={formulario.duracion_dias}
                onChange={(e) => setFormulario({ ...formulario, duracion_dias: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Puntos que otorga">
              <input
                type="number"
                min="0"
                value={formulario.puntos_otorgados}
                onChange={(e) => setFormulario({ ...formulario, puntos_otorgados: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Costo en puntos (canje)">
              <input
                type="number"
                min="1"
                placeholder="Vacío = no canjeable"
                value={formulario.costo_en_puntos}
                onChange={(e) => setFormulario({ ...formulario, costo_en_puntos: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Activo" anchoTotal>
              <select
                value={formulario.activo ? 'si' : 'no'}
                onChange={(e) => setFormulario({ ...formulario, activo: e.target.value === 'si' })}
              >
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </Campo>
          </div>
        </Modal>
      )}
    </>
  );
}
