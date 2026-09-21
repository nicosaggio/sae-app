import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PESTANAS = [
  { to: '/catalogo', texto: 'Vista', end: true },
  { to: '/catalogo/items', texto: 'Ítems' },
  { to: '/catalogo/versiones', texto: 'Versiones' },
  { to: '/catalogo/televisores', texto: 'Televisores' },
  { to: '/catalogo/importar', texto: 'Base parche', admin: true },
  { to: '/catalogo/ajustes', texto: 'Ajustes' },
];

export function CatalogoLayout() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  return (
    <div className="catalogo-raiz">
      <h2>Catálogo SAE</h2>
      <nav className="subnav">
        {PESTANAS.filter((p) => !p.admin || esAdmin).map((p) => (
          <NavLink key={p.to} to={p.to} end={p.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {p.texto}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
