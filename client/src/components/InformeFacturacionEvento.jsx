import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatearMonto, formatearUnidades, porcentajeDe } from '../format';
import { fechaCorta } from '../catalogoFormat';

/** El aviso de que un importe es parcial porque a alguna línea le falta el precio. */
function SinPrecio({ lineas }) {
  return lineas > 0 ? <span className="texto-suave"> (falta precio en {lineas})</span> : null;
}

/** Los productos pedidos con su cantidad y subtotal, en una tabla simple. */
function TablaProductos({ productos, columnaTotal }) {
  return (
    <div className="tabla-scroll">
      <table>
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
              <td>{p.codigo || '—'}</td>
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

  if (error) return <div className="aviso error">{error}</div>;
  if (!informe) return <p className="texto-suave">Cargando…</p>;

  const { evento } = informe;
  const sinDatos = informe.presupuestos === 0;
  const rubrosPorImporte = [...informe.porRubro].sort((a, b) => b.total - a.total || a.rubro.localeCompare(b.rubro, 'es'));
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
    <div>
      <div className="card" style={{ background: 'var(--color-primario-claro)' }}>
        <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <div>
            <strong>{evento.nombre} (sin IVA)</strong>
            <div className="texto-suave">
              {informe.lotes} {informe.lotes === 1 ? 'lote' : 'lotes'} · {informe.presupuestos} {informe.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}
              {evento.fecha_inicio ? ` · del ${fechaCorta(evento.fecha_inicio)} al ${fechaCorta(evento.fecha_fin || evento.fecha_inicio)}` : ''}
              {evento.lugar ? ` · ${evento.lugar}` : ''}
            </div>
          </div>
          <strong style={{ fontSize: 24 }}>{formatearMonto(informe.total)}</strong>
        </div>
        {informe.lineasSinPrecio > 0 && (
          <p className="texto-suave" style={{ marginBottom: 0 }}>
            {informe.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.
          </p>
        )}
      </div>

      {sinDatos ? (
        <p className="texto-suave">Todavía no hay presupuestos cargados en este evento.</p>
      ) : (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Totales por rubro</h3>
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rubro</th>
                    <th className="num">Unidades</th>
                    <th className="num">Facturación</th>
                    <th className="num">% del evento</th>
                  </tr>
                </thead>
                <tbody>
                  {rubrosPorImporte.map((g) => (
                    <tr key={g.rubro}>
                      <td>{g.rubro}</td>
                      <td className="num">{formatearUnidades(g.cantidad)}</td>
                      <td className="num">
                        {formatearMonto(g.total)}
                        <SinPrecio lineas={g.lineasSinPrecio} />
                      </td>
                      <td className="num">{porcentajeDe(g.total, informe.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total del evento</td>
                    <td />
                    <td className="num">{formatearMonto(informe.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button type="button" className={vista === 'rubro' ? 'primario' : ''} onClick={() => setVista('rubro')}>
                Detalle por rubro
              </button>
              <button type="button" className={vista === 'lote' ? 'primario' : ''} onClick={() => setVista('lote')}>
                Pedidos por lote
              </button>
              <a href={`/api/eventos/${evento.id}/facturacion/pdf?vista=${vista}`} target="_blank" rel="noreferrer">
                <button type="button" className="primario">
                  Imprimir informe (PDF)
                </button>
              </a>
            </div>
          </div>

          {vista === 'rubro' ? (
            <div className="card">
              <p className="texto-suave" style={{ marginTop: 0 }}>
                Precio unitario tal como figura en el presupuesto de cada línea (columna VALOR UNITARIO del Excel), sin IVA.
              </p>
              {informe.porRubro.map((g) => (
                <div key={g.rubro} style={{ marginBottom: 12 }}>
                  <strong>{g.rubro}</strong>
                  <TablaProductos productos={g.productos} columnaTotal={{ titulo: `Total ${g.rubro}`, cantidad: g.cantidad, total: g.total }} />
                  {g.lineasSinPrecio > 0 && (
                    <p className="texto-suave" style={{ marginTop: 4 }}>
                      {g.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                <span className="texto-suave">Tocá un lote para ver lo que pidió.</span>
                <button type="button" onClick={() => setAbiertos(todosAbiertos ? new Set() : new Set(informe.porLote.map((l) => l.id)))}>
                  {todosAbiertos ? 'Contraer todos' : 'Desplegar todos'}
                </button>
              </div>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Expositor</th>
                      <th className="num">Presupuestos</th>
                      <th className="num">Facturación</th>
                      <th className="num">% del evento</th>
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
                            style={{ cursor: 'pointer' }}
                            onClick={() => alternarLote(l.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                alternarLote(l.id);
                              }
                            }}
                          >
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {abierto ? '▾' : '▸'} {l.codigo}
                            </td>
                            <td>{l.expositor || '—'}</td>
                            <td className="num">{l.presupuestos}</td>
                            <td className="num">
                              {formatearMonto(l.total)}
                              <SinPrecio lineas={l.lineasSinPrecio} />
                            </td>
                            <td className="num">{porcentajeDe(l.total, informe.total)}</td>
                          </tr>
                          {abierto && (
                            <tr>
                              <td colSpan={5} style={{ background: 'var(--color-gris-fondo)' }}>
                                {l.productos.length === 0 ? (
                                  <span className="texto-suave">Todavía no tiene ítems cargados.</span>
                                ) : (
                                  <TablaProductos productos={l.productos} />
                                )}
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
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
