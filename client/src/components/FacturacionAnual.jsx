import { useEffect, useId, useState } from 'react';
import { api } from '../api/client';
import { formatearMonto, formatearUnidades, porcentajeDe } from '../format';
import { fechaCorta } from '../catalogoFormat';
import { BuscadorEvento } from './BuscadorEvento';
import { Icono } from './Icono';
import { InformeFacturacionEvento } from './InformeFacturacionEvento';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Barra proporcional a `parte` sobre `maximo`, para recorrer el año de un vistazo. */
function Barra({ parte, maximo }) {
  const ancho = maximo > 0 ? Math.max(0, (parte / maximo) * 100) : 0;
  return (
    <div className="barra-valor" aria-hidden="true">
      <i style={{ width: `${ancho}%` }} />
    </div>
  );
}

/** Al elegir un evento de una lista larga, vuelve arriba para ver su informe y no la mitad de la página. */
function irArriba() {
  window.scrollTo({ top: 0 });
  document.querySelector('main')?.scrollTo?.({ top: 0 });
}

/**
 * Facturación (sin IVA) de todo un año, que se puede filtrar por mes y por evento: el total y cómo se reparte por
 * mes, rubro y evento, con el botón para imprimir el informe. Con un evento elegido muestra el informe de ese evento
 * (sus totales por rubro y sus pedidos por lote). No se muestra el desglose por estado de cobro: los estados de los
 * presupuestos viejos no están al día y esa información no sería correcta.
 */
