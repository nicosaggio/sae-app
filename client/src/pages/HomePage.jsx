import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../context/AuthContext';
import { fechaCorta, pesos } from '../catalogoFormat';
import { cuandoAlerta, cuandoEs, fechaLarga, hoyIso, sumarDias } from '../fechas';
import { Icono } from '../components/Icono';
import { ReglaFases } from '../components/ReglaFases';

/** Una fila de lista que se toca (o se abre con Enter) y lleva a otra pantalla. */
function FilaClic({ a, children }) {
  const navigate = useNavigate();
  return (
    <tr
      tabIndex={0}
      onClick={() => navigate(a)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(a);
        }
      }}
    >
      {children}
      <td className="chev">
        <Icono nombre="chev-r" className="icono--sm" />
      </td>
    </tr>
  );
}

function Esqueletos({ cantidad, alto }) {
  return (
    <div className="tarjeta-cuerpo pila" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: cantidad }, (_, i) => (
        <div key={i} className="esqueleto" style={{ height: alto }} />
      ))}
    </div>
  );
}

export function HomePage() {
  const { usuario } = useAuth();
  const hoy = hoyIso();
  const hasta = sumarDias(hoy, 30);

  const { datos: alertas, cargando: cargandoAlertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);
  const { datos: eventos, cargando: cargandoEventos } = usePolling(() => api.get(`/eventos?desde=${hoy}&hasta=${hasta}&con_presupuestos=1`), 30000, [hoy, hasta]);

  const proximosEventos = (eventos || [])
    .slice()
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
    .slice(0, 5);

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Hola, {usuario?.nombre_completo || usuario?.nombre_usuario}</h1>
          <p className="sub">{fechaLarga(hoy)}</p>
        </div>
      </header>

      <div className="inicio-grid">
        <section className="tarjeta" aria-labelledby="inicio-alertas">
          <div className="tarjeta-cab">
            <div>
              <div className="fila">
                <h2 id="inicio-alertas">Alertas de pago</h2>
                {alertas && alertas.length > 0 && (
                  <span className="contador" style={{ marginLeft: 0 }}>
                    {alertas.length}
                  </span>
                )}
              </div>
              <div className="sub">Cobros pendientes con el evento cerca</div>
            </div>
            <Link className="boton boton--suave boton--sm" to="/alertas">
              Ver todas
            </Link>
          </div>
          {cargandoAlertas && !alertas ? (
            <Esqueletos cantidad={3} alto={38} />
          ) : !alertas || alertas.length === 0 ? (
            <div className="vacio">
              <span className="icono-vacio">
                <Icono nombre="check-c" className="icono--lg" />
              </span>
              <h3>Sin alertas por ahora</h3>
              <p>No hay cobros pendientes con evento cerca.</p>
            </div>
          ) : (
            <table className="tabla tabla--clic tabla--sin-cab">
              <tbody>
                {alertas.slice(0, 5).map((a) => {
                  const cuando = cuandoAlerta(a.fecha_inicio, hoy);
                  return (
                    <FilaClic key={a.id} a={`/eventos/${a.evento_id}`}>
                      <td>
                        <strong>{a.evento_nombre}</strong>
                        <span className="sub">
                          Lote {a.lote_codigo}
                          {a.lote_expositor ? ` — ${a.lote_expositor}` : ''} · {a.cliente_nombre || 'sin cliente'}
                        </span>
                      </td>
                      <td className="num">
                        <strong>{pesos(a.monto_total, false)}</strong>
                        <span className="sub">con IVA</span>
                      </td>
                      <td>
                        <span className={`etiqueta ${cuando.clase}`}>{cuando.texto}</span>
                      </td>
                    </FilaClic>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="tarjeta-pie" style={{ fontSize: 'var(--t-sm)', color: 'var(--c-texto-2)' }}>
            Presupuestos en “Pendiente de pago” cuyo evento empieza en 3 días o menos, o ya empezó.
          </div>
        </section>

        <section className="tarjeta" aria-labelledby="inicio-eventos">
          <div className="tarjeta-cab">
            <div>
              <h2 id="inicio-eventos">Próximos eventos</h2>
              <div className="sub">Próximos 30 días, con presupuestos cargados</div>
            </div>
            <Link className="boton boton--suave boton--sm" to="/calendario">
              Ver calendario
            </Link>
          </div>
          {cargandoEventos && !eventos ? (
            <Esqueletos cantidad={3} alto={54} />
          ) : proximosEventos.length === 0 ? (
            <div className="vacio">
              <span className="icono-vacio">
                <Icono nombre="calendar" className="icono--lg" />
              </span>
              <h3>Sin eventos con presupuestos</h3>
              <p>No hay eventos con presupuestos cargados en los próximos 30 días.</p>
            </div>
          ) : (
            <table className="tabla tabla--clic tabla--sin-cab">
              <tbody>
                {proximosEventos.map((ev) => (
                  <FilaClic key={ev.id} a={`/eventos/${ev.id}`}>
                    <td style={{ width: '46%' }}>
                      <strong>{ev.nombre}</strong>
                      <span className="sub">
                        {ev.lugar ? `${ev.lugar} · ` : ''}
                        {fechaCorta(ev.fecha_inicio)}
                        {ev.fecha_fin !== ev.fecha_inicio ? ` al ${fechaCorta(ev.fecha_fin)}` : ''}
                      </span>
                    </td>
                    <td>
                      <ReglaFases armado={ev.fecha_armado} inicio={ev.fecha_inicio} fin={ev.fecha_fin} desarme={ev.fecha_desarme} hoy={hoy} mini />
                      <span className="sub">{cuandoEs(ev.fecha_inicio, ev.fecha_fin, hoy)}</span>
                    </td>
                  </FilaClic>
                ))}
              </tbody>
            </table>
          )}
          <div className="tarjeta-pie leyenda">
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
            <span>| Hoy</span>
          </div>
        </section>
      </div>
    </div>
  );
}
