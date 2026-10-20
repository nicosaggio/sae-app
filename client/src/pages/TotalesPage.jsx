import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { FacturacionAnual } from '../components/FacturacionAnual';
import { InformeFacturacionEvento } from '../components/InformeFacturacionEvento';

export function TotalesPage() {
  const [modo, setModo] = useState('evento'); // 'evento' | 'anio'
  const [eventos, setEventos] = useState([]);
  const [eventoId, setEventoId] = useState(null);
  const [vista, setVista] = useState('cantidades');
  const [totales, setTotales] = useState(null);
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
      return;
    }
    setCargando(true);
    setError('');
    api
      .get(`/eventos/${eventoId}/totales`)
      .then(setTotales)
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
      <h2>Totales</h2>

      <div className="toolbar">
        <button type="button" className={modo === 'evento' ? 'primario' : ''} onClick={() => setModo('evento')}>
          Por evento
        </button>
        <button type="button" className={modo === 'anio' ? 'primario' : ''} onClick={() => setModo('anio')}>
          Facturación de todo el año
        </button>
      </div>

      {modo === 'anio' ? (
        <FacturacionAnual />
      ) : (
        <>
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
      ) : vista === 'facturacion' ? (
        <InformeFacturacionEvento eventoId={eventoId} />
      ) : cargando || !totales ? (
        <p className="texto-suave">Cargando…</p>
      ) : (
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
      )}
        </>
      )}
    </div>
  );
}
