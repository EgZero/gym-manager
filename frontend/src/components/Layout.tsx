import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { UsuarioSesion } from '../api/cliente';

interface Props {
  usuario: UsuarioSesion;
  alCerrarSesion: () => void;
  children: ReactNode;
}

const ENLACES: { ruta: string; texto: string; soloAdmin?: boolean }[] = [
  // { ruta: '/tablero', texto: 'Tablero' },
  { ruta: '/socios', texto: 'Socios' },
  // { ruta: '/asistencias', texto: 'Asistencias' },
  // { ruta: '/planes', texto: 'Planes y costos' },
  // { ruta: '/promociones', texto: 'Promociones' },
  // { ruta: '/productos', texto: 'Productos canjeables' },
  // { ruta: '/operadores', texto: 'Operadores', soloAdmin: true },
  // { ruta: '/reportes', texto: 'Reportes', soloAdmin: true },
];

export function Layout({ usuario, alCerrarSesion, children }: Props): JSX.Element {
  const esAdmin = usuario.rol === 'ADMINISTRADOR';

  return (
    <div className="layout">
      <aside className="barra-lateral">
        <div>
          <div className="marca">
            Gym<span>Manager</span>
          </div>
          <div className="rol-etiqueta">
            {usuario.nombre} · {esAdmin ? 'Administrador' : 'Operador'}
          </div>
        </div>
        <nav>
          {ENLACES.filter((e) => !e.soloAdmin || esAdmin).map((enlace) => (
            <NavLink
              key={enlace.ruta}
              to={enlace.ruta}
              className={({ isActive }) => (isActive ? 'activo' : undefined)}
            >
              {enlace.texto}
            </NavLink>
          ))}
        </nav>
        <div className="pie-lateral">
          <button className="secundario pequeno" onClick={alCerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}
