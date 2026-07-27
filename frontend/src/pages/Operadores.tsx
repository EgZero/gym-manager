import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Listado, Staff } from '../api/tipos';
import { Campo, Insignia, Mensaje, Modal, fechaHora } from '../components/comunes';

export function Operadores(): JSX.Element {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Staff | null>(null);
  const [reset, setReset] = useState<Staff | null>(null);
  const [passwordNueva, setPasswordNueva] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setStaff((await api<Listado<Staff>>('/api/staff')).datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar el staff');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar(): Promise<void> {
    if (!edicion) return;
    setGuardando(true);
    setError(null);
    try {
      await api(`/api/staff/${edicion.id}`, {
        metodo: 'PUT',
        cuerpo: {
          nombre_completo: edicion.nombre_completo,
          correo: edicion.correo || null,
          telefono: edicion.telefono || null,
        },
      });
      setExito('Operador actualizado');
      setEdicion(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el operador');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(persona: Staff): Promise<void> {
    setError(null);
    try {
      await api(`/api/staff/${persona.id}/estado`, {
        metodo: 'PATCH',
        cuerpo: { activo: !persona.activo },
      });
      setExito(`Operador ${persona.activo ? 'desactivado' : 'activado'}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado');
    }
  }

  async function resetearPassword(): Promise<void> {
    if (!reset) return;
    setGuardando(true);
    setError(null);
    try {
      await api(`/api/staff/${reset.id}/reset-password`, {
        metodo: 'POST',
        cuerpo: { passwordNueva },
      });
      setExito(`Contraseña de ${reset.usuario} restablecida`);
      setReset(null);
      setPasswordNueva('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restablecer la contraseña');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <h1>Operadores y administradores</h1>
      <p className="subtitulo">
        Gestión del personal. El administrador edita, activa o desactiva operadores.
      </p>

      <Mensaje
        tipo="info"
        texto={
          'Las cuentas nuevas solo se crean desde PostgreSQL: ' +
          "psql -U postgres -d gymdb -c \"SELECT gimnasio.crear_staff('usuario','Clave1234','Nombre Completo','OPERADOR');\""
        }
      />
      <Mensaje tipo="error" texto={error} />
      <Mensaje tipo="exito" texto={exito} />

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Correo</th>
              <th>Teléfono</th>
              <th>Último acceso</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((persona) => {
              const esAdministrador = persona.rol === 'ADMINISTRADOR';
              return (
                <tr key={persona.id}>
                  <td>
                    <strong>{persona.usuario}</strong>
                  </td>
                  <td>{persona.nombre_completo}</td>
                  <td>{esAdministrador ? 'Administrador' : 'Operador'}</td>
                  <td>{persona.correo ?? '—'}</td>
                  <td>{persona.telefono ?? '—'}</td>
                  <td>{fechaHora(persona.ultimo_acceso)}</td>
                  <td>
                    <Insignia estado={persona.activo ? 'VIGENTE' : 'NEUTRA'} />
                  </td>
                  <td>
                    {esAdministrador ? (
                      <span style={{ color: 'var(--texto-tenue)', fontSize: '0.8rem' }}>
                        Solo editable desde PostgreSQL
                      </span>
                    ) : (
                      <div className="acciones">
                        <button className="secundario pequeno" onClick={() => setEdicion(persona)}>
                          Editar
                        </button>
                        <button
                          className="secundario pequeno"
                          onClick={() => {
                            setReset(persona);
                            setPasswordNueva('');
                          }}
                        >
                          Resetear clave
                        </button>
                        <button
                          className={persona.activo ? 'peligro pequeno' : 'exito pequeno'}
                          onClick={() => void cambiarEstado(persona)}
                        >
                          {persona.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edicion && (
        <Modal
          titulo={`Editar operador · ${edicion.usuario}`}
          alCerrar={() => setEdicion(null)}
          alGuardar={() => void guardar()}
          guardando={guardando}
        >
          <div className="campos">
            <Campo etiqueta="Nombre completo" anchoTotal>
              <input
                value={edicion.nombre_completo}
                onChange={(e) => setEdicion({ ...edicion, nombre_completo: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Correo">
              <input
                type="email"
                value={edicion.correo ?? ''}
                onChange={(e) => setEdicion({ ...edicion, correo: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Teléfono">
              <input
                value={edicion.telefono ?? ''}
                onChange={(e) => setEdicion({ ...edicion, telefono: e.target.value })}
              />
            </Campo>
          </div>
        </Modal>
      )}

      {reset && (
        <Modal
          titulo={`Restablecer contraseña · ${reset.usuario}`}
          alCerrar={() => setReset(null)}
          alGuardar={() => void resetearPassword()}
          textoGuardar="Restablecer"
          guardando={guardando}
        >
          <Campo etiqueta="Nueva contraseña (mínimo 8 caracteres)" anchoTotal>
            <input
              type="password"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
            />
          </Campo>
        </Modal>
      )}
    </>
  );
}
