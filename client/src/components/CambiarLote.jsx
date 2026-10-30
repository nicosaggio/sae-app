import { useId, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Icono } from './Icono';

/**
 * Muestra el número de lote de un presupuesto confirmado y deja cambiarlo (la organización del evento a veces
 * renumera los stands). El número es del lote: el cambio vale para todos los presupuestos de ese stand y
 * recalcula su código de facturación.
 */
export function CambiarLote({ presupuesto, onCambiado }) {
  const { puedeEscribir } = useAuth();
  const [editando, setEditando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const idCampo = useId();

  function empezar() {
    setCodigo(presupuesto.lote_codigo);
    setError('');
    setEditando(true);
  }

  async function guardar() {
    if (codigo.trim() === presupuesto.lote_codigo) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await api.put(`/lotes/${presupuesto.lote_id}/codigo`, { codigo });
      setEditando(false);
      onCambiado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="tarjeta" aria-label="Lote">
      <div className="tarjeta-cuerpo">
        <div className="fila fila--entre">
          <div>
            <div className="kpi-etiqueta">Lote (n.º de stand)</div>
            <div className="kpi-valor">{presupuesto.lote_codigo}</div>
          </div>
          {puedeEscribir && !editando && (
            <button type="button" className="boton" onClick={empezar}>
              <Icono nombre="pencil" />
              Cambiar n.º de lote
            </button>
          )}
        </div>
        {puedeEscribir && editando && (
          <div style={{ marginTop: 'var(--s-4)' }}>
            <div className="fila" style={{ alignItems: 'flex-end' }}>
              <div className={`campo${error ? ' campo--error' : ''}`} style={{ width: 200 }}>
                <label htmlFor={idCampo}>Nuevo n.º de lote</label>
                <input
                  id={idCampo}
                  value={codigo}
                  autoFocus
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter guarda y Escape cancela, sin pasar al campo siguiente ni cerrar el panel de atrás
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (codigo.trim() && !guardando) guardar();
                    } else if (e.key === 'Escape') {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                      setEditando(false);
                    }
                  }}
                />
              </div>
              <button type="button" className="boton boton--primario" disabled={guardando || !codigo.trim()} onClick={guardar}>
                Guardar
              </button>
              <button type="button" className="boton" disabled={guardando} onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
            {error && (
              <p className="mensaje mensaje--error" style={{ marginTop: 6 }} role="alert">
                <Icono nombre="warn" />
                <span>{error}</span>
              </p>
            )}
            <p className="ayuda" style={{ marginTop: 8 }}>
              El número es del lote (el stand): vale para <strong>todos sus presupuestos</strong> y también se recalcula su código de facturación.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
