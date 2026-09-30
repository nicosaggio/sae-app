import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';

const ENLACES = [
  { to: '/inicio', texto: 'Inicio' },
  { to: '/calendario', texto: 'Calendario' },
  { to: '/presupuestos', texto: 'Presupuestos' },
  { to: '/clientes', texto: 'Clientes' },
  { to: '/totales', texto: 'Totales' },
  { to: '/productos', texto: 'Productos' },
  { to: '/catalogo', texto: 'Catálogo' },
];

export function Layout() {
  const { usuario, logout, puedeEscribir } = useAuth();
  const [menuAbierto, setMenuAbierto] = useState(false);
  let enlaces = puedeEscribir ? ENLACES : ENLACES.filter((e) => e.to !== '/productos' && e.to !== '/catalogo' && e.to !== '/clientes');
  if (usuario?.rol === 'admin') enlaces = [...enlaces, { to: '/usuarios', texto: 'Usuarios' }];

  const { datos: alertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);
  const totalAlertas = alertas ? alertas.length : 0;

  const { datos: estadoImport } = usePolling(() => api.get('/importaciones/estado'), 30000, []);
  const totalImportPendientes = estadoImport ? estadoImport.total : 0;

  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <div className="app-shell">
      <header className="topbar-mobile">
        <button className="menu-toggle" onClick={() => setMenuAbierto((v) => !v)} aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}>
          {menuAbierto ? '✕' : '☰'}
        </button>
        <img src="/anselmi-logo.jpg" alt="Anselmi Industria Publicitaria" className="topbar-logo" />
      </header>
      {menuAbierto && <div className="sidebar-overlay" onClick={cerrarMenu} />}
      <aside className={`sidebar${menuAbierto ? ' abierto' : ''}`}>
        <div className="logo-box">
          <img src="/anselmi-logo.jpg" alt="Anselmi Industria Publicitaria" />
        </div>
        <nav>
          {enlaces.map((enlace) => (
            <NavLink key={enlace.to} to={enlace.to} className={({ isActive }) => (isActive ? 'active' : '')} onClick={cerrarMenu}>
              {enlace.texto}
            </NavLink>
          ))}
          <NavLink to="/alertas" className={({ isActive }) => (isActive ? 'active' : '')} onClick={cerrarMenu}>
            Alertas{totalAlertas > 0 && <span className="badge tipo" style={{ marginLeft: 6 }}>{totalAlertas}</span>}
          </NavLink>
          {puedeEscribir && (
            <NavLink to="/importaciones" className={({ isActive }) => (isActive ? 'active' : '')} onClick={cerrarMenu}>
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
