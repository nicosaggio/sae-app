import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../context/AuthContext';

function rangoProximos(dias) {
  const hoy = new Date();
  const fin = new Date();
  fin.setDate(fin.getDate() + dias);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { desde: iso(hoy), hasta: iso(fin) };
}

export function HomePage() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const { desde, hasta } = rangoProximos(30);

  const { datos: alertas, cargando: cargandoAlertas } = usePolling(
    () => api.get('/presupuestos/alertas'),
    30000,
    []
  );
  const { datos: eventos, cargando: cargandoEventos } = usePolling(
    () => api.get(`/eventos?desde=${desde}&hasta=${hasta}&con_presupuestos=1`),
    30000,
    [desde, hasta]
  );

  const proximosEventos = (eventos || [])
    .slice()
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
    .slice(0, 5);

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <h2>Hola, {usuario?.nombre_completo || usuario?.nombre_usuario}</h2>

      <div className="dashboard-grid">
        <div className="card">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Alertas de pago</h3>
            {alertas && alertas.length > 0 && <span className="badge tipo">{alertas.length}</span>}
          </div>
          {cargandoAlertas ? (
            <p className="texto-suave">Cargando…</p>
          ) : !alertas || alertas.length === 0 ? (
            <p className="texto-suave">Sin alertas por ahora.</p>
          ) : (
            <>
              <ul className="lista-resumen">
                {alertas.slice(0, 5).map((a) => (
                  <li key={a.id} onClick={() => navigate(`/eventos/${a.evento_id}`)}>
                    <strong>{a.evento_nombre}</strong>
                    <span className="texto-suave">
                      {' '}
                      — {a.cliente_nombre || 'sin cliente'} · {a.fecha_inicio}
                      {a.fecha_inicio < hoy ? ' (vencido)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/alertas')}>Ver todas</button>
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Próximos eventos</h3>
          {cargandoEventos ? (
            <p className="texto-suave">Cargando…</p>
          ) : proximosEventos.length === 0 ? (
            <p className="texto-suave">No hay eventos con presupuestos cargados en los próximos 30 días.</p>
          ) : (
            <>
              <ul className="lista-resumen">
                {proximosEventos.map((ev) => (
                  <li key={ev.id} onClick={() => navigate(`/eventos/${ev.id}`)}>
                    <strong>{ev.nombre}</strong>
                    <span className="texto-suave">
                      {' '}
                      — {ev.fecha_inicio} a {ev.fecha_fin}
                      {ev.lugar ? ` · ${ev.lugar}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/calendario')}>Ver calendario</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
