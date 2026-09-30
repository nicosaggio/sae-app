import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { formatearMonto } from '../format';

export function TotalesPage() {
  const [eventos, setEventos] = useState([]);
  const [eventoId, setEventoId] = useState(null);
  const [vista, setVista] = useState('cantidades');
  const [totales, setTotales] = useState(null);
  const [facturacion, setFacturacion] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [rubrosExcluidos, setRubrosExcluidos] = useState(new Set());

  useEffect(() => {
    api
      .get('/eventos')
      .then(setEventos)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setRubrosExcluidos(new Set());
    if (!eventoId) {
      setTotales(null);
      setFacturacion(null);
      return;
    }
    setCargando(true);
    setError('');
    Promise.all([api.get(`/eventos/${eventoId}/totales`), api.get(`/eventos/${eventoId}/facturacion`)])
      .then(([t, f]) => {
        setTotales(t);
        setFacturacion(f);
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [eventoId]);

  const evento = eventos.find((e) => e.id === eventoId);

  function alternarRubro(rubro) {
    setRubrosExcluidos((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(rubro)) nuevo.delete(rubro);
      else nuevo.add(rubro);
      return nuevo;
    });
  }

  const rubrosIncluidos = totales ? totales.map((t) => t.rubro).filter((r) => !rubrosExcluidos.has(r)) : [];
  const hayFiltro = totales && rubrosIncluidos.length !== totales.length;
  const urlExport = eventoId
    ? `/api/eventos/${eventoId}/export/pdf` + (hayFiltro ? `?rubros=${encodeURIComponent(rubrosIncluidos.join(','))}` : '')
    : null;

  return (
    <div>
      <h2>Totales por evento</h2>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <BuscadorEvento eventos={eventos} value={eventoId} onChange={setEventoId} />
          {eventoId && (
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className={vista === 'cantidades' ? 'primario' : ''}
                onClick={() => setVista('cantidades')}
              >
                Cantidades
              </button>
              <button
                type="button"
                className={vista === 'facturacion' ? 'primario' : ''}
                onClick={() => setVista('facturacion')}
              >
                Facturación (sin IVA)
              </button>
            </div>
          )}
          {vista === 'cantidades' && eventoId && rubrosIncluidos.length > 0 && (
            <a href={urlExport} target="_blank" rel="noreferrer">
              <button type="button" className="primario">
                Exportar PDF{hayFiltro ? ` (${rubrosIncluidos.length} rubro${rubrosIncluidos.length > 1 ? 's' : ''})` : ''}
              </button>
            </a>
          )}
        </div>
      </div>

      {error && <div className="aviso error">{error}</div>}

      {!eventoId ? (
        <p className="texto-suave">Elegí un evento para ver sus totales.</p>
      ) : cargando || !totales || !facturacion ? (
        <p className="texto-suave">Cargando…</p>
      ) : vista === 'cantidades' ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{evento?.nombre}</h3>
          {totales.length === 0 ? (
            <p className="texto-suave">Todavía no hay productos cargados en ningún lote.</p>
          ) : (
            <>
              <p className="texto-suave" style={{ marginTop: 0 }}>
                Destildá los rubros que no querés incluir en el PDF (por defecto se exportan todos).
              </p>
              <div className="toolbar" style={{ marginBottom: 16 }}>
                {totales.map((grupo) => (
                  <label key={grupo.rubro} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={!rubrosExcluidos.has(grupo.rubro)}
                      onChange={() => alternarRubro(grupo.rubro)}
                    />
                    {grupo.rubro}
                  </label>
                ))}
              </div>
              {totales.map((grupo) => (
                <div key={grupo.rubro} style={{ marginBottom: 12, opacity: rubrosExcluidos.has(grupo.rubro) ? 0.4 : 1 }}>
                  <strong>{grupo.rubro}</strong>
                  <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Código</th>
                        <th>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.productos.map((p) => (
                        <tr key={p.codigo || p.nombre}>
                          <td>{p.nombre}</td>
                          <td>{p.codigo || '—'}</td>
                          <td>{p.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  <p className="texto-suave">
                    Subtotal {grupo.rubro}: {grupo.subtotal} unidades
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{evento?.nombre}</h3>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Precio unitario tal como figura en el presupuesto de cada línea (columna VALOR UNITARIO del Excel), sin
            IVA.
          </p>
          {facturacion.length === 0 ? (
            <p className="texto-suave">Todavía no hay productos cargados en ningún lote.</p>
          ) : (
            <>
              {facturacion.map((grupo) => (
                <div key={grupo.rubro} style={{ marginBottom: 12 }}>
                  <strong>{grupo.rubro}</strong>
                  <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Código</th>
                        <th>Cantidad</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.productos.map((p) => (
                        <tr key={p.codigo || p.nombre}>
                          <td>{p.nombre}</td>
                          <td>{p.codigo || '—'}</td>
                          <td>{p.cantidad}</td>
                          <td>
                            {formatearMonto(p.subtotal)}
                            {p.lineasSinPrecio > 0 && (
                              <span className="texto-suave"> (falta precio en {p.lineasSinPrecio})</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>Total {grupo.rubro}</td>
                        <td>{formatearMonto(grupo.subtotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                  {grupo.lineasSinPrecio > 0 && (
                    <p className="texto-suave" style={{ marginTop: 4 }}>
                      {grupo.lineasSinPrecio} línea(s) sin precio cargado, no incluidas en el total.
                    </p>
                  )}
                </div>
              ))}
              <div className="card" style={{ background: 'var(--color-primario-claro)', marginBottom: 0 }}>
                <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
                  <strong>Total del evento (sin IVA)</strong>
                  <strong style={{ fontSize: 18 }}>
                    {formatearMonto(facturacion.reduce((acc, g) => acc + g.subtotal, 0))}
                  </strong>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
