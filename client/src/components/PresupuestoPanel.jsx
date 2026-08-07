import { useState } from 'react';
import { api } from '../api/client';
import { ESTADOS_PRESUPUESTO } from '../constants';
import { BuscadorProducto } from './BuscadorProducto';
import { useAuth } from '../context/AuthContext';

export function PresupuestoPanel({ presupuesto, productos, onCambiado }) {
  const { puedeEscribir } = useAuth();
  const [datos, setDatos] = useState(presupuesto);
  const [error, setError] = useState('');
  const [nuevaLinea, setNuevaLinea] = useState({ producto_id: null, cantidad: '', comentario: '', precio_unitario: '' });
  const [editandoLineaId, setEditandoLineaId] = useState(null);
  const [cantidadEditada, setCantidadEditada] = useState('');
  const [comentarioEditado, setComentarioEditado] = useState('');
  const [precioEditado, setPrecioEditado] = useState('');

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
        precio_unitario: nuevaLinea.precio_unitario || null,
      });
      setNuevaLinea({ producto_id: null, cantidad: '', comentario: '', precio_unitario: '' });
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  function iniciarEdicionLinea(linea) {
    setEditandoLineaId(linea.id);
    setCantidadEditada(linea.cantidad);
    setComentarioEditado(linea.comentario || '');
    setPrecioEditado(linea.precio_unitario ?? '');
  }

  async function guardarEdicionLinea(linea) {
    setError('');
    try {
      await api.put(`/presupuesto-lineas/${linea.id}`, {
        cantidad: Number(cantidadEditada),
        comentario: comentarioEditado || null,
        precio_unitario: precioEditado === '' ? null : Number(precioEditado),
      });
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
            disabled={!puedeEscribir}
            onChange={(e) => setDatos({ ...datos, numero: e.target.value })}
            onBlur={(e) => guardarCampo({ numero: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Fecha</label>
          <input
            type="date"
            value={datos.fecha || ''}
            disabled={!puedeEscribir}
            onChange={(e) => setDatos({ ...datos, fecha: e.target.value })}
            onBlur={(e) => guardarCampo({ fecha: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Cliente</label>
          <input
            value={datos.cliente_nombre || ''}
            disabled={!puedeEscribir}
            onChange={(e) => setDatos({ ...datos, cliente_nombre: e.target.value })}
            onBlur={(e) => guardarCampo({ cliente_nombre: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Contacto</label>
          <input
            value={datos.cliente_contacto || ''}
            disabled={!puedeEscribir}
            onChange={(e) => setDatos({ ...datos, cliente_contacto: e.target.value })}
            onBlur={(e) => guardarCampo({ cliente_contacto: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Condiciones de pago</label>
          <input
            value={datos.condiciones_pago || ''}
            disabled={!puedeEscribir}
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
            disabled={!puedeEscribir}
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
              disabled={!puedeEscribir}
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
          disabled={!puedeEscribir}
          onChange={(e) => setDatos({ ...datos, notas: e.target.value })}
          onBlur={(e) => guardarCampo({ notas: e.target.value })}
        />
      </div>

      {puedeEscribir && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
          <button className="peligro" onClick={borrarPresupuesto}>
            Borrar presupuesto
          </button>
        </div>
      )}

      {puedeEscribir && (
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
            type="number"
            step="0.01"
            min="0"
            placeholder="Precio unitario (opcional)"
            style={{ width: 160 }}
            value={nuevaLinea.precio_unitario}
            onChange={(e) => setNuevaLinea({ ...nuevaLinea, precio_unitario: e.target.value })}
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
      )}

      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Rubro</th>
            <th>Cantidad</th>
            <th>Precio unitario</th>
            <th>Comentario</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {presupuesto.lineas.length === 0 && (
            <tr>
              <td colSpan={6} className="texto-suave">
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
              <td className={linea.precio_unitario != null ? '' : 'texto-suave'}>
                {editandoLineaId === linea.id ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 110 }}
                    value={precioEditado}
                    onChange={(e) => setPrecioEditado(e.target.value)}
                  />
                ) : linea.precio_unitario != null ? (
                  linea.precio_unitario
                ) : (
                  '—'
                )}
              </td>
              <td className={linea.comentario ? '' : 'texto-suave'}>
                {editandoLineaId === linea.id ? (
                  <input
                    placeholder="Comentario (opcional)"
                    style={{ width: 180 }}
                    value={comentarioEditado}
                    onChange={(e) => setComentarioEditado(e.target.value)}
                  />
                ) : (
                  linea.comentario || '—'
                )}
              </td>
              <td className="acciones-fila">
                {!puedeEscribir ? null : editandoLineaId === linea.id ? (
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
