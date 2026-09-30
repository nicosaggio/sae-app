import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { LotePanel } from '../components/LotePanel';
import { Modal } from '../components/Modal';
import { useAuth } from '../context/AuthContext';

export function EventoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { puedeEscribir } = useAuth();
  const [evento, setEvento] = useState(null);
  const [productos, setProductos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [nuevoLote, setNuevoLote] = useState({ codigo: '', expositor: '', contacto: '' });
  const [fusionAbierta, setFusionAbierta] = useState(false);
  const [otroEventoId, setOtroEventoId] = useState(null);
  const [fusionando, setFusionando] = useState(false);

  async function cargar() {
    setError('');
    try {
      const [ev, listaProductos, listaEventos] = await Promise.all([
        api.get(`/eventos/${id}`),
        api.get('/productos?activo=1'),
        api.get('/eventos'),
      ]);
      setEvento(ev);
      setProductos(listaProductos);
      setEventos(listaEventos);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function unificarEventos() {
    if (!otroEventoId) return;
    setFusionando(true);
    setError('');
    try {
      await api.post(`/eventos/${id}/fusionar`, { otroEventoId });
      setFusionAbierta(false);
      setOtroEventoId(null);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setFusionando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function actualizarEvento(campos) {
    setError('');
    try {
      const actualizado = await api.put(`/eventos/${id}`, { ...evento, ...campos });
      setEvento({ ...evento, ...actualizado });
    } catch (err) {
      setError(err.message);
    }
  }

  async function crearLote(e) {
    e.preventDefault();
    setError('');
    if (!nuevoLote.codigo) return;
    try {
      await api.post(`/eventos/${id}/lotes`, nuevoLote);
      setNuevoLote({ codigo: '', expositor: '', contacto: '' });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  if (cargando) return <p className="texto-suave">Cargando…</p>;
  if (!evento) return <div className="aviso error">Evento no encontrado</div>;

  return (
    <div>
      <button onClick={() => navigate('/calendario')} style={{ marginBottom: 12 }}>
        ← Volver al calendario
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>{evento.nombre}</h2>
        {puedeEscribir && (
          <button onClick={() => setFusionAbierta(true)}>Unificar con otro evento…</button>
        )}
      </div>
      {error && <div className="aviso error">{error}</div>}

      {fusionAbierta && (
        <Modal onClose={() => setFusionAbierta(false)}>
          <h3 style={{ marginTop: 0 }}>Unificar con otro evento</h3>
          <p className="texto-suave">
            Elegí el evento duplicado. Sus lotes y presupuestos pasan a <strong>{evento.nombre}</strong> y el
            evento elegido se borra. Los próximos Excel que digan su nombre van a caer en este evento.
          </p>
          <BuscadorEvento
            eventos={eventos.filter((e) => e.id !== evento.id)}
            value={otroEventoId}
            onChange={setOtroEventoId}
            placeholder="Buscar evento duplicado…"
          />
          <div className="toolbar" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={() => setFusionAbierta(false)}>Cancelar</button>
            <button className="primario" disabled={!otroEventoId || fusionando} onClick={unificarEventos}>
              {fusionando ? 'Unificando…' : 'Unificar'}
            </button>
          </div>
        </Modal>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Datos del evento</h3>
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <div className="campo">
            <label>Nombre</label>
            <input
              value={evento.nombre}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, nombre: e.target.value })}
              onBlur={(e) => actualizarEvento({ nombre: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Lugar</label>
            <input
              value={evento.lugar || ''}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, lugar: e.target.value })}
              onBlur={(e) => actualizarEvento({ lugar: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha inicio</label>
            <input
              type="date"
              value={evento.fecha_inicio}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, fecha_inicio: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_inicio: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha fin</label>
            <input
              type="date"
              value={evento.fecha_fin}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, fecha_fin: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_fin: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha armado (opcional)</label>
            <input
              type="date"
              value={evento.fecha_armado || ''}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, fecha_armado: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_armado: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha desarme (opcional)</label>
            <input
              type="date"
              value={evento.fecha_desarme || ''}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, fecha_desarme: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_desarme: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Notas</label>
            <input
              value={evento.notas || ''}
              disabled={!puedeEscribir}
              onChange={(e) => setEvento({ ...evento, notas: e.target.value })}
              onBlur={(e) => actualizarEvento({ notas: e.target.value })}
            />
          </div>
        </div>
        <p className="texto-suave" style={{ marginTop: 12 }}>
          Creado por {evento.creado_por_nombre || evento.creado_por_usuario}
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lotes</h3>
        {puedeEscribir && (
          <form onSubmit={crearLote} className="toolbar">
            <input
              placeholder="Código de lote (ej: A-12)"
              required
              value={nuevoLote.codigo}
              onChange={(e) => setNuevoLote({ ...nuevoLote, codigo: e.target.value })}
            />
            <input
              placeholder="Expositor (opcional)"
              value={nuevoLote.expositor}
              onChange={(e) => setNuevoLote({ ...nuevoLote, expositor: e.target.value })}
            />
            <input
              placeholder="Contacto (opcional)"
              value={nuevoLote.contacto}
              onChange={(e) => setNuevoLote({ ...nuevoLote, contacto: e.target.value })}
            />
            <button type="submit" className="primario">
              + Nuevo lote
            </button>
          </form>
        )}

        {evento.lotes.length === 0 ? (
          <p className="texto-suave">Todavía no hay lotes en este evento.</p>
        ) : (
          evento.lotes.map((lote) => (
            <LotePanel key={lote.id} lote={lote} productos={productos} onCambiado={cargar} />
          ))
        )}
      </div>
    </div>
  );
}
