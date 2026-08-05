import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ESTADOS_PRESUPUESTO, etiquetaEstadoPresupuesto } from '../constants';

export function PresupuestosPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const query = new URLSearchParams();
  if (estado) query.set('estado', estado);
  if (desde) query.set('desde', desde);
  if (hasta) query.set('hasta', hasta);

  const { datos: presupuestos, cargando } = usePolling(
    () => api.get(`/presupuestos?${query.toString()}`),
    15000,
    [estado, desde, hasta]
  );

  return (
    <div>
      <h2>Presupuestos confirmados</h2>

      <div className="card">
        <div className="toolbar">
          <div className="campo">
            <label>Estado</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS_PRESUPUESTO.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Evento desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="campo">
            <label>Evento hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>

        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : !presupuestos || presupuestos.length === 0 ? (
          <p className="texto-suave">No hay presupuestos confirmados con estos filtros.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Lote</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Condiciones</th>
                <th>Estado</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {presupuestos.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/eventos/${p.evento_id}`)} style={{ cursor: 'pointer' }}>
                  <td>{p.evento_nombre}</td>
                  <td>{p.lote_codigo}{p.lote_expositor ? ` — ${p.lote_expositor}` : ''}</td>
                  <td>{p.cliente_nombre || '—'}</td>
                  <td>{p.fecha || '—'}</td>
                  <td>{p.monto_total ?? '—'}</td>
                  <td>{p.condiciones_pago || '—'}</td>
                  <td>
                    <span className={`badge ${p.estado}`}>{etiquetaEstadoPresupuesto(p.estado)}</span>
                  </td>
                  <td>
                    {p.origen === 'excel' ? (
                      <span className="badge tipo">Excel</span>
                    ) : (
                      <span className="texto-suave">Manual</span>
                    )}
                    {p.origen === 'excel' && !p.archivo_activo && (
                      <span className="badge" style={{ marginLeft: 4, background: 'var(--color-peligro-fondo)', color: 'var(--color-peligro)' }}>
                        sin archivo
                      </span>
                    )}
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
