import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';

const ENLACES = [
  { to: '/inicio', texto: 'Inicio' },
  { to: '/calendario', texto: 'Calendario' },
  { to: '/presupuestos', texto: 'Presupuestos' },
  { to: '/totales', texto: 'Totales' },
  { to: '/productos', texto: 'Productos' },
];

export function Layout() {
  const { usuario, logout, puedeEscribir } = useAuth();
  let enlaces = puedeEscribir ? ENLACES : ENLACES.filter((e) => e.to !== '/productos');
  if (usuario?.rol === 'admin') enlaces = [...enlaces, { to: '/usuarios', texto: 'Usuarios' }];

  const { datos: alertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);
  const totalAlertas = alertas ? alertas.length : 0;

  const { datos: estadoImport } = usePolling(() => api.get('/importaciones/estado'), 30000, []);
  const totalImportPendientes = estadoImport ? estadoImport.total : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo-box">
          <img src="/anselmi-logo.jpg" alt="Anselmi Industria Publicitaria" />
        </div>
        <nav>
          {enlaces.map((enlace) => (
            <NavLink key={enlace.to} to={enlace.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {enlace.texto}
            </NavLink>
          ))}
          <NavLink to="/alertas" className={({ isActive }) => (isActive ? 'active' : '')}>
            Alertas{totalAlertas > 0 && <span className="badge tipo" style={{ marginLeft: 6 }}>{totalAlertas}</span>}
          </NavLink>
          {puedeEscribir && (
            <NavLink to="/importaciones" className={({ isActive }) => (isActive ? 'active' : '')}>
              Importaciones
              {totalImportPendientes > 0 && (
                <span className="badge tipo" style={{ marginLeft: 6 }}>
                  {totalImportPendientes}
                </span>
              )}
            </NavLink>
          )}
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
