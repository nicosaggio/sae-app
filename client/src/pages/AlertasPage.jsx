import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { formatearMonto } from '../format';

export function AlertasPage() {
  const navigate = useNavigate();
  const { datos: alertas, cargando } = usePolling(() => api.get('/presupuestos/alertas'), 20000, []);

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <h2>Alertas de pago pendiente</h2>
      <p className="texto-suave">
        Presupuestos en estado "Pendiente de pago" cuyo evento empieza en 3 días o menos, o ya vencidos.
      </p>

      <div className="card">
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : !alertas || alertas.length === 0 ? (
          <p className="texto-suave">Sin alertas por ahora.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Fecha de inicio</th>
                <th>Lote</th>
                <th>Cliente</th>
                <th>Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.id} className={a.fecha_inicio < hoy ? 'fila-alerta' : ''}>
                  <td>{a.evento_nombre}</td>
                  <td>
                    {a.fecha_inicio}
                    {a.fecha_inicio < hoy && <span className="texto-suave"> (vencido)</span>}
                  </td>
                  <td>{a.lote_codigo}{a.lote_expositor ? ` — ${a.lote_expositor}` : ''}</td>
                  <td>{a.cliente_nombre || '—'}</td>
                  <td>{formatearMonto(a.monto_total)}</td>
                  <td>
                    <button onClick={() => navigate(`/eventos/${a.evento_id}`)}>Ver evento</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
