import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../context/AuthContext';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function construirGrilla(anio, mes) {
  const primerDiaMes = new Date(anio, mes, 1);
  const ultimoDiaMes = new Date(anio, mes + 1, 0);

  const offsetInicio = (primerDiaMes.getDay() + 6) % 7; // lunes = 0
  const inicio = new Date(primerDiaMes);
  inicio.setDate(inicio.getDate() - offsetInicio);

  const offsetFin = (7 - ((ultimoDiaMes.getDay() + 6) % 7) - 1) % 7;
  const fin = new Date(ultimoDiaMes);
  fin.setDate(fin.getDate() + offsetFin);

  const dias = [];
  const cursor = new Date(inicio);
  while (cursor <= fin) {
    dias.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return { dias, inicio, fin };
}

export function CalendarioPage() {
  const navigate = useNavigate();
  const { puedeEscribir } = useAuth();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());

  const { dias, inicio, fin } = useMemo(() => construirGrilla(anio, mes), [anio, mes]);

  const { datos: eventos } = usePolling(
    () => api.get(`/eventos?desde=${toISO(inicio)}&hasta=${toISO(fin)}&con_presupuestos=1`),
    15000,
    [toISO(inicio), toISO(fin)]
  );
  const { datos: alertas } = usePolling(() => api.get('/presupuestos/alertas'), 30000, []);

  const eventosConAlerta = new Set((alertas || []).map((a) => a.evento_id));

  function eventosDelDia(dia) {
    const iso = toISO(dia);
    return (eventos || []).filter((ev) => ev.fecha_inicio <= iso && ev.fecha_fin >= iso);
  }

  // El armado es un período: desde fecha_armado hasta el día antes de que arranque el
  // evento (fecha_inicio ya se muestra con el chip normal). Análogo para el desarme, desde
  // el día después de fecha_fin hasta fecha_desarme.
  function eventosArmadoDelDia(dia) {
    const iso = toISO(dia);
    return (eventos || []).filter((ev) => ev.fecha_armado && ev.fecha_armado <= iso && iso < ev.fecha_inicio);
  }

  function eventosDesarmeDelDia(dia) {
    const iso = toISO(dia);
    return (eventos || []).filter((ev) => ev.fecha_desarme && ev.fecha_fin < iso && iso <= ev.fecha_desarme);
  }

  function irMesAnterior() {
    const nuevo = new Date(anio, mes - 1, 1);
    setAnio(nuevo.getFullYear());
    setMes(nuevo.getMonth());
  }

  function irMesSiguiente() {
    const nuevo = new Date(anio, mes + 1, 1);
    setAnio(nuevo.getFullYear());
    setMes(nuevo.getMonth());
  }

  return (
    <div>
      <h2>Calendario de eventos</h2>

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <button onClick={irMesAnterior}>← Anterior</button>
          <strong>
            {MESES[mes]} {anio}
          </strong>
          <button onClick={irMesSiguiente}>Siguiente →</button>
        </div>

        <div className="calendario-grid">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="calendario-dia-header">
              {d}
            </div>
          ))}
          {dias.map((dia) => {
            const enMes = dia.getMonth() === mes;
            const iso = toISO(dia);
            const evs = eventosDelDia(dia);
            const evsArmado = eventosArmadoDelDia(dia);
            const evsDesarme = eventosDesarmeDelDia(dia);
            return (
              <div key={dia.toISOString()} className={`calendario-celda ${enMes ? '' : 'fuera-de-mes'}`}>
                <div className="num-dia">{dia.getDate()}</div>
                {evs.map((ev) => {
                  // Si el desarme coincide con el último día del evento, no hay un chip de
                  // desarme aparte — se marca el chip normal de ese día con un borde azul.
                  const desarmeMismoDia = ev.fecha_desarme && ev.fecha_desarme === ev.fecha_fin && iso === ev.fecha_fin;
                  return (
                    <button
                      key={ev.id}
                      className={`evento-chip ${eventosConAlerta.has(ev.id) ? 'con-alerta' : ''} ${desarmeMismoDia ? 'desarme-mismo-dia' : ''}`}
                      title={`${ev.nombre} — ${ev.lugar || ''}`}
                      onClick={() => navigate(`/eventos/${ev.id}`)}
                    >
                      {ev.nombre}
                    </button>
                  );
                })}
                {evsArmado.map((ev) => (
                  <button
                    key={`armado-${ev.id}`}
                    className="evento-chip armado"
                    title={`Armado — ${ev.nombre}`}
                    onClick={() => navigate(`/eventos/${ev.id}`)}
                  >
                    🔧 {ev.nombre}
                  </button>
                ))}
                {evsDesarme.map((ev) => (
                  <button
                    key={`desarme-${ev.id}`}
                    className="evento-chip desarme"
                    title={`Desarme — ${ev.nombre}`}
                    onClick={() => navigate(`/eventos/${ev.id}`)}
                  >
                    📦 {ev.nombre}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {puedeEscribir && <NuevoEventoForm onCreado={() => {}} />}
    </div>
  );
}

function NuevoEventoForm({ onCreado }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nombre: '',
    lugar: '',
    fecha_inicio: '',
    fecha_fin: '',
    fecha_armado: '',
    fecha_desarme: '',
    notas: '',
  });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function crear(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const evento = await api.post('/eventos', form);
      onCreado();
      navigate(`/eventos/${evento.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Nuevo evento</h3>
      {error && <div className="aviso error">{error}</div>}
      <form onSubmit={crear} className="form-grid">
        <div className="campo">
          <label>Nombre</label>
          <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div className="campo">
          <label>Lugar</label>
          <input value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })} />
        </div>
        <div className="campo">
          <label>Fecha inicio</label>
          <input
            type="date"
            required
            value={form.fecha_inicio}
            onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Fecha fin</label>
          <input
            type="date"
            required
            value={form.fecha_fin}
            onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Fecha armado (opcional)</label>
          <input
            type="date"
            value={form.fecha_armado}
            onChange={(e) => setForm({ ...form, fecha_armado: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Fecha desarme (opcional)</label>
          <input
            type="date"
            value={form.fecha_desarme}
            onChange={(e) => setForm({ ...form, fecha_desarme: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Notas</label>
          <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </div>
      </form>
      <button type="button" className="primario" onClick={crear} disabled={enviando} style={{ marginTop: 8 }}>
        {enviando ? 'Creando…' : '+ Crear evento'}
      </button>
    </div>
  );
}
