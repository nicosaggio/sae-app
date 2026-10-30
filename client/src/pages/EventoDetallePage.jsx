import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { DialogoConfirmar } from '../components/DialogoConfirmar';
import { Icono } from '../components/Icono';
import { LoteFila } from '../components/LoteFila';
import { MenuMas } from '../components/MenuMas';
import { PresupuestoPanelLateral } from '../components/PresupuestoPanelLateral';
import { ReglaFases } from '../components/ReglaFases';
import { useAuth } from '../context/AuthContext';
import { fechaCorta, pesos } from '../catalogoFormat';
import { cuandoEs, esFechaIso } from '../fechas';

// Los datos del evento que se guardan (lo demás que trae el servidor no se manda de vuelta)
const CAMPOS = ['nombre', 'lugar', 'fecha_inicio', 'fecha_fin', 'fecha_armado', 'fecha_desarme', 'notas'];
const datosDe = (evento) => Object.fromEntries(CAMPOS.map((k) => [k, evento[k] ?? '']));

export function EventoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { puedeEscribir } = useAuth();
  const [evento, setEvento] = useState(null);
  const [productos, setProductos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState('inactivo'); // inactivo | guardando | ok
  const guardadoRef = useRef(null); // lo último que quedó guardado: sólo se guarda lo que cambió de verdad
  const [nuevoLote, setNuevoLote] = useState(null); // el formulario de alta mientras está abierto
  const [errorLote, setErrorLote] = useState('');
  const [abiertos, setAbiertos] = useState(() => new Set()); // los lotes desplegados
  const [fusion, setFusion] = useState(null); // { otroEventoId, trabajando } mientras está abierta la ventana de unificar
  const [presupuestoAbierto, setPresupuestoAbierto] = useState(null); // { id, resumen } mientras está abierto el panel
  const avisosRef = useRef(null);
  const idf = useId();

  // Lo que cambia cuando se toca algo: el evento y sus pendientes (los productos y la lista de eventos no)
  const recargar = useCallback(async () => {
    try {
      const [ev, listaPendientes] = await Promise.all([
        api.get(`/eventos/${id}`),
        // Si esto falla no es motivo para dejar el evento sin mostrar: solo no aparece la lista.
        api.get(`/cotizaciones?estado=pendiente&eventoId=${id}`).catch(() => []),
      ]);
      setEvento(ev);
      guardadoRef.current = datosDe(ev);
      setPendientes(listaPendientes);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    setCargando(true);
    setError('');
    setAbiertos(new Set());
    setPresupuestoAbierto(null);
    Promise.all([api.get(`/eventos/${id}`), api.get('/productos?activo=1'), api.get('/eventos'), api.get(`/cotizaciones?estado=pendiente&eventoId=${id}`).catch(() => [])])
      .then(([ev, listaProductos, listaEventos, listaPendientes]) => {
        setEvento(ev);
        guardadoRef.current = datosDe(ev);
        setProductos(listaProductos);
        setEventos(listaEventos);
        setPendientes(listaPendientes);
      })
      .catch((err) => {
        setEvento(null);
        setError(err.message);
      })
      .finally(() => setCargando(false));
  }, [id]);

  // Un error se muestra arriba de todo: si la persona está más abajo (en un lote), se lo trae a la vista
  useEffect(() => {
    if (error) avisosRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  // Lo que está mal en lo escrito, a la vista mientras se escribe; mientras haya algo mal no se guarda
  const nombreVacio = evento ? !evento.nombre.trim() : false;
  const fechasAlReves = evento ? esFechaIso(evento.fecha_inicio) && esFechaIso(evento.fecha_fin) && evento.fecha_fin < evento.fecha_inicio : false;

  async function guardarCampo(campos) {
    const hayCambios = Object.keys(campos).some((k) => String(campos[k] ?? '') !== String(guardadoRef.current[k] ?? ''));
    if (!hayCambios || nombreVacio || fechasAlReves) return;
    if (!esFechaIso(evento.fecha_inicio) || !esFechaIso(evento.fecha_fin)) {
      setError('Las fechas de inicio y de fin son obligatorias: mientras tanto, los cambios no se guardan.');
      return;
    }
    setError('');
    setGuardado('guardando');
    try {
      const actualizado = await api.put(`/eventos/${id}`, { ...datosDe(evento), ...campos });
      setEvento((e) => ({ ...e, ...actualizado }));
      guardadoRef.current = datosDe(actualizado);
      setGuardado('ok');
    } catch (err) {
      setError(err.message);
      setGuardado('inactivo');
    }
  }

  async function crearLote(e) {
    e.preventDefault();
    if (!nuevoLote.codigo.trim()) return;
    setErrorLote('');
    try {
      const creado = await api.post(`/eventos/${id}/lotes`, nuevoLote);
      setNuevoLote(null);
      setAbiertos((s) => new Set(s).add(creado.id)); // el lote recién creado queda abierto: lo primero que se hace es cargarle algo
      recargar();
    } catch (err) {
      setErrorLote(err.message);
    }
  }

  async function unificarEventos() {
    setFusion((f) => ({ ...f, trabajando: true, error: '' }));
    try {
      await api.post(`/eventos/${id}/fusionar`, { otroEventoId: fusion.otroEventoId });
      setFusion(null);
      recargar();
      api
        .get('/eventos')
        .then(setEventos)
        .catch(() => {});
    } catch (err) {
      setFusion((f) => ({ ...f, trabajando: false, error: err.message }));
    }
  }

  const alternarLote = (loteId) =>
    setAbiertos((s) => {
      const siguiente = new Set(s);
      if (!siguiente.delete(loteId)) siguiente.add(loteId);
      return siguiente;
    });

  if (cargando) {
    return (
      <div className="ed" aria-busy="true" aria-label="Cargando">
        <div className="esqueleto" style={{ width: 260, height: 32, marginBottom: 'var(--s-5)' }} />
        <div className="pila pila--grande">
          {[1, 2, 3].map((n) => (
            <div key={n} className="tarjeta">
              <div className="tarjeta-cuerpo pila">
                <div className="esqueleto" />
                <div className="esqueleto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!evento) {
    return (
      <div className="ed">
        <div className="aviso aviso--error" role="alert">
          <Icono nombre="warn" />
          <div className="aviso-cuerpo">{error || 'Evento no encontrado'}</div>
        </div>
      </div>
    );
  }

  const lotes = evento.lotes;
  const todosAbiertos = lotes.length > 0 && lotes.every((l) => abiertos.has(l.id));
  const cuando = cuandoEs(evento.fecha_inicio, evento.fecha_fin);
  const fechas = esFechaIso(evento.fecha_inicio) ? `${fechaCorta(evento.fecha_inicio)}${esFechaIso(evento.fecha_fin) && evento.fecha_fin !== evento.fecha_inicio ? ` al ${fechaCorta(evento.fecha_fin)}` : ''}` : '';
  const campoTexto = (clave) => ({
    value: evento[clave] ?? '',
    disabled: !puedeEscribir,
    onChange: (e) => setEvento({ ...evento, [clave]: e.target.value }),
    onBlur: (e) => guardarCampo({ [clave]: e.target.value }),
  });
  const textoGuardado = guardado === 'guardando' ? 'Guardando…' : puedeEscribir ? 'Se guarda al salir de cada campo' : 'Sólo lectura';

  return (
    <div className="ed">
      <nav className="migas" aria-label="Ubicación">
        <Link to="/calendario">
          <Icono nombre="arrow-l" className="icono--sm" />
          Calendario
        </Link>
      </nav>

      <header className="pagina-cab">
        <div>
          <h1>{evento.nombre.trim() || 'Evento sin nombre'}</h1>
          <p className="sub fila" style={{ gap: 'var(--s-3)', marginTop: 6 }}>
            {evento.lugar && (
              <span className="fila" style={{ gap: 6 }}>
                <Icono nombre="pin" className="icono--sm" />
                {evento.lugar}
              </span>
            )}
            {fechas && <span>{fechas}</span>}
            {cuando && <span className="etiqueta etiqueta--ciruela">{cuando}</span>}
          </p>
        </div>
        {puedeEscribir && (
          <MenuMas
            etiqueta="Más acciones del evento"
            acciones={[{ texto: 'Unificar con otro evento…', icono: 'merge', onSelect: () => setFusion({ otroEventoId: null, trabajando: false }) }]}
          />
        )}
      </header>

      <div className="avisos" ref={avisosRef}>
        {error && (
          <div className="aviso aviso--error" role="alert">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">{error}</div>
          </div>
        )}
      </div>

      <div className="pila pila--grande">
        <section className="tarjeta" aria-labelledby={`${idf}-fases`}>
          <div className="tarjeta-cuerpo">
            <div className="fila fila--entre" style={{ marginBottom: 'var(--s-6)' }}>
              <h2 id={`${idf}-fases`}>Fases del evento</h2>
              <div className="leyenda">
                <span>
                  <i className="l-armado" />
                  Armado
                </span>
                <span>
                  <i className="l-evento" />
                  Evento
                </span>
                <span>
                  <i className="l-desarme" />
                  Desarme
                </span>
                <span style={{ color: 'var(--c-texto-3)' }}>D = desarme el último día</span>
              </div>
            </div>
            {esFechaIso(evento.fecha_inicio) && esFechaIso(evento.fecha_fin) && !fechasAlReves ? (
              <div style={{ padding: '0 var(--s-2)' }}>
                <ReglaFases armado={evento.fecha_armado} inicio={evento.fecha_inicio} fin={evento.fecha_fin} desarme={evento.fecha_desarme} />
              </div>
            ) : (
              <p className="sub">Las fechas de inicio y de fin tienen que estar completas y en orden para dibujar las fases.</p>
            )}
          </div>
        </section>

        <section className="tarjeta" aria-labelledby={`${idf}-datos`}>
          <div className="tarjeta-cab">
            <h2 id={`${idf}-datos`}>Datos del evento</h2>
            <span className={`ayuda${guardado === 'ok' ? ' ayuda--ok' : ''}`} role="status" style={{ fontSize: 'var(--t-sm)' }}>
              {guardado === 'ok' ? (
                <span className="fila" style={{ gap: 6 }}>
                  <Icono nombre="check-c" className="icono--sm" />
                  Guardado
                </span>
              ) : (
                textoGuardado
              )}
            </span>
          </div>
          <div className="tarjeta-cuerpo pila">
            <div className="grid grid-4">
              <div className={`campo span-2${nombreVacio ? ' campo--error' : ''}`}>
                <label htmlFor={`${idf}-nombre`}>Nombre</label>
                <input id={`${idf}-nombre`} {...campoTexto('nombre')} />
              </div>
              <div className="campo span-2">
                <label htmlFor={`${idf}-lugar`}>Lugar</label>
                <input id={`${idf}-lugar`} {...campoTexto('lugar')} />
              </div>
              <div className={`campo${fechasAlReves ? ' campo--error' : ''}`}>
                <label htmlFor={`${idf}-inicio`}>Fecha de inicio</label>
                <input id={`${idf}-inicio`} type="date" {...campoTexto('fecha_inicio')} />
              </div>
              <div className={`campo${fechasAlReves ? ' campo--error' : ''}`}>
                <label htmlFor={`${idf}-fin`}>Fecha de fin</label>
                <input id={`${idf}-fin`} type="date" {...campoTexto('fecha_fin')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idf}-armado`}>
                  Fecha de armado <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                </label>
                <input id={`${idf}-armado`} type="date" {...campoTexto('fecha_armado')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idf}-desarme`}>
                  Fecha de desarme <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                </label>
                <input id={`${idf}-desarme`} type="date" {...campoTexto('fecha_desarme')} />
              </div>
              <div className="campo span-todo">
                <label htmlFor={`${idf}-notas`}>Notas</label>
                <input id={`${idf}-notas`} {...campoTexto('notas')} />
              </div>
            </div>
            {(nombreVacio || fechasAlReves) && (
              <p className="mensaje mensaje--error" role="alert">
                <Icono nombre="warn" />
                <span>{nombreVacio ? 'El nombre no puede quedar vacío: mientras tanto, los cambios no se guardan.' : 'La fecha de fin no puede ser anterior a la de inicio: mientras tanto, los cambios no se guardan.'}</span>
              </p>
            )}
          </div>
          <div className="tarjeta-pie" style={{ fontSize: 'var(--t-sm)', color: 'var(--c-texto-2)' }}>
            Creado por {evento.creado_por_nombre || evento.creado_por_usuario}
          </div>
        </section>

        {pendientes.length > 0 && (
          <section className="tarjeta" aria-labelledby={`${idf}-pendientes`}>
            <div className="tarjeta-cab">
              <div>
                <h2 id={`${idf}-pendientes`}>
                  Presupuestos pendientes de confirmación{' '}
                  <span className="sello sello--pendiente" style={{ marginLeft: 6 }}>
                    {pendientes.length}
                  </span>
                </h2>
                <p className="sub">Todavía no forman parte del evento: no suman en los totales ni en la facturación hasta que se confirman.</p>
              </div>
            </div>
            <div className="tabla-scroll">
              <table className="tabla tabla--clic">
                <thead>
                  <tr>
                    <th>Cód. de facturación</th>
                    <th>Lote — stand</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th className="num">Total con IVA</th>
                    <th>Responsable</th>
                    <th>
                      <span className="solo-lectores">Abrir</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((c) => {
                    const abrir = () => navigate(`/presupuestos/carga/${c.id}`);
                    return (
                      <tr
                        key={c.id}
                        tabIndex={0}
                        onClick={abrir}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            abrir();
                          }
                        }}
                      >
                        <td className="codigo">{c.cod_fac || <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>—</span>}</td>
                        <td>
                          {c.lote || '—'}
                          {c.nombre_stand ? ` — ${c.nombre_stand}` : ''}
                        </td>
                        <td>{c.razon_social || '—'}</td>
                        <td className="nw">{fechaCorta(c.fecha_carga)}</td>
                        <td className="num">{c.cantidad_lineas > 0 ? pesos(c.total) : '—'}</td>
                        <td>{c.responsable || '—'}</td>
                        <td className="chev">
                          <Icono nombre="chev-r" className="icono--sm" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="tarjeta" aria-labelledby={`${idf}-lotes`}>
          <div className="tarjeta-cab">
            <div>
              <h2 id={`${idf}-lotes`}>
                Lotes <span className="etiqueta" style={{ marginLeft: 6 }}>{lotes.length}</span>
              </h2>
              <p className="sub">Cada lote es un stand. Tocá uno para ver y editar sus presupuestos.</p>
            </div>
            <div className="fila" style={{ gap: 'var(--s-2)' }}>
              {lotes.length > 0 && (
                <button type="button" className="boton" onClick={() => setAbiertos(todosAbiertos ? new Set() : new Set(lotes.map((l) => l.id)))}>
                  {todosAbiertos ? 'Contraer todos' : 'Desplegar todos'}
                </button>
              )}
              {puedeEscribir && (
                <button
                  type="button"
                  className="boton boton--primario"
                  onClick={() => {
                    setErrorLote('');
                    setNuevoLote((n) => n || { codigo: '', expositor: '', contacto: '' });
                  }}
                >
                  <Icono nombre="plus" />
                  Nuevo lote
                </button>
              )}
            </div>
          </div>

          {puedeEscribir && nuevoLote && (
            <form style={{ padding: 'var(--s-4) var(--s-5)', background: 'var(--c-superficie-2)', borderBottom: '1px solid var(--c-borde)' }} onSubmit={crearLote} noValidate>
              <div className="fila" style={{ alignItems: 'flex-end', gap: 'var(--s-3)' }}>
                <div className="campo" style={{ width: 190 }}>
                  <label htmlFor={`${idf}-nl-codigo`}>
                    Código de lote <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
                  </label>
                  <input id={`${idf}-nl-codigo`} placeholder="Ej.: A-12" autoFocus required value={nuevoLote.codigo} onChange={(e) => setNuevoLote({ ...nuevoLote, codigo: e.target.value })} />
                </div>
                <div className="campo" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor={`${idf}-nl-expositor`}>
                    Expositor <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                  </label>
                  <input id={`${idf}-nl-expositor`} value={nuevoLote.expositor} onChange={(e) => setNuevoLote({ ...nuevoLote, expositor: e.target.value })} />
                </div>
                <div className="campo" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor={`${idf}-nl-contacto`}>
                    Contacto <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                  </label>
                  <input id={`${idf}-nl-contacto`} value={nuevoLote.contacto} onChange={(e) => setNuevoLote({ ...nuevoLote, contacto: e.target.value })} />
                </div>
                <button type="submit" className="boton boton--primario" disabled={!nuevoLote.codigo.trim()}>
                  Crear lote
                </button>
                <button type="button" className="boton" onClick={() => setNuevoLote(null)}>
                  Cancelar
                </button>
              </div>
              {errorLote && (
                <p className="mensaje mensaje--error" style={{ marginTop: 8 }} role="alert">
                  <Icono nombre="warn" />
                  <span>{errorLote}</span>
                </p>
              )}
            </form>
          )}

          {lotes.length === 0 ? (
            <div className="vacio">
              <span className="icono-vacio">
                <Icono nombre="building" className="icono--lg" />
              </span>
              <h3>Todavía no hay lotes en este evento</h3>
              <p>{puedeEscribir ? 'Creá un lote para cada stand y cargá sus presupuestos.' : 'Cuando se creen lotes, van a aparecer acá.'}</p>
            </div>
          ) : (
            <div>
              {lotes.map((lote) => (
                <LoteFila
                  key={lote.id}
                  lote={lote}
                  eventoId={evento.id}
                  abierto={abiertos.has(lote.id)}
                  onAlternar={() => alternarLote(lote.id)}
                  onAbrirPresupuesto={(presupuesto) => setPresupuestoAbierto({ id: presupuesto.id, resumen: { evento_nombre: evento.nombre, lote_codigo: lote.codigo, lote_expositor: lote.expositor } })}
                  onCambiado={recargar}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {fusion && (
        <DialogoConfirmar
          titulo="Unificar con otro evento"
          textoConfirmar={fusion.trabajando ? 'Unificando…' : 'Unificar eventos'}
          peligro
          ancho={560}
          foco="primero"
          confirmarDeshabilitado={!fusion.otroEventoId || fusion.trabajando}
          onConfirmar={unificarEventos}
          onCancelar={() => !fusion.trabajando && setFusion(null)}
        >
          <div className="pila">
            <p>
              Elegí el evento duplicado. Sus lotes y presupuestos pasan a <strong>{evento.nombre}</strong> y el evento elegido se borra.
            </p>
            <div className="aviso aviso--aviso">
              <Icono nombre="warn" />
              <div className="aviso-cuerpo">
                <strong>No se puede deshacer.</strong> Los próximos Excel que digan el nombre del evento borrado van a caer en este evento.
              </div>
            </div>
            {/* El buscador va al final y con lugar debajo: su lista de resultados se abre hacia abajo sin tapar nada */}
            <div className="campo" style={{ minHeight: 250 }}>
              <label htmlFor={`${idf}-unificar`}>Evento duplicado</label>
              <div className="entrada-icono">
                <Icono nombre="search" />
                <BuscadorEvento
                  id={`${idf}-unificar`}
                  eventos={eventos.filter((e) => e.id !== evento.id)}
                  value={fusion.otroEventoId}
                  onChange={(otroEventoId) => setFusion((f) => ({ ...f, otroEventoId }))}
                  placeholder="Buscar evento duplicado…"
                />
              </div>
            </div>
            {fusion.error && (
              <p className="mensaje mensaje--error" role="alert">
                <Icono nombre="warn" />
                <span>{fusion.error}</span>
              </p>
            )}
          </div>
        </DialogoConfirmar>
      )}

      {presupuestoAbierto && (
        <PresupuestoPanelLateral
          presupuestoId={presupuestoAbierto.id}
          resumen={presupuestoAbierto.resumen}
          productos={productos}
          onClose={() => setPresupuestoAbierto(null)}
          onCambiado={recargar}
          onGuardado={recargar}
        />
      )}
    </div>
  );
}
