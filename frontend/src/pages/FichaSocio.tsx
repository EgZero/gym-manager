import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/cliente';
import type { Listado, Plan, Producto, SocioDetalle } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal, Progreso, dinero, fecha, fechaHora } from '../components/comunes';

export function FichaSocio({ esAdmin }: { esAdmin: boolean }): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [socio, setSocio] = useState<SocioDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [canje, setCanje] = useState<'producto' | 'plan' | null>(null);
  const [seleccion, setSeleccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [ajuste, setAjuste] = useState<{ puntos: string; motivo: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setSocio(await api<SocioDetalle>(`/api/socios/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el socio');
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrirCanje(tipo: 'producto' | 'plan'): Promise<void> {
    setCanje(tipo);
    setSeleccion('');
    if (tipo === 'producto') {
      setProductos((await api<Listado<Producto>>('/api/productos?solo_disponibles=true')).datos);
    } else {
      const respuesta = await api<Listado<Plan>>('/api/planes');
      setPlanes(respuesta.datos.filter((p) => p.costo_en_puntos !== null));
    }
  }

  async function confirmarCanje(): Promise<void> {
    if (!canje || !seleccion || !socio) return;
    setGuardando(true);
    setError(null);
    try {
      const ruta = canje === 'producto' ? '/api/puntos/canjear/producto' : '/api/puntos/canjear/plan';
      const cuerpo =
        canje === 'producto'
          ? { socio_id: socio.id, producto_id: Number(seleccion) }
          : { socio_id: socio.id, plan_id: Number(seleccion) };
      await api(ruta, { metodo: 'POST', cuerpo });
      setExito('Canje realizado correctamente');
      setCanje(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo realizar el canje');
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarAjuste(): Promise<void> {
    if (!ajuste || !socio) return;
    setGuardando(true);
    setError(null);
    try {
      await api('/api/puntos/ajuste', {
        metodo: 'POST',
        cuerpo: { socio_id: socio.id, puntos: Number(ajuste.puntos), motivo: ajuste.motivo },
      });
      setExito('Ajuste de puntos aplicado');
      setAjuste(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aplicar el ajuste');
    } finally {
      setGuardando(false);
    }
  }

  if (!socio) {
    return (
      <>
        <Mensaje tipo="error" texto={error} />
        <div className="vacio">Cargando ficha del socio…</div>
      </>
    );
  }

  return (
    <>
      <Link to="/socios" style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem' }}>
        ‹ Volver a socios
      </Link>
      <h1>
        {socio.nombre_completo} {socio.baneado && <Insignia estado="BANEADO" />}
      </h1>
      <p className="subtitulo">
        Documento {socio.documento} · {socio.correo ?? 'sin correo'} · {socio.telefono ?? 'sin teléfono'}
      </p>

      <Mensaje tipo="error" texto={error} />
      <Mensaje tipo="exito" texto={exito} />
      {socio.baneado && (
        <Mensaje
          tipo="info"
          texto={`Socio baneado: ${socio.motivo_baneo ?? 'sin motivo registrado'}${
            socio.baneado_hasta ? ` (hasta ${fecha(socio.baneado_hasta)})` : ''
          }`}
        />
      )}

      <div className="tarjetas">
        <div className="tarjeta">
          <div className="etiqueta">Plan contratado</div>
          <div className="valor" style={{ fontSize: '1.15rem' }}>
            {socio.plan_nombre ?? 'Sin plan'}
          </div>
          <small style={{ color: 'var(--texto-tenue)' }}>
            {socio.fecha_inicio ? `${fecha(socio.fecha_inicio)} → ${fecha(socio.fecha_fin)}` : '—'}
          </small>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Estado</div>
          <div className="valor" style={{ fontSize: '1.15rem' }}>
            <Insignia estado={socio.estado_membresia} />
          </div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Días transcurridos</div>
          <div className="valor">{socio.dias_transcurridos}</div>
          <Progreso actual={socio.dias_transcurridos} total={socio.dias_plan} />
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Días asistidos</div>
          <div className="valor" style={{ color: 'var(--exito)' }}>
            {socio.dias_asistidos}
          </div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Días faltados</div>
          <div className="valor" style={{ color: 'var(--peligro)' }}>
            {socio.dias_faltados}
          </div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Días restantes</div>
          <div className="valor">{socio.dias_restantes}</div>
        </div>
        <div className="tarjeta">
          <div className="etiqueta">Puntos de membresía</div>
          <div className="valor" style={{ color: 'var(--primario)' }}>
            {socio.puntos}
          </div>
        </div>
      </div>

      <div className="fila">
        <button onClick={() => void abrirCanje('producto')}>Canjear por producto</button>
        <button onClick={() => void abrirCanje('plan')}>Canjear por plan gratis</button>
        {esAdmin && (
          <button className="secundario" onClick={() => setAjuste({ puntos: '', motivo: '' })}>
            Ajuste manual de puntos
          </button>
        )}
      </div>

      <div className="panel">
        <h2>Historial de membresías</h2>
        {socio.membresias.length === 0 ? (
          <div className="vacio">El socio aún no tiene membresías.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Estado</th>
                <th>Precio lista</th>
                <th>Descuento</th>
                <th>Pagado</th>
                <th>Promoción</th>
              </tr>
            </thead>
            <tbody>
              {socio.membresias.map((m) => (
                <tr key={m.id}>
                  <td>{m.plan_nombre}</td>
                  <td>{fecha(m.fecha_inicio)}</td>
                  <td>{fecha(m.fecha_fin)}</td>
                  <td>
                    <Insignia estado={m.estado} />
                  </td>
                  <td>{dinero(m.precio_lista)}</td>
                  <td>{dinero(m.descuento)}</td>
                  <td>
                    {dinero(m.precio_final)}
                    {m.pagada_con_puntos && ' (puntos)'}
                  </td>
                  <td>{m.promocion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Movimientos de puntos</h2>
        {socio.movimientos_puntos.length === 0 ? (
          <div className="vacio">Sin movimientos de puntos.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Origen</th>
                <th>Descripción</th>
                <th>Puntos</th>
              </tr>
            </thead>
            <tbody>
              {socio.movimientos_puntos.map((m) => (
                <tr key={m.id}>
                  <td>{fechaHora(m.creado_en)}</td>
                  <td>{m.origen.replace(/_/g, ' ')}</td>
                  <td>{m.descripcion ?? '—'}</td>
                  <td style={{ color: m.puntos > 0 ? 'var(--exito)' : 'var(--peligro)' }}>
                    {m.puntos > 0 ? `+${m.puntos}` : m.puntos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Últimas asistencias</h2>
        {socio.asistencias.length === 0 ? (
          <div className="vacio">Sin asistencias registradas.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora de ingreso</th>
              </tr>
            </thead>
            <tbody>
              {socio.asistencias.map((a) => (
                <tr key={a.id}>
                  <td>{fecha(a.fecha)}</td>
                  <td>{fechaHora(a.hora_ingreso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canje && (
        <Modal
          titulo={canje === 'producto' ? 'Canjear puntos por producto' : 'Canjear puntos por plan gratis'}
          alCerrar={() => setCanje(null)}
          alGuardar={() => void confirmarCanje()}
          textoGuardar="Canjear"
          guardando={guardando}
        >
          <p style={{ color: 'var(--texto-tenue)', marginTop: 0 }}>
            Saldo disponible: <strong>{socio.puntos} puntos</strong>
          </p>
          <Campo etiqueta={canje === 'producto' ? 'Producto' : 'Plan'} anchoTotal>
            <select value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
              <option value="">Seleccione…</option>
              {canje === 'producto'
                ? productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.costo_en_puntos} pts · stock {p.stock}
                    </option>
                  ))
                : planes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.costo_en_puntos} pts · {p.duracion_dias} días
                    </option>
                  ))}
            </select>
          </Campo>
        </Modal>
      )}

      {ajuste && (
        <Modal
          titulo="Ajuste manual de puntos"
          alCerrar={() => setAjuste(null)}
          alGuardar={() => void aplicarAjuste()}
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Puntos (use negativo para debitar)">
              <input
                type="number"
                value={ajuste.puntos}
                onChange={(e) => setAjuste({ ...ajuste, puntos: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Motivo *" anchoTotal>
              <textarea
                rows={3}
                value={ajuste.motivo}
                onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })}
              />
            </Campo>
          </div>
        </Modal>
      )}
    </>
  );
}
