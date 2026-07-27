import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/cliente';
import type { Listado, Plan, Promocion, Socio } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal, Progreso } from '../components/comunes';

interface FormSocio {
  documento: string;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono: string;
  fecha_nacimiento: string;
  direccion: string;
  contacto_emergencia: string;
}

const FORM_VACIO: FormSocio = {
  documento: '',
  nombres: '',
  apellidos: '',
  correo: '',
  telefono: '',
  fecha_nacimiento: '',
  direccion: '',
  contacto_emergencia: '',
};

const LIMITE = 20;

export function Socios({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const [socios, setSocios] = useState<Socio[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [formulario, setFormulario] = useState<FormSocio | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [ventaSocio, setVentaSocio] = useState<Socio | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [venta, setVenta] = useState({ plan_id: '', promocion_id: '', metodo_pago: 'EFECTIVO' });

  const [baneoSocio, setBaneoSocio] = useState<Socio | null>(null);
  const [motivoBaneo, setMotivoBaneo] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams({ pagina: String(pagina), limite: String(LIMITE) });
      if (busqueda.trim()) parametros.set('busqueda', busqueda.trim());
      if (estado) parametros.set('estado', estado);
      const respuesta = await api<Listado<Socio>>(`/api/socios?${parametros}`);
      setSocios(respuesta.datos);
      setTotal(respuesta.paginacion?.total ?? respuesta.datos.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar socios');
    } finally {
      setCargando(false);
    }
  }, [pagina, busqueda, estado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarSocio(): Promise<void> {
    if (!formulario) return;
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = {
        ...formulario,
        correo: formulario.correo || null,
        telefono: formulario.telefono || null,
        fecha_nacimiento: formulario.fecha_nacimiento || null,
        direccion: formulario.direccion || null,
        contacto_emergencia: formulario.contacto_emergencia || null,
      };
      if (editandoId) {
        await api(`/api/socios/${editandoId}`, { metodo: 'PUT', cuerpo });
        setExito('Socio actualizado correctamente');
      } else {
        await api('/api/socios', { metodo: 'POST', cuerpo });
        setExito('Socio registrado correctamente');
      }
      setFormulario(null);
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el socio');
    } finally {
      setGuardando(false);
    }
  }

  async function abrirVenta(socio: Socio): Promise<void> {
    setVentaSocio(socio);
    setVenta({ plan_id: '', promocion_id: '', metodo_pago: 'EFECTIVO' });
    const [p, pr] = await Promise.all([
      api<Listado<Plan>>('/api/planes'),
      api<Listado<Promocion>>('/api/promociones?solo_disponibles=true'),
    ]);
    setPlanes(p.datos);
    setPromociones(pr.datos);
  }

  async function venderMembresia(): Promise<void> {
    if (!ventaSocio || !venta.plan_id) return;
    setGuardando(true);
    setError(null);
    try {
      await api('/api/membresias', {
        metodo: 'POST',
        cuerpo: {
          socio_id: ventaSocio.id,
          plan_id: Number(venta.plan_id),
          promocion_id: venta.promocion_id ? Number(venta.promocion_id) : null,
          metodo_pago: venta.metodo_pago,
        },
      });
      setExito('Membresía vendida correctamente');
      setVentaSocio(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo vender la membresía');
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarBaneo(): Promise<void> {
    if (!baneoSocio) return;
    setGuardando(true);
    setError(null);
    try {
      if (baneoSocio.baneado) {
        await api(`/api/socios/${baneoSocio.id}/desbanear`, { metodo: 'POST' });
        setExito('Baneo levantado');
      } else {
        await api(`/api/socios/${baneoSocio.id}/banear`, {
          metodo: 'POST',
          cuerpo: { motivo: motivoBaneo },
        });
        setExito('Socio baneado');
      }
      setBaneoSocio(null);
      setMotivoBaneo('');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el baneo');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(socio: Socio): Promise<void> {
    if (!confirm(`¿Eliminar al socio ${socio.nombre_completo}?`)) return;
    try {
      const respuesta = await api<{ mensaje: string }>(`/api/socios/${socio.id}`, { metodo: 'DELETE' });
      setExito(respuesta.mensaje);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el socio');
    }
  }

  const paginas = Math.max(1, Math.ceil(total / LIMITE));

  return (
    <>
      <h1>Socios</h1>
      <p className="subtitulo">
        Registro de miembros, membresías y control de días asistidos / faltados
      </p>

      <Mensaje tipo="error" texto={error} />
      <Mensaje tipo="exito" texto={exito} />

      <div className="fila">
        <div className="crecer">
          <input
            placeholder="Buscar por nombre o documento…"
            value={busqueda}
            onChange={(e) => {
              setPagina(1);
              setBusqueda(e.target.value);
            }}
          />
        </div>
        <select
          value={estado}
          onChange={(e) => {
            setPagina(1);
            setEstado(e.target.value);
          }}
          style={{ width: 200 }}
        >
          <option value="">Todos los estados</option>
          <option value="VIGENTE">Membresía vigente</option>
          <option value="VENCIDA">Membresía vencida</option>
          <option value="SIN_MEMBRESIA">Sin membresía</option>
        </select>
        <button
          onClick={() => {
            setFormulario(FORM_VACIO);
            setEditandoId(null);
          }}
        >
          + Registrar socio
        </button>
      </div>

      <div className="panel">
        {cargando ? (
          <div className="vacio">Cargando…</div>
        ) : socios.length === 0 ? (
          <div className="vacio">No se encontraron socios con esos filtros.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Socio</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>Días transcurridos</th>
                <th>Asistidos</th>
                <th>Faltados</th>
                <th>Restantes</th>
                <th>Puntos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {socios.map((socio) => (
                <tr key={socio.id}>
                  <td>{socio.documento}</td>
                  <td>
                    <Link to={`/socios/${socio.id}`}>
                      <strong>{socio.nombre_completo}</strong>
                    </Link>
                    {socio.baneado && (
                      <>
                        {' '}
                        <Insignia estado="BANEADO" />
                      </>
                    )}
                  </td>
                  <td>{socio.plan_nombre ?? '—'}</td>
                  <td>
                    <Insignia estado={socio.estado_membresia} />
                  </td>
                  <td>
                    <Progreso actual={socio.dias_transcurridos} total={socio.dias_plan} />
                  </td>
                  <td>{socio.dias_asistidos}</td>
                  <td>{socio.dias_faltados}</td>
                  <td>{socio.dias_restantes}</td>
                  <td>{socio.puntos}</td>
                  <td>
                    <div className="acciones">
                      <button className="secundario pequeno" onClick={() => void abrirVenta(socio)}>
                        Vender plan
                      </button>
                      <button
                        className="secundario pequeno"
                        onClick={() => {
                          setEditandoId(socio.id);
                          setFormulario({
                            documento: socio.documento,
                            nombres: socio.nombres,
                            apellidos: socio.apellidos,
                            correo: socio.correo ?? '',
                            telefono: socio.telefono ?? '',
                            fecha_nacimiento: socio.fecha_nacimiento?.slice(0, 10) ?? '',
                            direccion: '',
                            contacto_emergencia: '',
                          });
                        }}
                      >
                        Editar
                      </button>
                      {esAdmin && (
                        <>
                          <button
                            className={socio.baneado ? 'exito pequeno' : 'peligro pequeno'}
                            onClick={() => {
                              setBaneoSocio(socio);
                              setMotivoBaneo('');
                            }}
                          >
                            {socio.baneado ? 'Desbanear' : 'Banear'}
                          </button>
                          <button className="peligro pequeno" onClick={() => void eliminar(socio)}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="fila">
        <button className="secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
          ‹ Anterior
        </button>
        <span style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem' }}>
          Página {pagina} de {paginas} · {total} socios
        </span>
        <button
          className="secundario"
          disabled={pagina >= paginas}
          onClick={() => setPagina((p) => p + 1)}
        >
          Siguiente ›
        </button>
      </div>

      {formulario && (
        <Modal
          titulo={editandoId ? 'Editar socio' : 'Registrar socio'}
          alCerrar={() => {
            setFormulario(null);
            setEditandoId(null);
          }}
          alGuardar={() => void guardarSocio()}
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Documento *">
              <input
                value={formulario.documento}
                onChange={(e) => setFormulario({ ...formulario, documento: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Fecha de nacimiento">
              <input
                type="date"
                value={formulario.fecha_nacimiento}
                onChange={(e) => setFormulario({ ...formulario, fecha_nacimiento: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Nombres *">
              <input
                value={formulario.nombres}
                onChange={(e) => setFormulario({ ...formulario, nombres: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Apellidos *">
              <input
                value={formulario.apellidos}
                onChange={(e) => setFormulario({ ...formulario, apellidos: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Correo">
              <input
                type="email"
                value={formulario.correo}
                onChange={(e) => setFormulario({ ...formulario, correo: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Teléfono">
              <input
                value={formulario.telefono}
                onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Dirección" anchoTotal>
              <input
                value={formulario.direccion}
                onChange={(e) => setFormulario({ ...formulario, direccion: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Contacto de emergencia" anchoTotal>
              <input
                value={formulario.contacto_emergencia}
                onChange={(e) =>
                  setFormulario({ ...formulario, contacto_emergencia: e.target.value })
                }
              />
            </Campo>
          </div>
        </Modal>
      )}

      {ventaSocio && (
        <Modal
          titulo={`Vender membresía · ${ventaSocio.nombre_completo}`}
          alCerrar={() => setVentaSocio(null)}
          alGuardar={() => void venderMembresia()}
          textoGuardar="Vender"
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Plan *" anchoTotal>
              <select
                value={venta.plan_id}
                onChange={(e) => setVenta({ ...venta, plan_id: e.target.value })}
              >
                <option value="">Seleccione un plan…</option>
                {planes.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.nombre} · L. {Number(plan.precio).toFixed(2)} · {plan.duracion_dias} días
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Promoción" anchoTotal>
              <select
                value={venta.promocion_id}
                onChange={(e) => setVenta({ ...venta, promocion_id: e.target.value })}
              >
                <option value="">Sin promoción</option>
                {promociones
                  .filter((p) => !p.plan_id || String(p.plan_id) === venta.plan_id)
                  .map((promo) => (
                    <option key={promo.id} value={promo.id}>
                      {promo.codigo} · {promo.descripcion}
                    </option>
                  ))}
              </select>
            </Campo>
            <Campo etiqueta="Método de pago" anchoTotal>
              <select
                value={venta.metodo_pago}
                onChange={(e) => setVenta({ ...venta, metodo_pago: e.target.value })}
              >
                <option value="EFECTIVO">Efectivo</option>
                <option value="TARJETA">Tarjeta</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </select>
            </Campo>
          </div>
        </Modal>
      )}

      {baneoSocio && (
        <Modal
          titulo={baneoSocio.baneado ? 'Levantar baneo' : 'Banear socio'}
          alCerrar={() => setBaneoSocio(null)}
          alGuardar={() => void aplicarBaneo()}
          textoGuardar={baneoSocio.baneado ? 'Levantar baneo' : 'Banear'}
          guardando={guardando}
        >
          {baneoSocio.baneado ? (
            <p>
              El socio <strong>{baneoSocio.nombre_completo}</strong> está baneado por:{' '}
              <em>{baneoSocio.motivo_baneo}</em>. ¿Desea levantar el baneo?
            </p>
          ) : (
            <Campo etiqueta="Motivo del baneo *" anchoTotal>
              <textarea
                rows={3}
                value={motivoBaneo}
                onChange={(e) => setMotivoBaneo(e.target.value)}
                placeholder="Describa el motivo (mínimo 5 caracteres)"
              />
            </Campo>
          )}
        </Modal>
      )}
    </>
  );
}
