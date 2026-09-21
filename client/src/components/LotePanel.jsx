import { useState } from 'react';
import { api } from '../api/client';
import { PresupuestoPanel } from './PresupuestoPanel';
import { useAuth } from '../context/AuthContext';

export function LotePanel({ lote, productos, onCambiado }) {
  const { puedeEscribir } = useAuth();
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [editado, setEditado] = useState({ codigo: lote.codigo, expositor: lote.expositor || '', contacto: lote.contacto || '' });
  const [nuevoPresupuesto, setNuevoPresupuesto] = useState({ numero: '', fecha: '', cliente_nombre: '', cliente_contacto: '', condiciones_pago: '', monto_total: '', notas: '' });
  const [mostrarForm, setMostrarForm] = useState(false);

  async function guardarEdicionLote() {
    setError('');
    try {
      await api.put(`/lotes/${lote.id}`, editado);
      setEditando(false);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  async function borrarLote() {
    if (!confirm(`¿Borrar el lote "${lote.codigo}" y todos sus presupuestos?`)) return;
    await api.del(`/lotes/${lote.id}`);
    onCambiado();
  }

  async function crearPresupuesto(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/lotes/${lote.id}/presupuestos`, nuevoPresupuesto);
      setNuevoPresupuesto({ numero: '', fecha: '', cliente_nombre: '', cliente_contacto: '', condiciones_pago: '', monto_total: '', notas: '' });
      setMostrarForm(false);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card lote-card">
      {error && <div className="aviso error">{error}</div>}
      {editando ? (
        <div className="toolbar">
          <input
            value={editado.codigo}
            onChange={(e) => setEditado({ ...editado, codigo: e.target.value })}
          />
          <input
            placeholder="Expositor"
            value={editado.expositor}
            onChange={(e) => setEditado({ ...editado, expositor: e.target.value })}
          />
          <input
            placeholder="Contacto"
            value={editado.contacto}
            onChange={(e) => setEditado({ ...editado, contacto: e.target.value })}
          />
          <button className="primario" onClick={guardarEdicionLote}>
            Guardar
          </button>
          <button onClick={() => setEditando(false)}>Cancelar</button>
        </div>
      ) : (
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <strong>
            Lote: {lote.codigo}
            {lote.expositor && <span className="texto-suave"> — {lote.expositor}</span>}
            {lote.contacto && <span className="texto-suave"> ({lote.contacto})</span>}
          </strong>
          {puedeEscribir && (
            <div className="acciones-fila">
              <button onClick={() => setEditando(true)}>Editar lote</button>
              <button className="peligro" onClick={borrarLote}>
                Borrar lote
              </button>
            </div>
          )}
        </div>
      )}

      {puedeEscribir && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo presupuesto'}
          </button>
        </div>
      )}

      {puedeEscribir && mostrarForm && (
        <form onSubmit={crearPresupuesto} className="form-grid" style={{ marginTop: 12 }}>
          <div className="campo">
            <label>Número</label>
            <input value={nuevoPresupuesto.numero} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, numero: e.target.value })} />
          </div>
          <div className="campo">
            <label>Fecha</label>
            <input type="date" value={nuevoPresupuesto.fecha} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, fecha: e.target.value })} />
          </div>
          <div className="campo">
            <label>Cliente</label>
            <input value={nuevoPresupuesto.cliente_nombre} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, cliente_nombre: e.target.value })} />
          </div>
          <div className="campo">
            <label>Contacto</label>
            <input value={nuevoPresupuesto.cliente_contacto} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, cliente_contacto: e.target.value })} />
          </div>
          <div className="campo">
            <label>Condiciones de pago</label>
            <input value={nuevoPresupuesto.condiciones_pago} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, condiciones_pago: e.target.value })} />
          </div>
          <div className="campo">
            <label>Monto total</label>
            <div className="input-moneda">
              <input type="number" step="0.01" value={nuevoPresupuesto.monto_total} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, monto_total: e.target.value })} />
            </div>
          </div>
          <div className="campo" style={{ gridColumn: '1 / -1' }}>
            <label>Notas</label>
            <input value={nuevoPresupuesto.notas} onChange={(e) => setNuevoPresupuesto({ ...nuevoPresupuesto, notas: e.target.value })} />
          </div>
          <button type="submit" className="primario">
            Crear presupuesto
          </button>
        </form>
      )}

      <div style={{ marginTop: 12 }}>
        {lote.presupuestos.length === 0 ? (
          <p className="texto-suave">Este lote todavía no tiene presupuestos.</p>
        ) : (
          lote.presupuestos.map((presupuesto) => (
            <PresupuestoPanel key={presupuesto.id} presupuesto={presupuesto} productos={productos} onCambiado={onCambiado} />
          ))
        )}
      </div>
    </div>
  );
}
