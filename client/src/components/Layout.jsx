import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';

const ENLACES = [
  { to: '/calendario', texto: 'Calendario' },
  { to: '/presupuestos', texto: 'Presupuestos' },
  { to: '/productos', texto: 'Productos' },
];

export function Layout() {
  const { usuario, logout } = useAuth();

  const { datos: alertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);
  const totalAlertas = alertas ? alertas.length : 0;

  const { datos: estadoImport } = usePolling(() => api.get('/importaciones/estado'), 30000, []);
  const totalImportPendientes = estadoImport ? estadoImport.pendientes : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>SAE-APP</h1>
        <nav>
          {ENLACES.map((enlace) => (
            <NavLink key={enlace.to} to={enlace.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {enlace.texto}
            </NavLink>
          ))}
          <NavLink to="/alertas" className={({ isActive }) => (isActive ? 'active' : '')}>
            Alertas{totalAlertas > 0 && <span className="badge tipo" style={{ marginLeft: 6 }}>{totalAlertas}</span>}
          </NavLink>
          <NavLink to="/importaciones" className={({ isActive }) => (isActive ? 'active' : '')}>
            Importaciones
            {totalImportPendientes > 0 && (
              <span className="badge tipo" style={{ marginLeft: 6 }}>
                {totalImportPendientes}
              </span>
            )}
          </NavLink>
        </nav>
        <div className="usuario-box">
          <div>{usuario?.nombre_completo || usuario?.nombre_usuario}</div>
          <button onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
