import { useState } from 'react';
import { api } from '../api/client';
import { ESTADOS_PRESUPUESTO } from '../constants';
import { BuscadorProducto } from './BuscadorProducto';

export function PresupuestoPanel({ presupuesto, productos, onCambiado }) {
  const [datos, setDatos] = useState(presupuesto);
  const [error, setError] = useState('');
  const [nuevaLinea, setNuevaLinea] = useState({ producto_id: null, cantidad: '', comentario: '' });
  const [editandoLineaId, setEditandoLineaId] = useState(null);
  const [cantidadEditada, setCantidadEditada] = useState('');

  async function guardarCampo(campos) {
    setError('');
    try {
      await api.put(`/presupuestos/${presupuesto.id}`, { ...datos, ...campos });
      setDatos({ ...datos, ...campos });
    } catch (err) {
      setError(err.message);
    }
  }

  async function cambiarEstado(estado) {
    setError('');
    try {
      await api.patch(`/presupuestos/${presupuesto.id}/estado`, { estado });
      setDatos({ ...datos, estado });
    } catch (err) {
      setError(err.message);
    }
  }

  async function borrarPresupuesto() {
    if (!confirm('¿Borrar este presupuesto y todas sus líneas?')) return;
    await api.del(`/presupuestos/${presupuesto.id}`);
    onCambiado();
  }

  async function agregarLinea(e) {
    e.preventDefault();
    setError('');
    if (!nuevaLinea.producto_id || !nuevaLinea.cantidad) return;
    try {
      await api.post(`/presupuestos/${presupuesto.id}/lineas`, {
        producto_id: Number(nuevaLinea.producto_id),
        cantidad: Number(nuevaLinea.cantidad),
        comentario: nuevaLinea.comentario || null,
      });
      setNuevaLinea({ producto_id: null, cantidad: '', comentario: '' });
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  function iniciarEdicionLinea(linea) {
    setEditandoLineaId(linea.id);
    setCantidadEditada(linea.cantidad);
  }

  async function guardarEdicionLinea(linea) {
    setError('');
    try {
      await api.put(`/presupuesto-lineas/${linea.id}`, { cantidad: Number(cantidadEditada) });
      setEditandoLineaId(null);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  async function borrarLinea(linea) {
    if (!confirm(`¿Quitar "${linea.producto_nombre}" de este presupuesto?`)) return;
    await api.del(`/presupuesto-lineas/${linea.id}`);
    onCambiado();
  }

  return (
    <div className="presupuesto-card">
      {error && <div className="aviso error">{error}</div>}
      {datos.origen === 'excel' && (
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <span className="badge tipo">Importado de Excel</span>
          {!datos.archivo_activo && (
            <span className="badge" style={{ background: 'var(--color-peligro-fondo)', color: 'var(--color-peligro)' }}>
              El archivo de origen ya no está en la carpeta
            </span>
          )}
        </div>
      )}
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <div className="campo">
          <label>Número</label>
          <input
            value={datos.numero || ''}
            onChange={(e) => setDatos({ ...datos, numero: e.target.value })}
            onBlur={(e) => guardarCampo({ numero: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Fecha</label>
          <input
            type="date"
            value={datos.fecha || ''}
            onChange={(e) => setDatos({ ...datos, fecha: e.target.value })}
            onBlur={(e) => guardarCampo({ fecha: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Cliente</label>
          <input
            value={datos.cliente_nombre || ''}
            onChange={(e) => setDatos({ ...datos, cliente_nombre: e.target.value })}
            onBlur={(e) => guardarCampo({ cliente_nombre: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Contacto</label>
          <input
            value={datos.cliente_contacto || ''}
            onChange={(e) => setDatos({ ...datos, cliente_contacto: e.target.value })}
            onBlur={(e) => guardarCampo({ cliente_contacto: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Condiciones de pago</label>
          <input
            value={datos.condiciones_pago || ''}
            onChange={(e) => setDatos({ ...datos, condiciones_pago: e.target.value })}
            onBlur={(e) => guardarCampo({ condiciones_pago: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Monto total</label>
          <input
            type="number"
            step="0.01"
            value={datos.monto_total ?? ''}
            onChange={(e) => setDatos({ ...datos, monto_total: e.target.value })}
            onBlur={(e) => guardarCampo({ monto_total: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Estado</label>
          <select value={datos.estado} onChange={(e) => cambiarEstado(e.target.value)}>
            {ESTADOS_PRESUPUESTO.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label>Confirmado</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={!!datos.confirmado}
              onChange={(e) => guardarCampo({ confirmado: e.target.checked })}
            />
            Presupuesto confirmado
          </label>
        </div>
      </div>
      <div className="campo" style={{ marginTop: 8 }}>
        <label>Notas</label>
        <input
          value={datos.notas || ''}
          onChange={(e) => setDatos({ ...datos, notas: e.target.value })}
          onBlur={(e) => guardarCampo({ notas: e.target.value })}
        />
      </div>

      <div className="toolbar" style={{ marginTop: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
        <button className="peligro" onClick={borrarPresupuesto}>
          Borrar presupuesto
        </button>
      </div>

      <form onSubmit={agregarLinea} className="toolbar">
        <BuscadorProducto
          productos={productos}
          value={nuevaLinea.producto_id}
          onChange={(id) => setNuevaLinea({ ...nuevaLinea, producto_id: id })}
        />
        <input
          type="number"
          min="1"
          placeholder="Cantidad"
          style={{ width: 100 }}
          required
          value={nuevaLinea.cantidad}
          onChange={(e) => setNuevaLinea({ ...nuevaLinea, cantidad: e.target.value })}
        />
        <input
          placeholder="Comentario (opcional)"
          style={{ width: 200 }}
          value={nuevaLinea.comentario}
          onChange={(e) => setNuevaLinea({ ...nuevaLinea, comentario: e.target.value })}
        />
        <button type="submit" className="primario" disabled={!nuevaLinea.producto_id || !nuevaLinea.cantidad}>
          Agregar producto
        </button>
      </form>

      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Rubro</th>
            <th>Cantidad</th>
            <th>Comentario</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {presupuesto.lineas.length === 0 && (
            <tr>
              <td colSpan={5} className="texto-suave">
                Sin productos todavía.
              </td>
            </tr>
          )}
          {presupuesto.lineas.map((linea) => (
            <tr key={linea.id}>
              <td>{linea.producto_nombre}</td>
              <td className="texto-suave">{linea.rubro || '—'}</td>
              <td>
                {editandoLineaId === linea.id ? (
                  <input
                    type="number"
                    min="1"
                    style={{ width: 80 }}
                    value={cantidadEditada}
                    onChange={(e) => setCantidadEditada(e.target.value)}
                  />
                ) : (
                  linea.cantidad
                )}
              </td>
              <td className="texto-suave">{linea.comentario || '—'}</td>
              <td className="acciones-fila">
                {editandoLineaId === linea.id ? (
                  <>
                    <button className="primario" onClick={() => guardarEdicionLinea(linea)}>
                      Guardar
                    </button>
                    <button onClick={() => setEditandoLineaId(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => iniciarEdicionLinea(linea)}>Editar</button>
                    <button className="peligro" onClick={() => borrarLinea(linea)}>
                      Quitar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
