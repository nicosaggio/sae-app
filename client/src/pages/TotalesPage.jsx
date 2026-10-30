import { useEffect, useId, useState } from 'react';
import { api } from '../api/client';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { FacturacionAnual } from '../components/FacturacionAnual';
import { Icono } from '../components/Icono';
import { InformeFacturacionEvento } from '../components/InformeFacturacionEvento';
import { formatearUnidades } from '../format';

export function TotalesPage() {
  const [modo, setModo] = useState('evento'); // 'evento' | 'anio'
  const [eventos, setEventos] = useState([]);
  const [eventoId, setEventoId] = useState(null);
  const [vista, setVista] = useState('cantidades');
  const [totales, setTotales] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [rubrosExcluidos, setRubrosExcluidos] = useState(new Set());
  const idf = useId();

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
  const urlExport = eventoId ? `/api/eventos/${eventoId}/export/pdf` + (hayFiltro ? `?rubros=${encodeURIComponent(rubrosIncluidos.join(','))}` : '') : null;
  const puedeExportar = vista === 'cantidades' && eventoId && rubrosIncluidos.length > 0;

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Totales</h1>
          <p className="sub">Cantidades para producción y facturación, por evento o de todo el año. Los presupuestos cancelados no cuentan.</p>
        </div>
      </header>

      <div className="pestanas" role="tablist" aria-label="Tipo de totales">
        <button type="button" role="tab" id={`${idf}-tab-evento`} aria-selected={modo === 'evento'} aria-controls={`${idf}-panel-evento`} onClick={() => setModo('evento')}>
          Por evento
        </button>
        <button type="button" role="tab" id={`${idf}-tab-anio`} aria-selected={modo === 'anio'} aria-controls={`${idf}-panel-anio`} onClick={() => setModo('anio')}>
          Facturación de todo el año
        </button>
      </div>

      {modo === 'anio' ? (
        <div role="tabpanel" id={`${idf}-panel-anio`} aria-labelledby={`${idf}-tab-anio`}>
          <FacturacionAnual />
        </div>
      ) : (
        <div role="tabpanel" id={`${idf}-panel-evento`} aria-labelledby={`${idf}-tab-evento`} className="pila pila--grande">
          <section className="tarjeta" aria-label="Evento a consultar">
            <div className="tarjeta-cuerpo fila fila--entre">
              <div className="fila" style={{ alignItems: 'flex-end', gap: 'var(--s-4)' }}>
                <div className="campo" style={{ width: 280 }}>
                  <label htmlFor={`${idf}-evento`}>Evento</label>
                  <div className="entrada-icono">
                    <Icono nombre="search" />
                    <BuscadorEvento id={`${idf}-evento`} eventos={eventos} value={eventoId} onChange={setEventoId} placeholder="Buscar evento…" />
                  </div>
                </div>
                {eventoId && (
                  <div className="segmentado" role="group" aria-label="Qué ver">
                    <button type="button" aria-pressed={vista === 'cantidades'} onClick={() => setVista('cantidades')}>
                      Cantidades
                    </button>
                    <button type="button" aria-pressed={vista === 'facturacion'} onClick={() => setVista('facturacion')}>
                      Facturación (sin IVA)
                    </button>
                  </div>
                )}
              </div>
              {puedeExportar && (
                <a className="boton boton--primario" href={urlExport} target="_blank" rel="noreferrer">
                  <Icono nombre="download" />
                  Exportar PDF{hayFiltro ? ` (${rubrosIncluidos.length} rubro${rubrosIncluidos.length > 1 ? 's' : ''})` : ''}
                </a>
              )}
            </div>
          </section>

          {error && (
            <div className="aviso aviso--error" role="alert">
              <Icono nombre="warn" />
              <div className="aviso-cuerpo">{error}</div>
            </div>
          )}

          {!eventoId ? (
            <section className="tarjeta">
              <div className="vacio">
                <span className="icono-vacio">
                  <Icono nombre="search" className="icono--lg" />
                </span>
                <h3>Elegí un evento para ver sus totales</h3>
                <p>Buscalo por nombre arriba.</p>
              </div>
            </section>
          ) : vista === 'facturacion' ? (
            <InformeFacturacionEvento eventoId={eventoId} />
          ) : cargando || !totales ? (
            <section className="tarjeta" aria-busy="true" aria-label="Cargando">
              <div className="tarjeta-cuerpo pila">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="esqueleto" />
                ))}
              </div>
            </section>
          ) : totales.length === 0 ? (
            <section className="tarjeta">
              <div className="vacio">
                <span className="icono-vacio">
                  <Icono nombre="list" className="icono--lg" />
                </span>
                <h3>Todavía no hay productos cargados en ningún lote</h3>
              </div>
            </section>
          ) : (
            <>
              <section className="tarjeta" aria-labelledby={`${idf}-rubros`}>
                <div className="tarjeta-cuerpo pila" style={{ gap: 'var(--s-3)' }}>
                  <div>
                    <h2 id={`${idf}-rubros`}>Rubros a incluir en el PDF</h2>
                    <p className="sub" style={{ marginTop: 2 }}>
                      Destildá los rubros que no querés imprimir; por defecto se exportan todos.
                    </p>
                  </div>
                  <div className="fichas">
                    {totales.map((grupo) => (
                      <label key={grupo.rubro} className="ficha-check">
                        <input className="solo-lectores" type="checkbox" checked={!rubrosExcluidos.has(grupo.rubro)} onChange={() => alternarRubro(grupo.rubro)} />
                        {!rubrosExcluidos.has(grupo.rubro) && <Icono nombre="check" className="icono--sm" />}
                        {grupo.rubro}
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              {totales.map((grupo) => (
                <section key={grupo.rubro} className="tarjeta" aria-label={grupo.rubro} style={{ opacity: rubrosExcluidos.has(grupo.rubro) ? 0.45 : 1 }}>
                  <div className="tarjeta-cab tarjeta-cab--simple">
                    <h2>{grupo.rubro}</h2>
                    <span className="sub">{formatearUnidades(grupo.subtotal)} {grupo.subtotal === 1 ? 'unidad' : 'unidades'}</span>
                  </div>
                  <div className="tabla-scroll">
                    <table className="tabla tabla--panel">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Código</th>
                          <th className="num">Cantidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.productos.map((p) => (
                          <tr key={p.codigo || p.nombre}>
                            <td>{p.nombre}</td>
                            <td style={{ fontWeight: 600 }}>{p.codigo || '—'}</td>
                            <td className="num">{formatearUnidades(p.cantidad)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Subtotal {grupo.rubro}</td>
                          <td className="num">{formatearUnidades(grupo.subtotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
