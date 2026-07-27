import { useState, type FormEvent } from 'react';
import { api, sesion, type UsuarioSesion } from '../api/cliente';
import { Mensaje } from '../components/comunes';

interface RespuestaLogin {
  token: string;
  usuario: UsuarioSesion;
}

export function Login({
  alIniciarSesion,
}: {
  alIniciarSesion: (usuario: UsuarioSesion) => void;
}): JSX.Element {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const respuesta = await api<RespuestaLogin>('/api/auth/login', {
        metodo: 'POST',
        cuerpo: { usuario, password },
      });
      sesion.guardar(respuesta.token, respuesta.usuario);
      alIniciarSesion(respuesta.usuario);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login-fondo">
      <form className="login-caja" onSubmit={enviar}>
        <h1>GymManager</h1>
        <p>Ingrese con su cuenta de administrador u operador</p>

        <Mensaje tipo="error" texto={error} />

        <div className="campo">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" disabled={cargando}>
          {cargando ? 'Verificando…' : 'Iniciar sesión'}
        </button>

        <div className="pista-credenciales">
          Las cuentas de staff se crean únicamente desde PostgreSQL:
          <br />
          <code>SELECT gimnasio.crear_staff(&#39;usuario&#39;,&#39;Clave&#39;,&#39;Nombre&#39;,&#39;OPERADOR&#39;);</code>
        </div>
      </form>
    </div>
  );
}
