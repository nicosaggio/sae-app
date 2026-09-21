import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ESTADOS_PRESUPUESTO, etiquetaEstadoPresupuesto } from '../constants';
import { formatearMonto } from '../format';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { Modal } from '../components/Modal';
import { PresupuestoPanel } from '../components/PresupuestoPanel';

export function PresupuestosPage() {
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [eventoId, setEventoId] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [lote, setLote] = useState('');
  const [productos, setProductos] = useState([]);
  const [presupuestoAbiertoId, setPresupuestoAbiertoId] = useState(null);
  const [presupuestoAbierto, setPresupuestoAbierto] = useState(null);

  useEffect(() => {
    api
      .get('/eventos')
      .then(setEventos)
      .catch(() => {});
    api
      .get('/productos?activo=1')
      .then(setProductos)
      .catch(() => {});
  }, []);

  const query = new URLSearchParams();
  if (estado) query.set('estado', estado);
  if (desde) query.set('desde', desde);
  if (hasta) query.set('hasta', hasta);
  if (eventoId) query.set('eventoId', eventoId);
  if (lote) query.set('lote', lote);

  const { datos: presupuestos, cargando, recargar } = usePolling(
    () => api.get(`/presupuestos?${query.toString()}`),
    15000,
    [estado, desde, hasta, eventoId, lote]
  );

  function cargarPresupuestoAbierto(id) {
    api
      .get(`/presupuestos/${id}`)
      .then(setPresupuestoAbierto)
      .catch((err) => {
        // Si lo acaban de borrar desde el propio modal (err.status 404), no queda nada
        // que mostrar — se cierra en vez de dejar el modal trabado en "Cargando…".
        if (err.status === 404) {
          cerrarPresupuesto();
          recargar();
        } else {
          setPresupuestoAbierto(null);
        }
      });
  }

  function abrirPresupuesto(id) {
    setPresupuestoAbiertoId(id);
    setPresupuestoAbierto(null);
    cargarPresupuestoAbierto(id);
  }

  function cerrarPresupuesto() {
    setPresupuestoAbiertoId(null);
    setPresupuestoAbierto(null);
  }

  function alCambiarPresupuesto() {
    cargarPresupuestoAbierto(presupuestoAbiertoId);
    recargar();
  }

  return (
    <div>
      <h2>Presupuestos confirmados</h2>

      <div className="card">
        <div className="toolbar">
          <div className="campo">
            <label>Evento</label>
            <BuscadorEvento eventos={eventos} value={eventoId} onChange={setEventoId} />
          </div>
          <div className="campo">
            <label>Lote</label>
            <input placeholder="N° de lote" value={lote} onChange={(e) => setLote(e.target.value)} />
          </div>
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
                <th>Estado</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {presupuestos.map((p) => (
                <tr key={p.id} onClick={() => abrirPresupuesto(p.id)} style={{ cursor: 'pointer' }}>
                  <td>{p.evento_nombre}</td>
                  <td>{p.lote_codigo}{p.lote_expositor ? ` — ${p.lote_expositor}` : ''}</td>
                  <td>{p.cliente_nombre || '—'}</td>
                  <td>{p.fecha || '—'}</td>
                  <td>{formatearMonto(p.monto_total)}</td>
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

      {presupuestoAbiertoId && (
        <Modal onClose={cerrarPresupuesto}>
          {!presupuestoAbierto ? (
            <p className="texto-suave">Cargando…</p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>
                {presupuestoAbierto.evento_nombre} — Lote: {presupuestoAbierto.lote_codigo}
                {presupuestoAbierto.lote_expositor ? ` (${presupuestoAbierto.lote_expositor})` : ''}
              </h3>
              <PresupuestoPanel presupuesto={presupuestoAbierto} productos={productos} onCambiado={alCambiarPresupuesto} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
