import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { etiquetaEstadoPresupuesto } from '../constants';
import { formatearMonto } from '../format';
import { fechaCorta } from '../catalogoFormat';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const formatoUnidades = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

const porcentaje = (parte, total) => (total > 0 ? `${((parte / total) * 100).toFixed(1).replace('.', ',')} %` : '—');

/** Barra proporcional a `parte` sobre `maximo`, para recorrer el año de un vistazo. */
function Barra({ parte, maximo }) {
  const ancho = maximo > 0 ? Math.max(0, (parte / maximo) * 100) : 0;
  return (
    <div style={{ background: 'var(--color-gris-fondo)', borderRadius: 4, height: 8, minWidth: 80 }}>
      <div style={{ width: `${ancho}%`, height: '100%', borderRadius: 4, background: 'var(--color-primario)' }} />
    </div>
  );
}

/**
 * Facturación (sin IVA) de todo un año: el total y cómo se reparte por mes, estado de cobro, rubro y evento.
 * `onVerEvento(id)` abre la facturación de ese evento en la vista "Por evento".
 */
export function FacturacionAnual({ onVerEvento }) {
  const [anio, setAnio] = useState(null); // null: el año que elija el servidor (el actual, o el último con datos)
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setCargando(true);
    setError('');
    api
      .get(`/eventos/facturacion-anual${anio ? `?anio=${anio}` : ''}`)
      .then(setDatos)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [anio]);

  if (error) return <div className="aviso error">{error}</div>;
  if (!datos) return <p className="texto-suave">Cargando…</p>;

  const anios = datos.anios.includes(datos.anio) ? datos.anios : [datos.anio, ...datos.anios];
  const mayorMes = Math.max(0, ...datos.porMes.map((m) => m.total));
  const sinDatos = datos.presupuestos === 0;

  return (
    <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="campo" style={{ width: 140 }}>
            <label>Año</label>
            <select value={datos.anio} onChange={(e) => setAnio(Number(e.target.value))}>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <span className="texto-suave">Eventos que empiezan en {datos.anio}, con todos sus presupuestos.</span>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--color-primario-claro)' }}>
        <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <div>
            <strong>Facturación de {datos.anio} (sin IVA)</strong>
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
        <p className="texto-suave">No hay presupuestos cargados en eventos de {datos.anio}.</p>
      ) : (
        <>
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
                      <td className="num">{m.eventos ? porcentaje(m.total, datos.total) : '—'}</td>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Por estado de cobro</h3>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th className="num">Presupuestos</th>
                      <th className="num">Facturación</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.porEstado.map((e) => (
                      <tr key={e.estado}>
                        <td>
                          <span className={`badge ${e.estado}`}>{etiquetaEstadoPresupuesto(e.estado)}</span>
                        </td>
                        <td className="num">{e.presupuestos}</td>
                        <td className="num">{formatearMonto(e.total)}</td>
                        <td className="num">{porcentaje(e.total, datos.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Por rubro</h3>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Rubro</th>
                      <th className="num">Unidades</th>
                      <th className="num">Facturación</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.porRubro.map((g) => (
                      <tr key={g.rubro}>
                        <td>{g.rubro}</td>
                        <td className="num">{formatoUnidades.format(g.cantidad)}</td>
                        <td className="num">{formatearMonto(g.total)}</td>
                        <td className="num">{porcentaje(g.total, datos.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Por evento</h3>
            <p className="texto-suave" style={{ marginTop: 0 }}>
              Tocá un evento para ver su facturación por producto.
            </p>
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Inicio</th>
                    <th className="num">Presupuestos</th>
                    <th className="num">Facturación</th>
                    <th className="num">% del año</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.porEvento.map((e) => (
                    <tr key={e.id} onClick={() => onVerEvento(e.id)} style={{ cursor: 'pointer' }}>
                      <td>{e.nombre}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaCorta(e.fecha_inicio)}</td>
                      <td className="num">{e.presupuestos}</td>
                      <td className="num">
                        {formatearMonto(e.total)}
                        {e.lineasSinPrecio > 0 && <span className="texto-suave"> (falta precio en {e.lineasSinPrecio})</span>}
                      </td>
                      <td className="num">{porcentaje(e.total, datos.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
