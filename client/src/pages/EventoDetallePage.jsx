import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { LotePanel } from '../components/LotePanel';

export function EventoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [evento, setEvento] = useState(null);
  const [productos, setProductos] = useState([]);
  const [totales, setTotales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [nuevoLote, setNuevoLote] = useState({ codigo: '', expositor: '', contacto: '' });

  async function cargar() {
    setError('');
    try {
      const [ev, listaProductos, totalesEvento] = await Promise.all([
        api.get(`/eventos/${id}`),
        api.get('/productos?activo=1'),
        api.get(`/eventos/${id}/totales`),
      ]);
      setEvento(ev);
      setProductos(listaProductos);
      setTotales(totalesEvento);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
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
      <h2>{evento.nombre}</h2>
      {error && <div className="aviso error">{error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Datos del evento</h3>
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <div className="campo">
            <label>Nombre</label>
            <input
              value={evento.nombre}
              onChange={(e) => setEvento({ ...evento, nombre: e.target.value })}
              onBlur={(e) => actualizarEvento({ nombre: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Lugar</label>
            <input
              value={evento.lugar || ''}
              onChange={(e) => setEvento({ ...evento, lugar: e.target.value })}
              onBlur={(e) => actualizarEvento({ lugar: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha inicio</label>
            <input
              type="date"
              value={evento.fecha_inicio}
              onChange={(e) => setEvento({ ...evento, fecha_inicio: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_inicio: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Fecha fin</label>
            <input
              type="date"
              value={evento.fecha_fin}
              onChange={(e) => setEvento({ ...evento, fecha_fin: e.target.value })}
              onBlur={(e) => actualizarEvento({ fecha_fin: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Notas</label>
            <input
              value={evento.notas || ''}
              onChange={(e) => setEvento({ ...evento, notas: e.target.value })}
              onBlur={(e) => actualizarEvento({ notas: e.target.value })}
            />
          </div>
        </div>
        <p className="texto-suave" style={{ marginTop: 12 }}>
          Creado por {evento.creado_por_nombre || evento.creado_por_usuario}
        </p>
        <a href={`/api/eventos/${id}/export/pdf`} target="_blank" rel="noreferrer">
          <button type="button">Exportar PDF</button>
        </a>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Totales del evento (por rubro)</h3>
        {totales.length === 0 ? (
          <p className="texto-suave">Todavía no hay productos cargados en ningún lote.</p>
        ) : (
          totales.map((grupo) => (
            <div key={grupo.rubro} style={{ marginBottom: 12 }}>
              <strong>{grupo.rubro}</strong>
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
              <p className="texto-suave">Subtotal {grupo.rubro}: {grupo.subtotal} unidades</p>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lotes</h3>
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
