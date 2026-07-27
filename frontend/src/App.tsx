import { useCallback, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { sesion, type UsuarioSesion } from './api/cliente';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Tablero } from './pages/Tablero';
import { Socios } from './pages/Socios';
import { FichaSocio } from './pages/FichaSocio';
import { Asistencias } from './pages/Asistencias';
import { Planes } from './pages/Planes';
import { Promociones } from './pages/Promociones';
import { Productos } from './pages/Productos';
import { Operadores } from './pages/Operadores';
import { Reportes } from './pages/Reportes';

export function App(): JSX.Element {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(() => sesion.usuario());

  const cerrarSesion = useCallback(() => {
    sesion.limpiar();
    setUsuario(null);
  }, []);

  const esAdmin = useMemo(() => usuario?.rol === 'ADMINISTRADOR', [usuario]);

  if (!usuario) {
    return (
      <HashRouter>
        <Routes>
          <Route path="*" element={<Login alIniciarSesion={setUsuario} />} />
        </Routes>
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <Layout usuario={usuario} alCerrarSesion={cerrarSesion}>
        <Routes>
          <Route path="/" element={<Navigate to="/tablero" replace />} />
          <Route path="/tablero" element={<Tablero usuario={usuario} />} />
          <Route path="/socios" element={<Socios esAdmin={esAdmin} />} />
          <Route path="/socios/:id" element={<FichaSocio esAdmin={esAdmin} />} />
          <Route path="/asistencias" element={<Asistencias esAdmin={esAdmin} />} />
          <Route path="/planes" element={<Planes esAdmin={esAdmin} />} />
          <Route path="/promociones" element={<Promociones esAdmin={esAdmin} />} />
          <Route path="/productos" element={<Productos esAdmin={esAdmin} />} />
          {esAdmin && <Route path="/operadores" element={<Operadores />} />}
          {esAdmin && <Route path="/reportes" element={<Reportes />} />}
          <Route path="*" element={<Navigate to="/tablero" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
