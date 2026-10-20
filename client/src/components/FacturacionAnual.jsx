import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatearMonto, formatearUnidades, porcentajeDe } from '../format';
import { fechaCorta } from '../catalogoFormat';
import { BuscadorEvento } from './BuscadorEvento';
import { InformeFacturacionEvento } from './InformeFacturacionEvento';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Barra proporcional a `parte` sobre `maximo`, para recorrer el año de un vistazo. */
function Barra({ parte, maximo }) {
  const ancho = maximo > 0 ? Math.max(0, (parte / maximo) * 100) : 0;
  return (
    <div style={{ background: 'var(--color-gris-fondo)', borderRadius: 4, height: 8, minWidth: 80 }}>
      <div style={{ width: `${ancho}%`, height: '100%', borderRadius: 4, background: 'var(--color-primario)' }} />
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

  if (error) return <div className="aviso error">{error}</div>;
  if (!datos) return <p className="texto-suave">Cargando…</p>;

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
    <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="campo" style={{ width: 140 }}>
            <label>Año</label>
            <select value={datos.anio} onChange={(e) => elegirAnio(Number(e.target.value))}>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="campo" style={{ width: 180 }}>
            <label>Mes</label>
            <select value={datos.mes || ''} onChange={(e) => elegirMes(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todo el año</option>
              {MESES.map((nombre, i) => (
                <option key={nombre} value={i + 1}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Evento</label>
            <BuscadorEvento eventos={datos.porEvento} value={eventoId} onChange={elegirEvento} placeholder="Todos los eventos" />
          </div>
          {eventoId && (
            <button type="button" onClick={() => setEventoId(null)}>
              Ver todos los eventos
            </button>
          )}
          {!eventoId && !sinDatos && (
            <a href={urlPdf} target="_blank" rel="noreferrer">
              <button type="button" className="primario">
                Imprimir informe (PDF)
              </button>
            </a>
          )}
        </div>
        <p className="texto-suave" style={{ marginBottom: 0 }}>
          Eventos que empiezan en {datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio}, con todos sus presupuestos.
        </p>
      </div>

      {eventoId ? (
        <InformeFacturacionEvento eventoId={eventoId} />
      ) : (
        <>
          <div className="card" style={{ background: 'var(--color-primario-claro)' }}>
            <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
              <div>
                <strong>Facturación de {periodo} (sin IVA)</strong>
                <div className="texto-suave">
                  {datos.eventos} {datos.eventos === 1 ? 'evento' : 'eventos'} · {datos.presupuestos} {datos.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}
                </div>
              </div>
              <strong style={{ fontSize: 24 }}>{formatearMonto(datos.total)}</strong>
            </div>
            {datos.lineasSinPrecio > 0 && (
              <p className="texto-suave" style={{ marginBottom: 0 }}>
                {datos.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.
              </p>
            )}
          </div>

          {sinDatos ? (
            <p className="texto-suave">No hay presupuestos cargados en eventos de {datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio}.</p>
          ) : (
            <>
              {!datos.mes && (
                <div className="card">
                  <h3 style={{ marginTop: 0 }}>Por mes</h3>
                  <p className="texto-suave" style={{ marginTop: 0 }}>
                    Según el mes en que empieza cada evento.
                  </p>
                  <div className="tabla-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Mes</th>
                          <th className="num">Eventos</th>
                          <th className="num">Facturación</th>
                          <th className="num">% del año</th>
                          <th style={{ width: '30%' }} />
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
                </div>
              )}

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Por rubro</h3>
                <div className="tabla-scroll">
                  <table>
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
                          <td>{g.rubro}</td>
                          <td className="num">{formatearUnidades(g.cantidad)}</td>
                          <td className="num">{formatearMonto(g.total)}</td>
                          <td className="num">{porcentajeDe(g.total, datos.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Por evento</h3>
                <p className="texto-suave" style={{ marginTop: 0 }}>
                  Tocá un evento para ver su informe: totales por rubro y pedidos por lote.
                </p>
                <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Evento</th>
                        <th>Inicio</th>
                        <th className="num">Presupuestos</th>
                        <th className="num">Facturación</th>
                        <th className="num">% del {parteDe}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.porEvento.map((e) => (
                        <tr key={e.id} onClick={() => elegirEvento(e.id)} style={{ cursor: 'pointer' }}>
                          <td>{e.nombre}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fechaCorta(e.fecha_inicio)}</td>
                          <td className="num">{e.presupuestos}</td>
                          <td className="num">
                            {formatearMonto(e.total)}
                            {e.lineasSinPrecio > 0 && <span className="texto-suave"> (falta precio en {e.lineasSinPrecio})</span>}
                          </td>
                          <td className="num">{porcentajeDe(e.total, datos.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
