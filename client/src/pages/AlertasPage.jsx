import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { fechaCorta, pesos } from '../catalogoFormat';
import { cuandoAlerta, hoyIso } from '../fechas';
import { Icono } from '../components/Icono';

export function AlertasPage() {
  const { datos: alertas, error, cargando } = usePolling(() => api.get('/presupuestos/alertas'), 20000, []);
  const hoy = hoyIso();

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Alertas de pago pendiente</h1>
          <p className="sub">Presupuestos en “Pendiente de pago” cuyo evento empieza en 3 días o menos, o ya empezó.</p>
        </div>
      </header>

      {error && !alertas && (
        <div className="aviso aviso--error" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <Icono nombre="warn" />
          <div className="aviso-cuerpo">No se pudieron cargar las alertas. Se vuelve a intentar solo en unos segundos.</div>
        </div>
      )}

      <section className="tarjeta" aria-label="Alertas">
        {cargando && !alertas ? (
          <div className="tarjeta-cuerpo pila" aria-busy="true" aria-label="Cargando">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="esqueleto" />
            ))}
          </div>
        ) : !alertas || alertas.length === 0 ? (
          <div className="vacio">
            <span className="icono-vacio">
              <Icono nombre="check-c" className="icono--lg" />
            </span>
            <h3>Sin alertas por ahora</h3>
            <p>No hay cobros pendientes con el evento cerca.</p>
          </div>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Inicio del evento</th>
                  <th>Cuándo</th>
                  <th>Lote — expositor</th>
                  <th>Cliente</th>
                  <th className="num">Monto</th>
                  <th>
                    <span className="solo-lectores">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {alertas.map((a) => {
                  const w = cuandoAlerta(a.fecha_inicio, hoy);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.evento_nombre}</strong>
                      </td>
                      <td className="nw">{fechaCorta(a.fecha_inicio)}</td>
                      <td>
                        <span className={`etiqueta ${w.clase}`}>{w.texto}</span>
                      </td>
                      <td>
                        {a.lote_codigo}
                        {a.lote_expositor ? ` — ${a.lote_expositor}` : ''}
                      </td>
                      <td>{a.cliente_nombre || '—'}</td>
                      <td className="num">
                        <strong>{pesos(a.monto_total)}</strong>
                      </td>
                      <td className="acciones">
                        <Link className="boton boton--sm" to={`/eventos/${a.evento_id}`}>
                          Ver evento
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
