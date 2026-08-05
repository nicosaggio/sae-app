import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function ImportacionesPage() {
  const [pendientes, setPendientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);

  async function cargar() {
    setError('');
    try {
      setPendientes(await api.get('/importaciones/pendientes'));
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
          texto: `Escaneo completo: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.pendientesEvento} sin evento, ${r.huerfanos} huérfanos, ${r.errores} errores.`,
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

  const eventosNoEncontrados = pendientes.filter((p) => p.tipo === 'evento_no_encontrado');
  const posiblesReemplazos = pendientes.filter((p) => p.tipo === 'posible_reemplazo');

  return (
    <div>
      <h2>Importaciones pendientes</h2>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
          <span className="texto-suave">{pendientes.length} pendientes de revisión</span>
          <button className="primario" onClick={escanearAhora} disabled={escaneando}>
            {escaneando ? 'Escaneando…' : 'Escanear ahora'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Eventos no encontrados</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          El EXPO del archivo no matchea ningún evento (o matchea más de uno) — hay que vincularlo a mano.
        </p>
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : eventosNoEncontrados.length === 0 ? (
          <p className="texto-suave">Nada pendiente.</p>
        ) : (
          eventosNoEncontrados.map((p) => <PendienteEventoNoEncontrado key={p.id} pendiente={p} onResuelto={cargar} />)
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

function PendienteEventoNoEncontrado({ pendiente, onResuelto }) {
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
        Cliente: {d.cliente_nombre || '—'} · Monto: {d.monto_total ?? '—'} · {d.lineas.length} productos
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
            <td>{huerfano?.monto_total ?? '—'}</td>
            <td>{nuevo?.monto_total ?? '—'}</td>
          </tr>
          <tr>
            <td>Número</td>
            <td>{huerfano?.numero || '—'}</td>
            <td>{nuevo?.numero || '—'}</td>
          </tr>
        </tbody>
      </table>
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
