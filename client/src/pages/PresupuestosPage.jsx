import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { ESTADOS_PRESUPUESTO, etiquetaEstadoPresupuesto } from '../constants';
import { fechaCorta, pesos } from '../catalogoFormat';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { Modal } from '../components/Modal';
import { PresupuestoPanel } from '../components/PresupuestoPanel';

const CONFIRMACION = [
  { value: 'confirmados', label: 'Confirmados' },
  { value: 'no_confirmados', label: 'No confirmados' },
  { value: 'rechazados', label: 'Rechazados' },
  { value: 'todos', label: 'Todos' },
];

// Las tres tablas (no confirmados, rechazados y confirmados) tienen las mismas 8 columnas con los mismos
// anchos, para que se lean alineadas una debajo de la otra (ver .tabla-presupuestos en index.css).
// Las columnas cortas llevan un ancho fijo (el justo para su texto más largo); evento, lote y cliente
// (null) se reparten lo que sobra.
const ANCHOS_COLUMNAS = [160, null, null, null, 100, 130, 125, 190];

function Columnas() {
  return (
    <colgroup>
      {ANCHOS_COLUMNAS.map((ancho, i) => (
        <col key={i} style={ancho ? { width: ancho } : undefined} />
      ))}
    </colgroup>
  );
}

