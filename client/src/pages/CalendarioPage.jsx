import { useCallback, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../context/AuthContext';
import { fechaCorta } from '../catalogoFormat';
import { barrasDeSemana, semanasDelMes, tramosDe } from '../calendarioLogica';
import { esFechaIso, hoyIso } from '../fechas';
import { Icono } from '../components/Icono';
import { PanelLateral } from '../components/PanelLateral';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const EVENTO_VACIO = { nombre: '', lugar: '', fecha_inicio: '', fecha_fin: '', fecha_armado: '', fecha_desarme: '', notas: '' };

export function CalendarioPage() {
  const navigate = useNavigate();
  const { puedeEscribir } = useAuth();
  const hoy = hoyIso();
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)) - 1);
  const [nuevo, setNuevo] = useState(null); // el formulario de "Nuevo evento" mientras está abierto
  const [errorNuevo, setErrorNuevo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const idf = useId();

  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes]);
  const desde = semanas[0][0];
  const hasta = semanas[semanas.length - 1][6];

  const { datos: eventos } = usePolling(() => api.get(`/eventos?desde=${desde}&hasta=${hasta}&con_presupuestos=1`), 15000, [desde, hasta]);
  const { datos: alertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);

  const conAlerta = useMemo(() => new Set((alertas || []).map((a) => a.evento_id)), [alertas]);
  const tramos = useMemo(() => (eventos || []).flatMap(tramosDe), [eventos]);
  const delMes = useMemo(() => {
    const prefijo = `${anio}-${String(mes + 1).padStart(2, '0')}`;
    return (eventos || []).filter((e) => e.fecha_inicio.slice(0, 7) === prefijo).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  }, [eventos, anio, mes]);

  function irAlMes(delta) {
    const fecha = new Date(anio, mes + delta, 1);
    setAnio(fecha.getFullYear());
    setMes(fecha.getMonth());
  }

  const cerrarNuevo = useCallback(() => setNuevo(null), []);

  async function crear(e) {
    e.preventDefault();
    const { nombre, fecha_inicio: inicio, fecha_fin: fin } = nuevo;
    if (!nombre.trim()) return setErrorNuevo('Falta el nombre del evento.');
    if (!esFechaIso(inicio) || !esFechaIso(fin)) return setErrorNuevo('Completá la fecha de inicio y la de fin.');
    if (fin < inicio) return setErrorNuevo('La fecha de fin no puede ser anterior a la de inicio.');
    setErrorNuevo('');
    setEnviando(true);
    try {
      const evento = await api.post('/eventos', nuevo);
      navigate(`/eventos/${evento.id}`);
    } catch (err) {
      setErrorNuevo(err.message);
      setEnviando(false);
    }
  }

  const campoNuevo = (clave) => ({ value: nuevo?.[clave] ?? '', onChange: (e) => setNuevo({ ...nuevo, [clave]: e.target.value }) });
  const finAntes = nuevo && esFechaIso(nuevo.fecha_inicio) && esFechaIso(nuevo.fecha_fin) && nuevo.fecha_fin < nuevo.fecha_inicio;
  const rangoDeEvento = (e) => `${fechaCorta(e.fecha_inicio)}${e.fecha_fin !== e.fecha_inicio ? ` al ${fechaCorta(e.fecha_fin)}` : ''}`;

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Calendario de eventos</h1>
          <p className="sub">Eventos con presupuestos cargados, incluidos los que todavía están pendientes de confirmación.</p>
        </div>
        {puedeEscribir && (
          <button
            type="button"
            className="boton boton--primario"
            onClick={() => {
              setErrorNuevo('');
              setEnviando(false);
              setNuevo({ ...EVENTO_VACIO });
            }}
          >
            <Icono nombre="plus" />
            Nuevo evento
          </button>
        )}
      </header>

      <div className="fila fila--entre" style={{ marginBottom: 'var(--s-3)' }}>
        <div className="fila" style={{ gap: 'var(--s-2)' }}>
          <button type="button" className="boton boton--icono" aria-label="Mes anterior" onClick={() => irAlMes(-1)}>
            <Icono nombre="chev-l" />
          </button>
          <h2 aria-live="polite" style={{ fontSize: 'var(--t-lg)', minWidth: 170, textAlign: 'center' }}>
            {MESES[mes]} {anio}
          </h2>
          <button type="button" className="boton boton--icono" aria-label="Mes siguiente" onClick={() => irAlMes(1)}>
            <Icono nombre="chev-r" />
          </button>
        </div>
        <div className="leyenda" aria-label="Referencias">
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
          <span>
            <span className="leyenda-d" aria-hidden="true">
              D
            </span>{' '}
            Desarme el último día
          </span>
          <span>
            <i className="l-alerta" />
            Alerta de pago
          </span>
        </div>
      </div>

      <div className="cal" role="group" aria-label={`Calendario de ${MESES[mes]} de ${anio}`}>
        <div className="cal-dias" aria-hidden="true">
          {DIAS_SEMANA.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        {semanas.map((semana) => {
          const { barras, carriles } = barrasDeSemana(semana, tramos);
          return (
            <div key={semana[0]} className="cal-semana" style={{ gridTemplateRows: `30px repeat(${Math.max(carriles, 2)}, 24px)` }}>
              {semana.map((dia, i) => {
                const esHoy = dia === hoy;
                const fuera = Number(dia.slice(5, 7)) - 1 !== mes;
                return (
                  <div key={dia} style={{ display: 'contents' }}>
                    {esHoy && <div className="cal-hoy-fondo" style={{ gridColumn: i + 1 }} />}
                    <div className={`cal-num${fuera ? ' fuera' : ''}${i >= 5 ? ' finde' : ''}${esHoy ? ' hoy' : ''}`} style={{ gridColumn: i + 1 }}>
                      <span aria-label={esHoy ? `Hoy, ${Number(dia.slice(8, 10))}` : undefined}>{Number(dia.slice(8, 10))}</span>
                    </div>
                  </div>
                );
              })}
              {barras.map((b) => {
                const e = b.evento;
                const rotulo = { armado: 'Armado', evento: '', desarme: 'Desarme' }[b.tipo];
                const desarmeElUltimoDia = b.tipo === 'evento' && e.fecha_desarme === e.fecha_fin && b.hasta <= semana[6];
                return (
                  <Link
                    key={`${b.tipo}-${e.id}`}
                    className={`cal-barra cal-barra--${b.tipo}${b.cortaIzq ? ' corta-izq' : ''}${b.cortaDer ? ' corta-der' : ''}`}
                    to={`/eventos/${e.id}`}
                    style={{ gridColumn: `${b.col1 + 1} / ${b.col2 + 2}`, gridRow: b.carril + 2 }}
                    title={`${rotulo ? `${rotulo} — ` : ''}${e.nombre}${e.lugar ? ` · ${e.lugar}` : ''}`}
                  >
                    {b.tipo === 'evento' && conAlerta.has(e.id) && (
                      <span className="alerta" title="Alerta de pago" aria-label="Con alerta de pago">
                        $
                      </span>
                    )}
                    <span className="t">
                      {rotulo ? `${rotulo} · ` : ''}
                      {e.nombre}
                    </span>
                    {desarmeElUltimoDia && (
                      <b className="dmark" title="Desarme el último día" aria-label="Desarme el último día">
                        D
                      </b>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>

      <section className="cal-agenda" aria-labelledby={`${idf}-agenda`}>
        <h2 id={`${idf}-agenda`} style={{ marginBottom: 'var(--s-3)' }}>
          Eventos del mes
        </h2>
        <div className="tarjeta">
          {delMes.length === 0 ? (
            <div className="vacio">
              <h3>Sin eventos este mes</h3>
              <p>No hay eventos con presupuestos cargados.</p>
            </div>
          ) : (
            <table className="tabla tabla--clic tabla--sin-cab">
              <tbody>
                {delMes.map((e) => (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    onClick={() => navigate(`/eventos/${e.id}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        navigate(`/eventos/${e.id}`);
                      }
                    }}
                  >
                    <td>
                      <strong>{e.nombre}</strong>
                      {conAlerta.has(e.id) && <span className="etiqueta etiqueta--peligro" style={{ marginLeft: 6 }}>Alerta de pago</span>}
                      <span className="sub">
                        {e.lugar ? `${e.lugar} · ` : ''}
                        {rangoDeEvento(e)}
                      </span>
                    </td>
                    <td className="chev">
                      <Icono nombre="chev-r" className="icono--sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {puedeEscribir && nuevo && (
        <PanelLateral
          titulo="Nuevo evento"
          ancho={520}
          onClose={cerrarNuevo}
          onSubmit={crear}
          cabecera={
            <>
              <h2>Nuevo evento</h2>
              <p className="sub" style={{ marginTop: 2 }}>
                Después podés cargar sus lotes y presupuestos.
              </p>
            </>
          }
          pie={
            <>
              <button type="button" className="boton" onClick={cerrarNuevo}>
                Cancelar
              </button>
              <button type="submit" className="boton boton--primario" disabled={enviando}>
                <Icono nombre="plus" />
                {enviando ? 'Creando…' : 'Crear evento'}
              </button>
            </>
          }
        >
          {errorNuevo && (
            <div className="aviso aviso--error" role="alert">
              <Icono nombre="warn" />
              <div className="aviso-cuerpo">{errorNuevo}</div>
            </div>
          )}
          <div className="campo">
            <label htmlFor={`${idf}-nombre`}>
              Nombre <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
            </label>
            <input id={`${idf}-nombre`} autoFocus {...campoNuevo('nombre')} />
          </div>
          <div className="campo">
            <label htmlFor={`${idf}-lugar`}>Lugar</label>
            <input id={`${idf}-lugar`} {...campoNuevo('lugar')} />
          </div>
          <div className="grid grid-2">
            <div className={`campo${finAntes ? ' campo--error' : ''}`}>
              <label htmlFor={`${idf}-inicio`}>
                Fecha de inicio <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
              </label>
              <input id={`${idf}-inicio`} type="date" {...campoNuevo('fecha_inicio')} />
            </div>
            <div className={`campo${finAntes ? ' campo--error' : ''}`}>
              <label htmlFor={`${idf}-fin`}>
                Fecha de fin <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
              </label>
              <input id={`${idf}-fin`} type="date" {...campoNuevo('fecha_fin')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-armado`}>
                Fecha de armado <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
              </label>
              <input id={`${idf}-armado`} type="date" {...campoNuevo('fecha_armado')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idf}-desarme`}>
                Fecha de desarme <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
              </label>
              <input id={`${idf}-desarme`} type="date" {...campoNuevo('fecha_desarme')} />
            </div>
          </div>
          <div className="campo">
            <label htmlFor={`${idf}-notas`}>Notas</label>
            <textarea id={`${idf}-notas`} rows={3} {...campoNuevo('notas')} />
          </div>
        </PanelLateral>
      )}
    </div>
  );
}
