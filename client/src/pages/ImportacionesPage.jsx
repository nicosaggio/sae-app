import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatearMonto } from '../format';

export function ImportacionesPage() {
  const [pendientes, setPendientes] = useState([]);
  const [eventosSinFecha, setEventosSinFecha] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);

  async function cargar() {
    setError('');
    try {
      const [p, e] = await Promise.all([api.get('/importaciones/pendientes'), api.get('/eventos?sin_fecha=1')]);
      setPendientes(p);
      setEventosSinFecha(e);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function escanearAhora() {
    setEscaneando(true);
    setError('');
    try {
      const resultado = await api.post('/importaciones/escanear-ahora');
      if (resultado.ok) {
        const r = resultado.resumen;
        setAviso({
          tipo: 'exito',
          texto: `Escaneo completo: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.eventosCreadosSinFecha} eventos nuevos (sin fecha), ${r.pendientesEvento} ambiguos, ${r.huerfanos} huérfanos, ${r.borrados} borrados, ${r.errores} errores.`,
        });
      } else {
        setAviso({ tipo: 'advertencia', texto: `No se pudo escanear: ${resultado.error}` });
      }
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEscaneando(false);
    }
  }

  const eventosAmbiguos = pendientes.filter((p) => p.tipo === 'evento_ambiguo');
  const posiblesReemplazos = pendientes.filter((p) => p.tipo === 'posible_reemplazo');
  const totalPendientes = pendientes.length + eventosSinFecha.length;

  return (
    <div>
      <h2>Importaciones pendientes</h2>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
          <span className="texto-suave">{totalPendientes} pendientes de revisión</span>
          <button className="primario" onClick={escanearAhora} disabled={escaneando}>
            {escaneando ? 'Escaneando…' : 'Escanear ahora'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Eventos sin fecha</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Se creó el evento automáticamente al llegar un presupuesto con un EXPO nuevo — falta completar lugar y
          fechas.
        </p>
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : eventosSinFecha.length === 0 ? (
          <p className="texto-suave">Nada pendiente.</p>
        ) : (
          eventosSinFecha.map((ev) => <EventoSinFecha key={ev.id} evento={ev} onCompletado={cargar} />)
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nombres de evento ambiguos</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          El EXPO del archivo matchea más de un evento (ej. una expo que se repite en el año) — hay que elegir cuál
          es.
        </p>
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : eventosAmbiguos.length === 0 ? (
          <p className="texto-suave">Nada pendiente.</p>
        ) : (
          eventosAmbiguos.map((p) => <PendienteEventoAmbiguo key={p.id} pendiente={p} onResuelto={cargar} />)
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Posibles reemplazos</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Un archivo desapareció y apareció uno nuevo para el mismo lote — ¿es una revisión del mismo presupuesto o
          son dos presupuestos distintos?
        </p>
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : posiblesReemplazos.length === 0 ? (
          <p className="texto-suave">Nada pendiente.</p>
        ) : (
          posiblesReemplazos.map((p) => <PendientePosibleReemplazo key={p.id} pendiente={p} onResuelto={cargar} />)
        )}
      </div>
    </div>
  );
}

function EventoSinFecha({ evento, onCompletado }) {
  const [form, setForm] = useState({ lugar: evento.lugar || '', fecha_inicio: '', fecha_fin: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function completar(e) {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      await api.put(`/eventos/${evento.id}`, { nombre: evento.nombre, ...form });
      onCompletado();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="presupuesto-card">
      {error && <div className="aviso error">{error}</div>}
      <p style={{ marginTop: 0 }}>
        <strong>{evento.nombre}</strong>
      </p>
      <form onSubmit={completar} className="form-grid">
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
        <div className="acciones-fila" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="primario" disabled={enviando}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

function PendienteEventoAmbiguo({ pendiente, onResuelto }) {
  const [eventos, setEventos] = useState([]);
  const [eventoElegido, setEventoElegido] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nuevoEvento, setNuevoEvento] = useState({
    nombre: pendiente.datos.evento_nombre || '',
    lugar: '',
    fecha_inicio: '',
    fecha_fin: '',
  });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .get('/eventos')
      .then(setEventos)
      .catch(() => {});
  }, []);

  async function vincular() {
    if (!eventoElegido) return;
    setEnviando(true);
    setError('');
    try {
      await api.post(`/importaciones/pendientes/${pendiente.id}/vincular-evento`, { evento_id: Number(eventoElegido) });
      onResuelto();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  async function crearYVincular(e) {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      await api.post(`/importaciones/pendientes/${pendiente.id}/crear-evento`, nuevoEvento);
      onResuelto();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const d = pendiente.datos;

  return (
    <div className="presupuesto-card">
      {error && <div className="aviso error">{error}</div>}
      <p style={{ marginTop: 0 }}>
        <strong>EXPO del archivo:</strong> {d.evento_nombre} — <strong>Stand:</strong> {d.lote_codigo}
        {d.lote_expositor ? ` (${d.lote_expositor})` : ''}
      </p>
      <p className="texto-suave">
        Cliente: {d.cliente_nombre || '—'} · Monto: {formatearMonto(d.monto_total)} · {d.lineas.length} productos
      </p>
      <p className="texto-suave">Archivo: {pendiente.ruta_archivo}</p>

      {!mostrarForm ? (
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select value={eventoElegido} onChange={(e) => setEventoElegido(e.target.value)}>
            <option value="">Elegir evento existente…</option>
            {eventos.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.nombre} ({ev.fecha_inicio})
              </option>
            ))}
          </select>
          <button className="primario" onClick={vincular} disabled={!eventoElegido || enviando}>
            Vincular
          </button>
          <button onClick={() => setMostrarForm(true)}>+ Crear evento nuevo</button>
        </div>
      ) : (
        <form onSubmit={crearYVincular} className="form-grid">
          <div className="campo">
            <label>Nombre</label>
            <input
              required
              value={nuevoEvento.nombre}
              onChange={(e) => setNuevoEvento({ ...nuevoEvento, nombre: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Lugar</label>
            <input value={nuevoEvento.lugar} onChange={(e) => setNuevoEvento({ ...nuevoEvento, lugar: e.target.value })} />
          </div>
          <div className="campo">
            <label>Fecha inicio</label>
            <input
              type="date"
              required
              value={nuevoEvento.fecha_inicio}
              onChange={(e) => setNuevoEvento({ ...nuevoEvento, fecha_inicio: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha fin</label>
            <input
              type="date"
              required
              value={nuevoEvento.fecha_fin}
              onChange={(e) => setNuevoEvento({ ...nuevoEvento, fecha_fin: e.target.value })}
            />
          </div>
          <div className="acciones-fila" style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="primario" disabled={enviando}>
              Crear y vincular
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PendientePosibleReemplazo({ pendiente, onResuelto }) {
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function resolver(tipo) {
    setEnviando(true);
    setError('');
    try {
      await api.post(`/importaciones/pendientes/${pendiente.id}/resolver-${tipo}`);
      onResuelto();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const { huerfano, nuevo } = pendiente;

  return (
    <div className="presupuesto-card">
      {error && <div className="aviso error">{error}</div>}
      <p style={{ marginTop: 0 }}>
        <strong>Evento:</strong> {nuevo?.evento_nombre} — <strong>Lote:</strong> {nuevo?.lote_codigo}
        {nuevo?.lote_expositor ? ` (${nuevo.lote_expositor})` : ''}
      </p>
      <div className="tabla-scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Huérfano (archivo desaparecido)</th>
            <th>Nuevo (recién importado)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cliente</td>
            <td>{huerfano?.cliente_nombre || '—'}</td>
            <td>{nuevo?.cliente_nombre || '—'}</td>
          </tr>
          <tr>
            <td>Fecha</td>
            <td>{huerfano?.fecha || '—'}</td>
            <td>{nuevo?.fecha || '—'}</td>
          </tr>
          <tr>
            <td>Monto</td>
            <td>{formatearMonto(huerfano?.monto_total)}</td>
            <td>{formatearMonto(nuevo?.monto_total)}</td>
          </tr>
          <tr>
            <td>Número</td>
            <td>{huerfano?.numero || '—'}</td>
            <td>{nuevo?.numero || '—'}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
        <button className="primario" onClick={() => resolver('reemplazo')} disabled={enviando}>
          Es un reemplazo (borrar el viejo)
        </button>
        <button onClick={() => resolver('independiente')} disabled={enviando}>
          Son distintos (mantener ambos)
        </button>
      </div>
    </div>
  );
}
