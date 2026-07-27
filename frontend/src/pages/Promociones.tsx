import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Listado, Plan, Promocion } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal, fecha } from '../components/comunes';

interface FormPromocion {
  codigo: string;
  descripcion: string;
  tipo: 'PORCENTAJE' | 'MONTO_FIJO';
  valor: string;
  plan_id: string;
  vigente_desde: string;
  vigente_hasta: string;
  usos_maximos: string;
  activo: boolean;
}

const hoy = (): string => new Date().toISOString().slice(0, 10);

const FORM_VACIO: FormPromocion = {
  codigo: '',
  descripcion: '',
  tipo: 'PORCENTAJE',
  valor: '',
  plan_id: '',
  vigente_desde: hoy(),
  vigente_hasta: '',
  usos_maximos: '',
  activo: true,
};

export function Promociones({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<FormPromocion | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [promos, listaPlanes] = await Promise.all([
        api<Listado<Promocion>>('/api/promociones'),
        api<Listado<Plan>>('/api/planes?incluir_inactivos=true'),
      ]);
      setPromociones(promos.datos);
      setPlanes(listaPlanes.datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar promociones');
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
        codigo: formulario.codigo,
        descripcion: formulario.descripcion,
        tipo: formulario.tipo,
        valor: Number(formulario.valor),
        plan_id: formulario.plan_id ? Number(formulario.plan_id) : null,
        vigente_desde: formulario.vigente_desde,
        vigente_hasta: formulario.vigente_hasta,
        usos_maximos: formulario.usos_maximos ? Number(formulario.usos_maximos) : null,
        activo: formulario.activo,
      };
      if (editandoId) {
        await api(`/api/promociones/${editandoId}`, { metodo: 'PUT', cuerpo });
        setExito('Promoción actualizada');
      } else {
        await api('/api/promociones', { metodo: 'POST', cuerpo });
        setExito('Promoción creada');
      }
      setFormulario(null);
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la promoción');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(promo: Promocion): Promise<void> {
    if (!confirm(`¿Eliminar la promoción ${promo.codigo}?`)) return;
    try {
      const respuesta = await api<{ mensaje: string }>(`/api/promociones/${promo.id}`, {
        metodo: 'DELETE',
      });
      setExito(respuesta.mensaje);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la promoción');
    }
  }

  return (
    <>
      <h1>Promociones</h1>
      <p className="subtitulo">
        Descuentos por porcentaje o monto fijo, con vigencia y cupo de usos.
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
            + Nueva promoción
          </button>
        </div>
      )}

      <div className="panel">
        {promociones.length === 0 ? (
          <div className="vacio">No hay promociones registradas.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Descuento</th>
                <th>Aplica a</th>
                <th>Vigencia</th>
                <th>Usos</th>
                <th>Estado</th>
                {esAdmin && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {promociones.map((promo) => (
                <tr key={promo.id}>
                  <td>
                    <strong>{promo.codigo}</strong>
                  </td>
                  <td>{promo.descripcion}</td>
                  <td>
                    {promo.tipo === 'PORCENTAJE'
                      ? `${Number(promo.valor)}%`
                      : `L. ${Number(promo.valor).toFixed(2)}`}
                  </td>
                  <td>{promo.plan_nombre ?? 'Todos los planes'}</td>
                  <td>
                    {fecha(promo.vigente_desde)} → {fecha(promo.vigente_hasta)}
                  </td>
                  <td>
                    {promo.usos_actuales}
                    {promo.usos_maximos ? ` / ${promo.usos_maximos}` : ''}
                  </td>
                  <td>
                    <Insignia estado={promo.disponible ? 'VIGENTE' : 'VENCIDA'} />
                  </td>
                  {esAdmin && (
                    <td>
                      <div className="acciones">
                        <button
                          className="secundario pequeno"
                          onClick={() => {
                            setEditandoId(promo.id);
                            setFormulario({
                              codigo: promo.codigo,
                              descripcion: promo.descripcion,
                              tipo: promo.tipo,
                              valor: String(promo.valor),
                              plan_id: promo.plan_id ? String(promo.plan_id) : '',
                              vigente_desde: promo.vigente_desde.slice(0, 10),
                              vigente_hasta: promo.vigente_hasta.slice(0, 10),
                              usos_maximos: promo.usos_maximos ? String(promo.usos_maximos) : '',
                              activo: promo.activo,
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button className="peligro pequeno" onClick={() => void eliminar(promo)}>
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
          titulo={editandoId ? 'Editar promoción' : 'Nueva promoción'}
          alCerrar={() => {
            setFormulario(null);
            setEditandoId(null);
          }}
          alGuardar={() => void guardar()}
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Código *">
              <input
                value={formulario.codigo}
                onChange={(e) => setFormulario({ ...formulario, codigo: e.target.value.toUpperCase() })}
              />
            </Campo>
            <Campo etiqueta="Tipo *">
              <select
                value={formulario.tipo}
                onChange={(e) =>
                  setFormulario({ ...formulario, tipo: e.target.value as FormPromocion['tipo'] })
                }
              >
                <option value="PORCENTAJE">Porcentaje (%)</option>
                <option value="MONTO_FIJO">Monto fijo (L.)</option>
              </select>
            </Campo>
            <Campo etiqueta="Descripción *" anchoTotal>
              <input
                value={formulario.descripcion}
                onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Valor *">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formulario.valor}
                onChange={(e) => setFormulario({ ...formulario, valor: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Plan al que aplica">
              <select
                value={formulario.plan_id}
                onChange={(e) => setFormulario({ ...formulario, plan_id: e.target.value })}
              >
                <option value="">Todos los planes</option>
                {planes.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Vigente desde">
              <input
                type="date"
                value={formulario.vigente_desde}
                onChange={(e) => setFormulario({ ...formulario, vigente_desde: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Vigente hasta *">
              <input
                type="date"
                value={formulario.vigente_hasta}
                onChange={(e) => setFormulario({ ...formulario, vigente_hasta: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Usos máximos">
              <input
                type="number"
                min="1"
                placeholder="Vacío = ilimitado"
                value={formulario.usos_maximos}
                onChange={(e) => setFormulario({ ...formulario, usos_maximos: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Activa">
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
