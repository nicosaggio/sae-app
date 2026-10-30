import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { ESTADOS_PRESUPUESTO, etiquetaEstadoPresupuesto } from '../constants';
import { fechaCorta, pesos } from '../catalogoFormat';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { CambiarLote } from '../components/CambiarLote';
import { EstadoCobro } from '../components/EstadoCobro';
import { Icono } from '../components/Icono';
import { PanelLateral } from '../components/PanelLateral';
import { PresupuestoPanel } from '../components/PresupuestoPanel';
import { Sello } from '../components/Sello';

const CONFIRMACION = [
  { value: 'confirmados', label: 'Confirmados' },
  { value: 'no_confirmados', label: 'No confirmados' },
  { value: 'rechazados', label: 'Rechazados' },
  { value: 'todos', label: 'Todos' },
];

const TIPOS = {
  confirmados: { titulo: 'Confirmados', vacio: 'confirmados' },
  pendientes: { titulo: 'No confirmados', vacio: 'sin confirmar' },
  rechazados: { titulo: 'Rechazados', vacio: 'rechazados' },
};

/** Texto en minúsculas y sin tildes, para comparar "cafe" con "Café". */
function sinTildes(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Una fila de la tabla a partir de un presupuesto confirmado. */
function filaConfirmado(p, abrir) {
  return {
    clave: `c-${p.id}`,
    cod: p.cod_fac,
    evento: p.evento_nombre,
    lote: p.lote_codigo,
    stand: p.lote_expositor,
    cliente: p.cliente_nombre,
    fecha: p.fecha,
    total: p.monto_total,
    responsable: p.responsable,
    cancelada: p.estado === 'cancelado',
    estado: <EstadoCobro estado={p.estado} />,
    abrir: () => abrir(p.id),
  };
}

/** Una fila de la tabla a partir de un presupuesto cargado desde la app que no se confirmó (pendiente o rechazado). */
function filaCotizacion(c, estado, navigate) {
  return {
    clave: `q-${c.id}`,
    cod: c.cod_fac,
    evento: c.evento_nombre,
    lote: c.lote,
    stand: c.nombre_stand,
    cliente: c.razon_social,
    fecha: c.fecha_carga,
    total: c.cantidad_lineas > 0 ? c.total : null,
    responsable: c.responsable,
    cancelada: false,
    estado: (
      <span className="estado-fila">
        <Sello estado={estado} corto />
        {estado === 'rechazada' && !c.rechazada_por && (
          <span className="etiqueta" title="Se rechazó solo: el evento ya terminó">
            Automático
          </span>
        )}
      </span>
    ),
    abrir: () => navigate(`/presupuestos/carga/${c.id}`),
  };
}

// Las tres listas comparten columnas y anchos (suman 1130 px, lo que hay de ancho útil en una pantalla de 1440).
// Evento, lote y cliente se cortan con puntos suspensivos; el resto entra entero.
const ANCHOS_COLUMNAS = [118, 110, 178, 156, 92, 118, 118, 212, 28];

/** Tabla de presupuestos: la fila entera se toca (o se abre con Enter). La última columna depende de qué lista es. */
function TablaLista({ filas, tituloEstado }) {
  return (
    <div className="tabla-scroll">
      <table className="tabla tabla--clic tabla--lista">
        <colgroup>
          {ANCHOS_COLUMNAS.map((ancho, i) => (
            <col key={i} style={{ width: ancho }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="ajusta">Cód. de facturación</th>
            <th>Evento</th>
            <th>Lote — stand</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th className="num">Total con IVA</th>
            <th>Responsable</th>
            <th>{tituloEstado}</th>
            <th>
              <span className="solo-lectores">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={f.clave}
              tabIndex={0}
              onClick={f.abrir}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  f.abrir();
                }
              }}
            >
              <td className="codigo">{f.cod || <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>—</span>}</td>
              <td className="cel-ell" title={f.evento || ''}>
                {f.evento || '—'}
              </td>
              <td className={`cel-ell${f.cancelada ? ' tachado' : ''}`} title={[f.lote, f.stand].filter(Boolean).join(' — ')}>
                {f.lote || '—'}
                {f.stand && (
                  <>
                    {' '}
                    — <strong style={{ fontWeight: 600 }}>{f.stand}</strong>
                  </>
                )}
              </td>
              <td className="cel-ell" title={f.cliente || ''}>
                {f.cliente || '—'}
              </td>
              <td className="nw">{fechaCorta(f.fecha)}</td>
              <td className="num">{f.total === null || f.total === undefined ? '—' : pesos(f.total)}</td>
              <td className="nw">{f.responsable || '—'}</td>
              <td className="nw">{f.estado}</td>
              <td className="chev">
                <Icono nombre="chev-r" className="icono--sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Una de las listas (confirmados, no confirmados, rechazados) dentro de su tarjeta: cargando, vacía o con la tabla. */
function SeccionLista({ tipo, filas, cargando, mostrarTitulo, hayFiltros, onLimpiar, tituloEstado }) {
  const { titulo, vacio } = TIPOS[tipo];
  return (
    <section className="tarjeta" aria-label={titulo}>
      {mostrarTitulo && (
        <div className="tarjeta-cab tarjeta-cab--simple">
          <h2>
            {titulo} <span className="etiqueta" style={{ marginLeft: 6 }}>{filas.length}</span>
          </h2>
        </div>
      )}
      {cargando ? (
        <div className="tarjeta-cuerpo pila" aria-busy="true" aria-label="Cargando">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="esqueleto" />
          ))}
        </div>
      ) : filas.length === 0 ? (
        <div className="vacio">
          <span className="icono-vacio">
            <Icono nombre="search" className="icono--lg" />
          </span>
          <h3>{hayFiltros ? `No hay presupuestos ${vacio} con estos filtros` : `Todavía no hay presupuestos ${vacio}`}</h3>
          {hayFiltros && <p>Probá con otro lote o stand, o quitá algún filtro.</p>}
          {hayFiltros && (
            <button type="button" className="boton" onClick={onLimpiar}>
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <TablaLista filas={filas} tituloEstado={tituloEstado} />
      )}
    </section>
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
  const [stand, setStand] = useState('');
  const [mail, setMail] = useState('');
  const [productos, setProductos] = useState([]);
  const [presupuestoAbiertoId, setPresupuestoAbiertoId] = useState(null);
  const [presupuestoAbierto, setPresupuestoAbierto] = useState(null);
  const [cotizacionOrigen, setCotizacionOrigen] = useState(null);
  const idf = useId();

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

  // Las tres listas se leen siempre: así el control de arriba puede mostrar cuántos hay en cada una
  const { datos: presupuestos, error: errorConfirmados, recargar } = usePolling(() => api.get(`/presupuestos?${query.toString()}`), 15000, [estado, desde, hasta, eventoId, lote]);

  // Presupuestos cargados desde la app que todavía no se confirmaron
  const { datos: pendientesTodos, error: errorPendientes } = usePolling(() => api.get(`/cotizaciones?estado=pendiente${eventoId ? `&eventoId=${eventoId}` : ''}`), 15000, [eventoId]);

  // Presupuestos cargados desde la app que el cliente no aceptó
  const { datos: rechazadosTodos, error: errorRechazados } = usePolling(() => api.get(`/cotizaciones?estado=rechazada${eventoId ? `&eventoId=${eventoId}` : ''}`), 15000, [eventoId]);

  // El nombre de stand se filtra acá y no en el servidor para que ignore tildes y mayúsculas. Es el que se
  // ve en la columna Lote: `nombre_stand` en los presupuestos de la app, el expositor del lote en los confirmados.
  const buscadoStand = sinTildes(stand).trim();
  const coincideStand = (nombre) => !buscadoStand || sinTildes(nombre).includes(buscadoStand);

  // El mail del cliente se filtra igual, buscando el texto en cualquiera de los datos que lo guardan: el mail
  // del presupuesto de la app y, en los confirmados, el contacto del presupuesto (ahí va "contacto - mail",
  // y en los que vinieron de Excel es donde estuviera escrito).
  const buscadoMail = sinTildes(mail).trim();
  const coincideMail = (...textos) => !buscadoMail || textos.some((t) => sinTildes(t).includes(buscadoMail));

  // Ni los pendientes ni los rechazados tienen estado de cobro: si se filtra por estado, no aparecen
  function filtrarSinEstado(lista) {
    return estado
      ? []
      : (lista || []).filter(
          (c) =>
            (!lote || (c.lote || '').toLowerCase().includes(lote.toLowerCase())) &&
            coincideStand(c.nombre_stand) &&
            coincideMail(c.mail) &&
            (!desde || (c.evento_fecha_inicio || '') >= desde) &&
            (!hasta || (c.evento_fecha_inicio || '9999') <= hasta)
        );
  }
  const pendientes = filtrarSinEstado(pendientesTodos);
  const rechazados = filtrarSinEstado(rechazadosTodos);
  const confirmados = (presupuestos || []).filter((p) => coincideStand(p.lote_expositor) && coincideMail(p.cliente_contacto, p.cotizacion_mail));

  function cargarPresupuestoAbierto(id) {
    api
      .get(`/presupuestos/${id}`)
      .then(setPresupuestoAbierto)
      .catch((err) => {
        // Si lo acaban de borrar desde el propio panel (err.status 404), no queda nada
        // que mostrar — se cierra en vez de dejar el panel trabado en "Cargando…".
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

  // Filtros aplicados: cada uno con la forma de quitarlo
  const nombreEvento = eventos.find((e) => e.id === eventoId)?.nombre || 'elegido';
  const fichas = [
    eventoId && { clave: 'evento', nombre: 'Evento', texto: nombreEvento, quitar: () => setEventoId(null) },
    lote.trim() && { clave: 'lote', nombre: 'Lote', texto: lote.trim(), quitar: () => setLote('') },
    stand.trim() && { clave: 'stand', nombre: 'Stand', texto: stand.trim(), quitar: () => setStand('') },
    mail.trim() && { clave: 'mail', nombre: 'Mail', texto: mail.trim(), quitar: () => setMail('') },
    estado && { clave: 'estado', nombre: 'Cobro', texto: etiquetaEstadoPresupuesto(estado), quitar: () => setEstado('') },
    desde && { clave: 'desde', nombre: 'Desde', texto: fechaCorta(desde), quitar: () => setDesde('') },
    hasta && { clave: 'hasta', nombre: 'Hasta', texto: fechaCorta(hasta), quitar: () => setHasta('') },
  ].filter(Boolean);

  function limpiarFiltros() {
    setEventoId(null);
    setLote('');
    setStand('');
    setMail('');
    setEstado('');
    setDesde('');
    setHasta('');
  }

  const hayFiltros = fichas.length > 0;
  const mostrarConfirmados = verConfirmados;
  const mostrarPendientes = verPendientes && !estado;
  const mostrarRechazados = verRechazados && !estado;
  const sinCobroEnLaVista = estado && !verConfirmados; // se pidió ver pendientes o rechazados filtrando por un estado que no tienen
  const total = (mostrarConfirmados ? confirmados.length : 0) + (mostrarPendientes ? pendientes.length : 0) + (mostrarRechazados ? rechazados.length : 0);
  const cargandoConfirmados = presupuestos === null && !errorConfirmados;
  const cargandoPendientes = pendientesTodos === null && !errorPendientes;
  const cargandoRechazados = rechazadosTodos === null && !errorRechazados;
  const hayError = Boolean((presupuestos === null && errorConfirmados) || (pendientesTodos === null && errorPendientes) || (rechazadosTodos === null && errorRechazados));
  const cuenta = (n, cargando) => (cargando ? '' : n);
  const filaAbierta = (presupuestos || []).find((p) => p.id === presupuestoAbiertoId);
  const baseAbierta = presupuestoAbierto || filaAbierta; // el encabezado del panel sale de la fila de la lista hasta que llega el detalle
  const mostrarTitulos = confirmacion === 'todos';

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Presupuestos</h1>
          <p className="sub">Confirmados, pendientes de confirmación y rechazados. Tocá una fila para abrirla.</p>
        </div>
        {puedeEscribir && (
          <Link className="boton boton--primario" to="/presupuestos/nuevo">
            <Icono nombre="plus" />
            Nuevo presupuesto
          </Link>
        )}
      </header>

      <section className="tarjeta" aria-label="Filtros" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="tarjeta-cuerpo pila">
          <div className="fila fila--entre">
            <div className="segmentado" role="group" aria-label="Confirmación">
              {CONFIRMACION.map((c) => (
                <button key={c.value} type="button" aria-pressed={confirmacion === c.value} onClick={() => setConfirmacion(c.value)}>
                  {c.label}
                  {c.value === 'confirmados' && <span className="n">{cuenta(confirmados.length, cargandoConfirmados)}</span>}
                  {c.value === 'no_confirmados' && <span className="n">{cuenta(pendientes.length, cargandoPendientes)}</span>}
                  {c.value === 'rechazados' && <span className="n">{cuenta(rechazados.length, cargandoRechazados)}</span>}
                </button>
              ))}
            </div>
            <p className="sub" aria-live="polite">
              {hayError ? '' : total === 1 ? '1 presupuesto' : `${total} presupuestos`}
            </p>
          </div>

          <div className="grid grid-4" style={{ gap: 'var(--s-3) var(--s-4)' }}>
            <div className="campo">
              <label htmlFor={`${idf}-evento`}>Evento</label>
              <div className="entrada-icono">
                <Icono nombre="search" />
                <BuscadorEvento id={`${idf}-evento`} eventos={eventos} value={eventoId} onChange={setEventoId} placeholder="Buscar evento…" />
              </div>
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-lote`}>Lote</label>
              <input id={`${idf}-lote`} placeholder="N.º de lote" value={lote} onChange={(e) => setLote(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-stand`}>Nombre de stand</label>
              <input id={`${idf}-stand`} placeholder="Buscar por nombre de stand" value={stand} onChange={(e) => setStand(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-mail`}>Mail del cliente</label>
              <input id={`${idf}-mail`} placeholder="Buscar por mail" value={mail} onChange={(e) => setMail(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-estado`}>Estado de cobro</label>
              <select id={`${idf}-estado`} value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option>
                {ESTADOS_PRESUPUESTO.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-desde`}>Evento desde</label>
              <input id={`${idf}-desde`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-hasta`}>Evento hasta</label>
              <input id={`${idf}-hasta`} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="campo" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="boton boton--suave" style={{ alignSelf: 'flex-start' }} onClick={limpiarFiltros} disabled={!hayFiltros}>
                <Icono nombre="x" />
                Limpiar filtros
              </button>
            </div>
          </div>

          {hayFiltros && (
            <div className="fichas" role="group" aria-label="Filtros aplicados">
              {fichas.map((f) => (
                <span key={f.clave} className="ficha">
                  {f.nombre}: {f.texto}
                  <button type="button" onClick={f.quitar} aria-label={`Quitar el filtro ${f.nombre}`}>
                    <Icono nombre="x" className="icono--sm" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {estado && (
            <p className="mensaje mensaje--info">
              <Icono nombre="info" />
              <span>Los presupuestos pendientes y rechazados no tienen estado de cobro, por eso no aparecen al filtrar por ese estado.</span>
            </p>
          )}
        </div>
      </section>

      {hayError && (
        <div className="aviso aviso--error" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <Icono nombre="warn" />
          <div className="aviso-cuerpo">No se pudieron cargar los presupuestos. Se vuelve a intentar solo en unos segundos.</div>
        </div>
      )}

      <div className="pila pila--grande">
        {mostrarPendientes && (
          <SeccionLista
            tipo="pendientes"
            filas={pendientes.map((c) => filaCotizacion(c, 'pendiente', navigate))}
            cargando={cargandoPendientes}
            mostrarTitulo={mostrarTitulos}
            hayFiltros={hayFiltros}
            onLimpiar={limpiarFiltros}
            tituloEstado="Estado"
          />
        )}
        {mostrarRechazados && (
          <SeccionLista
            tipo="rechazados"
            filas={rechazados.map((c) => filaCotizacion(c, 'rechazada', navigate))}
            cargando={cargandoRechazados}
            mostrarTitulo={mostrarTitulos}
            hayFiltros={hayFiltros}
            onLimpiar={limpiarFiltros}
            tituloEstado="Estado"
          />
        )}
        {sinCobroEnLaVista && (
          <section className="tarjeta" aria-label="Sin estado de cobro">
            <div className="vacio">
              <span className="icono-vacio">
                <Icono nombre="filter" className="icono--lg" />
              </span>
              <h3>Estos presupuestos no tienen estado de cobro</h3>
              <p>Quitá el filtro “Estado de cobro” para verlos.</p>
            </div>
          </section>
        )}
        {mostrarConfirmados && (
          <SeccionLista
            tipo="confirmados"
            filas={confirmados.map((p) => filaConfirmado(p, abrirPresupuesto))}
            cargando={cargandoConfirmados}
            mostrarTitulo={mostrarTitulos}
            hayFiltros={hayFiltros}
            onLimpiar={limpiarFiltros}
            tituloEstado="Estado de cobro"
          />
        )}
      </div>

      {presupuestoAbiertoId && (
        <PanelLateral
          titulo="Presupuesto confirmado"
          onClose={cerrarPresupuesto}
          cabecera={
            <>
              <div className="fila" style={{ gap: 'var(--s-2)', marginBottom: 6 }}>
                <Sello estado="confirmada" />
                <span className="sub">{filaAbierta?.cod_fac ? `Cód. de facturación ${filaAbierta.cod_fac}` : 'Sin código de facturación'}</span>
              </div>
              {baseAbierta && (
                <h2>
                  {baseAbierta.evento_nombre} · Lote {baseAbierta.lote_codigo}
                  {baseAbierta.lote_expositor ? ` — ${baseAbierta.lote_expositor}` : ''}
                </h2>
              )}
            </>
          }
          pie={
            <>
              <span className="ayuda">Los cambios se guardan solos.</span>
              <button type="button" className="boton boton--primario" onClick={cerrarPresupuesto}>
                Listo
              </button>
            </>
          }
        >
          {!presupuestoAbierto ? (
            <div className="pila" aria-busy="true" aria-label="Cargando">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="esqueleto" />
              ))}
            </div>
          ) : (
            <>
              {cotizacionOrigen && (
                <div className="aviso aviso--info">
                  <Icono nombre="info" />
                  <div className="aviso-cuerpo">
                    Presupuesto cargado desde la app. <Link to={`/presupuestos/carga/${cotizacionOrigen.id}`}>Ver el presupuesto original (PDF y adjuntos)</Link>
                  </div>
                </div>
              )}
              <CambiarLote presupuesto={presupuestoAbierto} onCambiado={alCambiarPresupuesto} />
              <PresupuestoPanel key={presupuestoAbierto.id} presupuesto={presupuestoAbierto} productos={productos} onCambiado={alCambiarPresupuesto} onGuardado={recargar} />
            </>
          )}
        </PanelLateral>
      )}
    </div>
  );
}
