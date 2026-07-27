import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Listado, Producto } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal } from '../components/comunes';

interface FormProducto {
  nombre: string;
  descripcion: string;
  costo_en_puntos: string;
  stock: string;
  activo: boolean;
}

const FORM_VACIO: FormProducto = {
  nombre: '',
  descripcion: '',
  costo_en_puntos: '',
  stock: '0',
  activo: true,
};

export function Productos({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<FormProducto | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setProductos((await api<Listado<Producto>>('/api/productos')).datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los productos');
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
        costo_en_puntos: Number(formulario.costo_en_puntos),
        stock: Number(formulario.stock),
        activo: formulario.activo,
      };
      if (editandoId) {
        await api(`/api/productos/${editandoId}`, { metodo: 'PUT', cuerpo });
        setExito('Producto actualizado');
      } else {
        await api('/api/productos', { metodo: 'POST', cuerpo });
        setExito('Producto creado');
      }
      setFormulario(null);
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el producto');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(producto: Producto): Promise<void> {
    if (!confirm(`¿Eliminar el producto "${producto.nombre}"?`)) return;
    try {
      const respuesta = await api<{ mensaje: string }>(`/api/productos/${producto.id}`, {
        metodo: 'DELETE',
      });
      setExito(respuesta.mensaje);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el producto');
    }
  }

  return (
    <>
      <h1>Productos canjeables</h1>
      <p className="subtitulo">Catálogo de recompensas que los socios pueden obtener con sus puntos.</p>

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
            + Nuevo producto
          </button>
        </div>
      )}

      <div className="panel">
        {productos.length === 0 ? (
          <div className="vacio">No hay productos registrados.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Descripción</th>
                <th>Costo en puntos</th>
                <th>Stock</th>
                <th>Estado</th>
                {esAdmin && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr key={producto.id}>
                  <td>
                    <strong>{producto.nombre}</strong>
                  </td>
                  <td>{producto.descripcion ?? '—'}</td>
                  <td>{producto.costo_en_puntos} pts</td>
                  <td>{producto.stock}</td>
                  <td>
                    <Insignia estado={producto.activo && producto.stock > 0 ? 'VIGENTE' : 'NEUTRA'} />
                  </td>
                  {esAdmin && (
                    <td>
                      <div className="acciones">
                        <button
                          className="secundario pequeno"
                          onClick={() => {
                            setEditandoId(producto.id);
                            setFormulario({
                              nombre: producto.nombre,
                              descripcion: producto.descripcion ?? '',
                              costo_en_puntos: String(producto.costo_en_puntos),
                              stock: String(producto.stock),
                              activo: producto.activo,
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button className="peligro pequeno" onClick={() => void eliminar(producto)}>
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
          titulo={editandoId ? 'Editar producto' : 'Nuevo producto'}
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
            <Campo etiqueta="Costo en puntos *">
              <input
                type="number"
                min="1"
                value={formulario.costo_en_puntos}
                onChange={(e) => setFormulario({ ...formulario, costo_en_puntos: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Stock">
              <input
                type="number"
                min="0"
                value={formulario.stock}
                onChange={(e) => setFormulario({ ...formulario, stock: e.target.value })}
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