/** Tabla de cotizaciones (presupuestos cargados desde la app que no forman parte de un evento). */
function TablaCotizaciones({ lista, cargando, mensajeVacio, badgeClase, badgeTexto, onAbrir }) {
  if (cargando) return <p className="texto-suave">Cargando…</p>;
  if (lista.length === 0) return <p className="texto-suave">{mensajeVacio}</p>;
  return (
    <div className="tabla-scroll">
      <table className="tabla-presupuestos">
        <Columnas />
        <thead>
          <tr>
            <th>Cód. de facturación</th>
            <th>Evento</th>
            <th>Lote</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Total con IVA</th>
            <th>Responsable</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.id} onClick={() => onAbrir(c.id)} style={{ cursor: 'pointer' }}>
              <td>{c.cod_fac || <span className="texto-suave">—</span>}</td>
              <td>{c.evento_nombre || <span className="texto-suave">—</span>}</td>
              <td>
                {c.lote || '—'}
                {c.nombre_stand ? ` — ${c.nombre_stand}` : ''}
              </td>
              <td>{c.razon_social || '—'}</td>
              <td>{fechaCorta(c.fecha_carga)}</td>
              <td>{c.cantidad_lineas > 0 ? pesos(c.total) : '—'}</td>
              <td>{c.responsable || '—'}</td>
              <td>
                <span className={`badge ${badgeClase}`}>{badgeTexto}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PresupuestosPage() {
  const navigate = useNavigate();
  const { puedeEscribir } = useAuth();
  const [confirmacion, setConfirmacion] = useState('confirmados');
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [eventoId, setEventoId] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [lote, setLote] = useState('');
  const [productos, setProductos] = useState([]);
  const [presupuestoAbiertoId, setPresupuestoAbiertoId] = useState(null);
  const [presupuestoAbierto, setPresupuestoAbierto] = useState(null);

  const [cotizacionOrigen, setCotizacionOrigen] = useState(null);

  const verConfirmados = confirmacion === 'confirmados' || confirmacion === 'todos';
  const verPendientes = confirmacion === 'no_confirmados' || confirmacion === 'todos';
  const verRechazados = confirmacion === 'rechazados' || confirmacion === 'todos';

  // Un presupuesto que se cargó desde la app enlaza a su versión original (PDF y adjuntos)
  useEffect(() => {
    if (presupuestoAbierto?.origen !== 'app') {
      setCotizacionOrigen(null);
      return;
    }
    api
      .get(`/cotizaciones?presupuestoId=${presupuestoAbierto.id}`)
      .then((lista) => setCotizacionOrigen(lista[0] || null))
      .catch(() => setCotizacionOrigen(null));
  }, [presupuestoAbierto?.id, presupuestoAbierto?.origen]);

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
    () => (verConfirmados ? api.get(`/presupuestos?${query.toString()}`) : Promise.resolve([])),
    15000,
    [estado, desde, hasta, eventoId, lote, verConfirmados]
  );

  // Presupuestos cargados desde la app que todavía no se confirmaron
  const { datos: pendientesTodos, cargando: cargandoPendientes } = usePolling(
    () => (verPendientes ? api.get(`/cotizaciones?estado=pendiente${eventoId ? `&eventoId=${eventoId}` : ''}`) : Promise.resolve([])),
    15000,
    [verPendientes, eventoId]
  );

  // Presupuestos cargados desde la app que el cliente no aceptó
  const { datos: rechazadosTodos, cargando: cargandoRechazados } = usePolling(
    () => (verRechazados ? api.get(`/cotizaciones?estado=rechazada${eventoId ? `&eventoId=${eventoId}` : ''}`) : Promise.resolve([])),
    15000,
    [verRechazados, eventoId]
  );

  // Ni los pendientes ni los rechazados tienen estado de facturación: si se filtra por estado, no aparecen
  function filtrarSinEstado(lista) {
    return estado
      ? []
      : (lista || []).filter(
          (c) =>
            (!lote || (c.lote || '').toLowerCase().includes(lote.toLowerCase())) &&
            (!desde || (c.evento_fecha_inicio || '') >= desde) &&
            (!hasta || (c.evento_fecha_inicio || '9999') <= hasta)
        );
  }
  const pendientes = filtrarSinEstado(pendientesTodos);
  const rechazados = filtrarSinEstado(rechazadosTodos);

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

  const titulos = confirmacion === 'todos';

  return (
    <div>
      <div className="cot-cabecera">
        <h2 style={{ margin: 0 }}>Presupuestos</h2>
        {puedeEscribir && (
          <button className="primario" onClick={() => navigate('/presupuestos/nuevo')}>
            + Nuevo presupuesto
          </button>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="campo">
            <label>Confirmación</label>
            <select value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}>
              {CONFIRMACION.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
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
            <select value={estado} onChange={(e) => setEstado(e.target.value)} disabled={!verConfirmados}>
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

        {verPendientes && (
          <div style={{ marginBottom: verRechazados || verConfirmados ? 24 : 0 }}>
            {titulos && <h3 style={{ marginTop: 0 }}>No confirmados ({pendientes.length})</h3>}
            <TablaCotizaciones
              lista={pendientes}
              cargando={cargandoPendientes}
              mensajeVacio="No hay presupuestos sin confirmar con estos filtros."
              badgeClase="pendiente_confirmacion"
              badgeTexto="Pendiente de confirmación"
              onAbrir={(id) => navigate(`/presupuestos/carga/${id}`)}
            />
          </div>
        )}

        {verRechazados && (
          <div style={{ marginBottom: verConfirmados ? 24 : 0 }}>
            {titulos && <h3 style={{ marginTop: 0 }}>Rechazados ({rechazados.length})</h3>}
            <TablaCotizaciones
              lista={rechazados}
              cargando={cargandoRechazados}
              mensajeVacio="No hay presupuestos rechazados con estos filtros."
              badgeClase="rechazada"
              badgeTexto="Rechazado"
              onAbrir={(id) => navigate(`/presupuestos/carga/${id}`)}
            />
          </div>
        )}

        {verConfirmados && (
          <div>
            {titulos && <h3 style={{ marginTop: 0 }}>Confirmados ({presupuestos ? presupuestos.length : 0})</h3>}
            {cargando ? (
              <p className="texto-suave">Cargando…</p>
            ) : !presupuestos || presupuestos.length === 0 ? (
              <p className="texto-suave">No hay presupuestos confirmados con estos filtros.</p>
            ) : (
              <div className="tabla-scroll">
              <table className="tabla-presupuestos">
                <Columnas />
                <thead>
                  <tr>
                    <th>Cód. de facturación</th>
                    <th>Evento</th>
                    <th>Lote</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th>Total con IVA</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {presupuestos.map((p) => (
                    <tr key={p.id} onClick={() => abrirPresupuesto(p.id)} style={{ cursor: 'pointer' }}>
                      <td>{p.cod_fac || <span className="texto-suave">—</span>}</td>
                      <td>{p.evento_nombre}</td>
                      <td>{p.lote_codigo}{p.lote_expositor ? ` — ${p.lote_expositor}` : ''}</td>
                      <td>{p.cliente_nombre || '—'}</td>
                      <td>{fechaCorta(p.fecha)}</td>
                      <td>{pesos(p.monto_total)}</td>
                      <td>{p.responsable || '—'}</td>
                      <td>
                        <span className={`badge ${p.estado}`}>{etiquetaEstadoPresupuesto(p.estado)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
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
              {cotizacionOrigen && (
                <p style={{ marginTop: 0 }}>
                  <Link to={`/presupuestos/carga/${cotizacionOrigen.id}`}>Ver el presupuesto original cargado desde la app (PDF y adjuntos)</Link>
                </p>
              )}
              <PresupuestoPanel presupuesto={presupuestoAbierto} productos={productos} onCambiado={alCambiarPresupuesto} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
