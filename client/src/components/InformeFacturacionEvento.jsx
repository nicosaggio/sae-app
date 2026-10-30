import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatearMonto, formatearUnidades, porcentajeDe } from '../format';
import { fechaCorta } from '../catalogoFormat';
import { Icono } from './Icono';

/** El aviso de que un importe es parcial porque a alguna línea le falta el precio. */
function SinPrecio({ lineas }) {
  return lineas > 0 ? <span className="nota-sin-precio"> (falta precio en {lineas})</span> : null;
}

/** Barra proporcional a `parte` sobre `maximo`: se lee de un vistazo cuánto pesa cada fila. */
function Barra({ parte, maximo }) {
  const ancho = maximo > 0 ? Math.max(2, (parte / maximo) * 100) : 0;
  return (
    <div className="barra-valor" aria-hidden="true">
      <i style={{ width: `${ancho}%` }} />
    </div>
  );
}

/** Los productos pedidos con su cantidad y subtotal, en una tabla simple. */
function TablaProductos({ productos, columnaTotal }) {
  return (
    <div className="tabla-scroll">
      <table className="tabla tabla--panel">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Código</th>
            <th className="num">Cantidad</th>
            <th className="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.codigo || p.nombre}>
              <td>{p.nombre}</td>
              <td style={{ fontWeight: 600 }}>{p.codigo || '—'}</td>
              <td className="num">{formatearUnidades(p.cantidad)}</td>
              <td className="num">
                {formatearMonto(p.subtotal)}
                <SinPrecio lineas={p.lineasSinPrecio} />
              </td>
            </tr>
          ))}
        </tbody>
        {columnaTotal && (
          <tfoot>
            <tr>
              <td colSpan={2}>{columnaTotal.titulo}</td>
              <td className="num">{formatearUnidades(columnaTotal.cantidad)}</td>
              <td className="num">{formatearMonto(columnaTotal.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * El informe de facturación de un evento (sin IVA): el total, los totales por rubro y, a elección, el detalle
 * de cada rubro por producto o lo que pidió cada lote. Se puede imprimir en PDF con la vista que se esté viendo.
 */
export function InformeFacturacionEvento({ eventoId }) {
  const [informe, setInforme] = useState(null);
  const [error, setError] = useState('');
  const [vista, setVista] = useState('rubro'); // 'rubro' | 'lote'
  const [abiertos, setAbiertos] = useState(new Set()); // ids de los lotes con sus pedidos desplegados

  useEffect(() => {
    let vigente = true; // si se cambia de evento antes de que llegue la respuesta, la vieja se descarta
    setInforme(null);
    setError('');
    setAbiertos(new Set());
    api
      .get(`/eventos/${eventoId}/facturacion/informe`)
      .then((datos) => vigente && setInforme(datos))
      .catch((err) => vigente && setError(err.message));
    return () => {
      vigente = false;
    };
  }, [eventoId]);

  if (error) {
    return (
      <div className="aviso aviso--error" role="alert">
        <Icono nombre="warn" />
        <div className="aviso-cuerpo">{error}</div>
      </div>
    );
  }
  if (!informe) {
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

  const { evento } = informe;
  const sinDatos = informe.presupuestos === 0;
  const rubrosPorImporte = [...informe.porRubro].sort((a, b) => b.total - a.total || a.rubro.localeCompare(b.rubro, 'es'));
  const mayorRubro = Math.max(0, ...rubrosPorImporte.map((r) => r.total));
  const mayorLote = Math.max(0, ...informe.porLote.map((l) => l.total));
  const todosAbiertos = informe.porLote.length > 0 && abiertos.size === informe.porLote.length;

  function alternarLote(id) {
    setAbiertos((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  return (
    <div className="pila pila--grande">
      <section className="tarjeta tarjeta--tinte">
        <div className="tarjeta-cuerpo fila fila--entre">
          <div>
            <div className="kpi-etiqueta">Facturación del evento (sin IVA)</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>{evento.nombre}</h2>
            <div className="kpi-sub">
              {informe.lotes} {informe.lotes === 1 ? 'lote' : 'lotes'} · {informe.presupuestos} {informe.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}
              {evento.fecha_inicio ? ` · del ${fechaCorta(evento.fecha_inicio)} al ${fechaCorta(evento.fecha_fin || evento.fecha_inicio)}` : ''}
              {evento.lugar ? ` · ${evento.lugar}` : ''}
            </div>
          </div>
          <div className="kpi-valor" style={{ fontSize: 'var(--t-xl)' }}>
            {formatearMonto(informe.total)}
          </div>
        </div>
        {informe.lineasSinPrecio > 0 && (
          <p className="mensaje mensaje--aviso" style={{ padding: '0 var(--s-5) var(--s-4)' }}>
            <Icono nombre="warn" />
            <span>{informe.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.</span>
          </p>
        )}
      </section>

      {sinDatos ? (
        <section className="tarjeta">
          <div className="vacio">
            <span className="icono-vacio">
              <Icono nombre="list" className="icono--lg" />
            </span>
            <h3>Todavía no hay presupuestos cargados en este evento</h3>
          </div>
        </section>
      ) : (
        <>
          <section className="tarjeta" aria-labelledby={`informe-rubros-${evento.id}`}>
            <div className="tarjeta-cab">
              <h2 id={`informe-rubros-${evento.id}`}>Totales por rubro</h2>
            </div>
            <div className="tabla-scroll">
              <table className="tabla tabla--panel">
                <thead>
                  <tr>
                    <th>Rubro</th>
                    <th className="num">Unidades</th>
                    <th className="num">Facturación</th>
                    <th className="num">% del evento</th>
                    <th style={{ width: '22%' }}>
                      <span className="solo-lectores">Proporción</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rubrosPorImporte.map((g) => (
                    <tr key={g.rubro}>
                      <td>
                        <span className="etiqueta">{g.rubro}</span>
                      </td>
                      <td className="num">{formatearUnidades(g.cantidad)}</td>
                      <td className="num">
                        {formatearMonto(g.total)}
                        <SinPrecio lineas={g.lineasSinPrecio} />
                      </td>
                      <td className="num">{porcentajeDe(g.total, informe.total)}</td>
                      <td>
                        <Barra parte={g.total} maximo={mayorRubro} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total del evento</td>
                    <td className="num">{formatearUnidades(rubrosPorImporte.reduce((suma, g) => suma + g.cantidad, 0))}</td>
                    <td className="num">{formatearMonto(informe.total)}</td>
                    <td className="num">100,0 %</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="fila fila--entre">
            <div className="segmentado" role="group" aria-label="Vista del informe">
              <button type="button" aria-pressed={vista === 'rubro'} onClick={() => setVista('rubro')}>
                Detalle por rubro
              </button>
              <button type="button" aria-pressed={vista === 'lote'} onClick={() => setVista('lote')}>
                Pedidos por lote
              </button>
            </div>
            <div className="fila" style={{ gap: 'var(--s-2)' }}>
              {vista === 'lote' && (
                <button type="button" className="boton" onClick={() => setAbiertos(todosAbiertos ? new Set() : new Set(informe.porLote.map((l) => l.id)))}>
                  {todosAbiertos ? 'Contraer todos' : 'Desplegar todos'}
                </button>
              )}
              <a className="boton boton--primario" href={`/api/eventos/${evento.id}/facturacion/pdf?vista=${vista}`} target="_blank" rel="noreferrer">
                <Icono nombre="download" />
                Imprimir informe (PDF)
              </a>
            </div>
          </div>

          {vista === 'rubro' ? (
            <div className="pila pila--grande">
              <p className="sub">Precio unitario tal como figura en el presupuesto de cada línea (columna VALOR UNITARIO del Excel), sin IVA.</p>
              {informe.porRubro.map((g) => (
                <section key={g.rubro} className="tarjeta" aria-label={g.rubro}>
                  <div className="tarjeta-cab tarjeta-cab--simple">
                    <h2>{g.rubro}</h2>
                  </div>
                  <TablaProductos productos={g.productos} columnaTotal={{ titulo: `Total ${g.rubro}`, cantidad: g.cantidad, total: g.total }} />
                  {g.lineasSinPrecio > 0 && (
                    <p className="mensaje mensaje--aviso" style={{ padding: 'var(--s-3) var(--s-5)' }}>
                      <Icono nombre="warn" />
                      <span>{g.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.</span>
                    </p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <section className="tarjeta" aria-label="Pedidos por lote">
              <div className="tarjeta-cab tarjeta-cab--simple">
                <span className="sub">Tocá un lote para ver lo que pidió.</span>
              </div>
              <div className="tabla-scroll">
                <table className="tabla tabla--clic">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Expositor</th>
                      <th className="num">Presupuestos</th>
                      <th className="num">Facturación</th>
                      <th className="num">% del evento</th>
                      <th style={{ width: '16%' }}>
                        <span className="solo-lectores">Proporción</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {informe.porLote.map((l) => {
                      const abierto = abiertos.has(l.id);
                      return (
                        <Fragment key={l.id}>
                          <tr
                            role="button"
                            tabIndex={0}
                            aria-expanded={abierto}
                            onClick={() => alternarLote(l.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                alternarLote(l.id);
                              }
                            }}
                          >
                            <td className="codigo nw">
                              <Icono nombre="chev-r" className="chevron icono--sm" /> {l.codigo}
                            </td>
                            <td>{l.expositor || '—'}</td>
                            <td className="num">{l.presupuestos}</td>
                            <td className="num">
                              {formatearMonto(l.total)}
                              <SinPrecio lineas={l.lineasSinPrecio} />
                            </td>
                            <td className="num">{porcentajeDe(l.total, informe.total)}</td>
                            <td>
                              <Barra parte={l.total} maximo={mayorLote} />
                            </td>
                          </tr>
                          {abierto && (
                            <tr className="fila-detalle">
                              <td colSpan={6}>
                                {l.productos.length === 0 ? <span className="sub">Todavía no tiene ítems cargados.</span> : <TablaProductos productos={l.productos} />}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total del evento</td>
                      <td className="num">{informe.presupuestos}</td>
                      <td className="num">{formatearMonto(informe.total)}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