export function FacturacionAnual() {
  const [anio, setAnio] = useState(null); // null: el año que elija el servidor (el actual, o el último con datos)
  const [mes, setMes] = useState(null); // null: todo el año
  const [eventoId, setEventoId] = useState(null);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const idf = useId();

  useEffect(() => {
    let vigente = true; // si se cambia de filtro antes de que llegue la respuesta, la vieja se descarta
    setCargando(true);
    setError('');
    const consulta = new URLSearchParams();
    if (anio) consulta.set('anio', anio);
    if (mes) consulta.set('mes', mes);
    const texto = consulta.toString();
    api
      .get(`/eventos/facturacion-anual${texto ? `?${texto}` : ''}`)
      .then((d) => vigente && setDatos(d))
      .catch((err) => vigente && setError(err.message))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [anio, mes]);

  if (error) {
    return (
      <div className="aviso aviso--error" role="alert">
        <Icono nombre="warn" />
        <div className="aviso-cuerpo">{error}</div>
      </div>
    );
  }
  if (!datos) {
    return (
      <div className="tarjeta" aria-busy="true" aria-label="Cargando">
        <div className="tarjeta-cuerpo pila">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="esqueleto" />
          ))}
        </div>
      </div>
    );
  }

  const anios = datos.anios.includes(datos.anio) ? datos.anios : [datos.anio, ...datos.anios];
  const mayorMes = Math.max(0, ...datos.porMes.map((m) => m.total));
  const sinDatos = datos.presupuestos === 0;
  const periodo = datos.mes ? `${MESES[datos.mes - 1]} ${datos.anio}` : String(datos.anio);
  const parteDe = datos.mes ? 'mes' : 'año';
  const urlPdf = `/api/eventos/facturacion-anual/pdf?anio=${datos.anio}${datos.mes ? `&mes=${datos.mes}` : ''}`;

  // El evento elegido pertenece a un año y mes: al cambiar cualquiera de los dos se deja de filtrar por evento.
  function elegirAnio(nuevo) {
    setAnio(nuevo);
    setEventoId(null);
  }
  function elegirMes(nuevo) {
    setMes(nuevo);
    setEventoId(null);
  }
  function elegirEvento(id) {
    setEventoId(id);
    if (id) irArriba();
  }

  return (
    <div className="pila pila--grande" style={{ opacity: cargando ? 0.6 : 1 }}>
      <section className="tarjeta" aria-label="Filtros del año">
        <div className="tarjeta-cuerpo pila" style={{ gap: 'var(--s-3)' }}>
          <div className="fila fila--entre">
            <div className="fila" style={{ alignItems: 'flex-end', gap: 'var(--s-4)' }}>
              <div className="campo" style={{ width: 120 }}>
                <label htmlFor={`${idf}-anio`}>Año</label>
                <select id={`${idf}-anio`} value={datos.anio} onChange={(e) => elegirAnio(Number(e.target.value))}>
                  {anios.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo" style={{ width: 180 }}>
                <label htmlFor={`${idf}-mes`}>Mes</label>
                <select id={`${idf}-mes`} value={datos.mes || ''} onChange={(e) => elegirMes(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Todo el año</option>
                  {MESES.map((nombre, i) => (
                    <option key={nombre} value={i + 1}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo" style={{ width: 260 }}>
                <label htmlFor={`${idf}-evento`}>Evento</label>
                <BuscadorEvento id={`${idf}-evento`} eventos={datos.porEvento} value={eventoId} onChange={elegirEvento} placeholder="Todos los eventos" />
              </div>
              {eventoId && (
                <button type="button" className="boton" onClick={() => setEventoId(null)}>
                  Ver todos los eventos
                </button>
              )}
            </div>
            {!eventoId && !sinDatos && (
              <a className="boton boton--primario" href={urlPdf} target="_blank" rel="noreferrer">
                <Icono nombre="download" />
                Imprimir informe (PDF)
              </a>
            )}
          </div>
          <p className="sub">Eventos que empiezan en {datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio}, con todos sus presupuestos.</p>
        </div>
      </section>

      {eventoId ? (
        <InformeFacturacionEvento eventoId={eventoId} />
      ) : (
        <>
          <section className="tarjeta tarjeta--tinte">
            <div className="tarjeta-cuerpo fila fila--entre">
              <div>
                <div className="kpi-etiqueta">Facturación de {periodo} (sin IVA)</div>
                <div className="kpi-sub" style={{ marginTop: 2 }}>
                  {datos.eventos} {datos.eventos === 1 ? 'evento' : 'eventos'} · {datos.presupuestos} {datos.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}
                </div>
              </div>
              <div className="kpi-valor">{formatearMonto(datos.total)}</div>
            </div>
            {datos.lineasSinPrecio > 0 && (
              <p className="mensaje mensaje--aviso" style={{ padding: '0 var(--s-5) var(--s-4)' }}>
                <Icono nombre="warn" />
                <span>{datos.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.</span>
              </p>
            )}
          </section>

          {sinDatos ? (
            <section className="tarjeta">
              <div className="vacio">
                <span className="icono-vacio">
                  <Icono nombre="list" className="icono--lg" />
                </span>
                <h3>No hay presupuestos cargados en eventos de {datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio}</h3>
              </div>
            </section>
          ) : (
            <>
              {!datos.mes && (
                <section className="tarjeta" aria-labelledby={`${idf}-por-mes`}>
                  <div className="tarjeta-cab">
                    <div>
                      <h2 id={`${idf}-por-mes`}>Por mes</h2>
                      <p className="sub">Según el mes en que empieza cada evento.</p>
                    </div>
                  </div>
                  <div className="tabla-scroll">
                    <table className="tabla tabla--panel">
                      <thead>
                        <tr>
                          <th>Mes</th>
                          <th className="num">Eventos</th>
                          <th className="num">Facturación</th>
                          <th className="num">% del año</th>
                          <th style={{ width: '30%' }}>
                            <span className="solo-lectores">Proporción</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {datos.porMes.map((m) => (
                          <tr key={m.mes} style={{ opacity: m.eventos === 0 ? 0.5 : 1 }}>
                            <td>{MESES[m.mes - 1]}</td>
                            <td className="num">{m.eventos || '—'}</td>
                            <td className="num">{m.eventos ? formatearMonto(m.total) : '—'}</td>
                            <td className="num">{m.eventos ? porcentajeDe(m.total, datos.total) : '—'}</td>
                            <td>
                              <Barra parte={m.total} maximo={mayorMes} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Total {datos.anio}</td>
                          <td className="num">{datos.eventos}</td>
                          <td className="num">{formatearMonto(datos.total)}</td>
                          <td />
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}

              <section className="tarjeta" aria-labelledby={`${idf}-por-rubro`}>
                <div className="tarjeta-cab tarjeta-cab--simple">
                  <h2 id={`${idf}-por-rubro`}>Por rubro</h2>
                </div>
                <div className="tabla-scroll">
                  <table className="tabla tabla--panel">
                    <thead>
                      <tr>
                        <th>Rubro</th>
                        <th className="num">Unidades</th>
                        <th className="num">Facturación</th>
                        <th className="num">% del {parteDe}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.porRubro.map((g) => (
                        <tr key={g.rubro}>
                          <td>
                            <span className="etiqueta">{g.rubro}</span>
                          </td>
                          <td className="num">{formatearUnidades(g.cantidad)}</td>
                          <td className="num">{formatearMonto(g.total)}</td>
                          <td className="num">{porcentajeDe(g.total, datos.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="tarjeta" aria-labelledby={`${idf}-por-evento`}>
                <div className="tarjeta-cab">
                  <div>
                    <h2 id={`${idf}-por-evento`}>Por evento</h2>
                    <p className="sub">Tocá un evento para ver su informe: totales por rubro y pedidos por lote.</p>
                  </div>
                </div>
                <div className="tabla-scroll">
                  <table className="tabla tabla--clic">
                    <thead>
                      <tr>
                        <th>Evento</th>
                        <th>Inicio</th>
                        <th className="num">Presupuestos</th>
                        <th className="num">Facturación</th>
                        <th className="num">% del {parteDe}</th>
                        <th>
                          <span className="solo-lectores">Abrir</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.porEvento.map((e) => (
                        <tr
                          key={e.id}
                          tabIndex={0}
                          onClick={() => elegirEvento(e.id)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              elegirEvento(e.id);
                            }
                          }}
                        >
                          <td>
                            <strong style={{ fontWeight: 600 }}>{e.nombre}</strong>
                          </td>
                          <td className="nw">{fechaCorta(e.fecha_inicio)}</td>
                          <td className="num">{e.presupuestos}</td>
                          <td className="num">
                            {formatearMonto(e.total)}
                            {e.lineasSinPrecio > 0 && <span className="nota-sin-precio"> (falta precio en {e.lineasSinPrecio})</span>}
                          </td>
                          <td className="num">{porcentajeDe(e.total, datos.total)}</td>
                          <td className="chev">
                            <Icono nombre="chev-r" className="icono--sm" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
