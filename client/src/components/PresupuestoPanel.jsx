import { useId, useRef, useState } from 'react';
import { api } from '../api/client';
import { ESTADOS_PRESUPUESTO } from '../constants';
import { BuscadorProducto } from './BuscadorProducto';
import { DialogoConfirmar } from './DialogoConfirmar';
import { Icono } from './Icono';
import { useAuth } from '../context/AuthContext';
import { pesos } from '../catalogoFormat';

/**
 * Un presupuesto confirmado: sus datos (se guardan solos al salir de cada campo), sus productos y el botón de
 * borrarlo. Un usuario "solo estado" sólo puede cambiar el estado de cobro. `onCambiado` avisa que cambió la
 * estructura (se agregó o quitó una línea, se borró) y hay que volver a leerlo; `onGuardado` (opcional), que se
 * guardó un dato suelto.
 */
export function PresupuestoPanel({ presupuesto, productos, onCambiado, onGuardado }) {
  const { puedeEscribir } = useAuth();
  const [datos, setDatos] = useState(presupuesto);
  const guardadoRef = useRef(presupuesto); // lo último que quedó guardado: sólo se guarda lo que cambió de verdad
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState('inactivo'); // inactivo | guardando | ok
  const [nuevaLinea, setNuevaLinea] = useState({ producto_id: null, cantidad: '', comentario: '', precio_unitario: '' });
  const [editandoLineaId, setEditandoLineaId] = useState(null);
  const [cantidadEditada, setCantidadEditada] = useState('');
  const [comentarioEditado, setComentarioEditado] = useState('');
  const [precioEditado, setPrecioEditado] = useState('');
  const [dialogo, setDialogo] = useState(null); // la pregunta abierta: { tipo: 'borrar' } o { tipo: 'linea', linea }
  const idp = useId();

  async function guardarCampo(campos) {
    const hayCambios = Object.keys(campos).some((k) => String(campos[k] ?? '') !== String(guardadoRef.current[k] ?? ''));
    if (!hayCambios) return;
    setError('');
    setGuardado('guardando');
    try {
      await api.put(`/presupuestos/${presupuesto.id}`, { ...datos, ...campos });
      setDatos((d) => ({ ...d, ...campos }));
      guardadoRef.current = { ...guardadoRef.current, ...campos };
      setGuardado('ok');
      onGuardado?.();
    } catch (err) {
      setError(err.message);
      setGuardado('inactivo');
    }
  }

  async function cambiarEstado(estado) {
    setError('');
    setGuardado('guardando');
    try {
      await api.patch(`/presupuestos/${presupuesto.id}/estado`, { estado });
      setDatos((d) => ({ ...d, estado }));
      guardadoRef.current = { ...guardadoRef.current, estado };
      setGuardado('ok');
      onGuardado?.();
    } catch (err) {
      setError(err.message);
      setGuardado('inactivo');
    }
  }

  async function borrarPresupuesto() {
    setDialogo(null);
    try {
      await api.del(`/presupuestos/${presupuesto.id}`);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
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

  async function quitarLinea() {
    const { linea } = dialogo;
    setDialogo(null);
    try {
      await api.del(`/presupuesto-lineas/${linea.id}`);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  // Cada campo de texto se guarda al salir de él (si cambió)
  const campoTexto = (clave) => ({
    value: datos[clave] ?? '',
    disabled: !puedeEscribir,
    onChange: (e) => setDatos({ ...datos, [clave]: e.target.value }),
    onBlur: (e) => guardarCampo({ [clave]: e.target.value }),
  });

  const lineas = presupuesto.lineas;
  const textoGuardado =
    guardado === 'guardando' ? 'Guardando…' : guardado === 'ok' ? 'Guardado ✓' : puedeEscribir ? 'Se guarda al salir de cada campo' : 'Tu usuario sólo puede cambiar el estado de cobro';

  return (
    <div className="ed">
      <div className="pila pila--grande">
        {error && (
          <div className="aviso aviso--error" role="alert">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">{error}</div>
          </div>
        )}
        {datos.origen === 'excel' && (
          <div className="fila">
            <span className="etiqueta">Importado de Excel</span>
            {!datos.archivo_activo && (
              <span className="mensaje mensaje--aviso" style={{ fontSize: 'var(--t-sm)' }}>
                <Icono nombre="warn" />
                El archivo de origen ya no está en la carpeta. El presupuesto sigue cargado en la app.
              </span>
            )}
          </div>
        )}

        <section className="tarjeta" aria-labelledby={`${idp}-datos`}>
          <div className="tarjeta-cab">
            <h2 id={`${idp}-datos`}>Datos del presupuesto</h2>
            <span className={`ayuda${guardado === 'ok' ? ' ayuda--ok' : ''}`} role="status">
              {textoGuardado}
            </span>
          </div>
          <div className="tarjeta-cuerpo grid grid-3">
            <div className="campo">
              <label htmlFor={`${idp}-numero`}>Número</label>
              <input id={`${idp}-numero`} {...campoTexto('numero')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idp}-fecha`}>Fecha</label>
              <input id={`${idp}-fecha`} type="date" {...campoTexto('fecha')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idp}-estado`}>Estado de cobro</label>
              <select id={`${idp}-estado`} value={datos.estado} onChange={(e) => cambiarEstado(e.target.value)}>
                {ESTADOS_PRESUPUESTO.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`${idp}-cliente`}>Cliente</label>
              <input id={`${idp}-cliente`} {...campoTexto('cliente_nombre')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idp}-contacto`}>Contacto</label>
              <input id={`${idp}-contacto`} {...campoTexto('cliente_contacto')} />
            </div>
            <div className="campo">
              <label htmlFor={`${idp}-monto`}>Monto total (con IVA)</label>
              <div className="entrada-moneda">
                <input id={`${idp}-monto`} type="number" step="0.01" {...campoTexto('monto_total')} />
              </div>
            </div>
            <div className="campo span-2">
              <label htmlFor={`${idp}-condiciones`}>Condiciones de pago</label>
              <input id={`${idp}-condiciones`} {...campoTexto('condiciones_pago')} />
            </div>
            <div className="campo">
              <span className="campo-etiqueta">Confirmado</span>
              <label className="check" style={{ height: 'var(--alto-control)' }}>
                <input type="checkbox" checked={!!datos.confirmado} disabled={!puedeEscribir} onChange={(e) => guardarCampo({ confirmado: e.target.checked })} />
                Presupuesto confirmado
              </label>
            </div>
            <div className="campo span-todo">
              <label htmlFor={`${idp}-notas`}>Notas</label>
              <input id={`${idp}-notas`} {...campoTexto('notas')} />
            </div>
          </div>
        </section>

        <section className="tarjeta" aria-labelledby={`${idp}-productos`}>
          <div className="tarjeta-cab">
            <h2 id={`${idp}-productos`}>Productos</h2>
            <span className="sub">{lineas.length === 1 ? '1 línea' : `${lineas.length} líneas`}</span>
          </div>
          {puedeEscribir && (
            <form className="tarjeta-cuerpo" style={{ borderBottom: '1px solid var(--c-borde)' }} onSubmit={agregarLinea}>
              <div className="fila" style={{ alignItems: 'flex-end' }}>
                <div className="campo" style={{ flex: 1, minWidth: 170 }}>
                  <label htmlFor={`${idp}-producto`}>Agregar producto</label>
                  <BuscadorProducto id={`${idp}-producto`} productos={productos} value={nuevaLinea.producto_id} onChange={(id) => setNuevaLinea({ ...nuevaLinea, producto_id: id })} />
                </div>
                <div className="campo" style={{ width: 90 }}>
                  <label htmlFor={`${idp}-cantidad`}>Cantidad</label>
                  <input id={`${idp}-cantidad`} type="number" min="1" required value={nuevaLinea.cantidad} onChange={(e) => setNuevaLinea({ ...nuevaLinea, cantidad: e.target.value })} />
                </div>
                <div className="campo" style={{ width: 140 }}>
                  <label htmlFor={`${idp}-precio`}>
                    Precio unit. <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                  </label>
                  <div className="entrada-moneda">
                    <input id={`${idp}-precio`} type="number" step="0.01" min="0" value={nuevaLinea.precio_unitario} onChange={(e) => setNuevaLinea({ ...nuevaLinea, precio_unitario: e.target.value })} />
                  </div>
                </div>
                <div className="campo" style={{ width: 170 }}>
                  <label htmlFor={`${idp}-comentario`}>
                    Comentario <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(opcional)</span>
                  </label>
                  <input id={`${idp}-comentario`} value={nuevaLinea.comentario} onChange={(e) => setNuevaLinea({ ...nuevaLinea, comentario: e.target.value })} />
                </div>
                <button type="submit" className="boton boton--primario" disabled={!nuevaLinea.producto_id || !nuevaLinea.cantidad}>
                  <Icono nombre="plus" />
                  Agregar
                </button>
              </div>
            </form>
          )}
          {lineas.length === 0 ? (
            <div className="vacio">
              <span className="icono-vacio">
                <Icono nombre="list" className="icono--lg" />
              </span>
              <h3>Sin productos todavía</h3>
              {puedeEscribir && <p>Buscá un producto, elegí la cantidad y agregalo.</p>}
            </div>
          ) : (
            <div className="tabla-scroll">
              <table className="tabla tabla--panel">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Rubro</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Precio unitario</th>
                    <th>Comentario</th>
                    <th>
                      <span className="solo-lectores">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((linea) => {
                    const editando = editandoLineaId === linea.id;
                    return (
                      <tr key={linea.id}>
                        <td>
                          {linea.producto_codigo && <strong className="codigo">{linea.producto_codigo}</strong>}
                          <span className={linea.producto_codigo ? 'sub' : undefined}>{linea.producto_nombre}</span>
                        </td>
                        <td>{linea.rubro ? <span className="etiqueta">{linea.rubro}</span> : <span style={{ color: 'var(--c-texto-3)' }}>—</span>}</td>
                        <td className="num">
                          {editando ? (
                            <input
                              className="input-tabla input-cantidad"
                              aria-label={`Cantidad de ${linea.producto_nombre}`}
                              type="number"
                              min="1"
                              value={cantidadEditada}
                              onChange={(e) => setCantidadEditada(e.target.value)}
                            />
                          ) : (
                            linea.cantidad
                          )}
                        </td>
                        <td className="num">
                          {editando ? (
                            <input
                              className="input-tabla"
                              aria-label={`Precio unitario de ${linea.producto_nombre}`}
                              type="number"
                              step="0.01"
                              min="0"
                              value={precioEditado}
                              onChange={(e) => setPrecioEditado(e.target.value)}
                            />
                          ) : linea.precio_unitario != null ? (
                            pesos(linea.precio_unitario)
                          ) : (
                            <span style={{ color: 'var(--c-texto-3)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {editando ? (
                            <input
                              className="comentario-linea"
                              style={{ margin: 0 }}
                              aria-label={`Comentario de ${linea.producto_nombre}`}
                              placeholder="Comentario (opcional)"
                              value={comentarioEditado}
                              onChange={(e) => setComentarioEditado(e.target.value)}
                            />
                          ) : linea.comentario ? (
                            linea.comentario
                          ) : (
                            <span style={{ color: 'var(--c-texto-3)' }}>—</span>
                          )}
                        </td>
                        <td className="acciones">
                          {!puedeEscribir ? null : editando ? (
                            <>
                              <button type="button" className="boton boton--sm boton--primario" onClick={() => guardarEdicionLinea(linea)}>
                                Guardar
                              </button>{' '}
                              <button type="button" className="boton boton--sm" onClick={() => setEditandoLineaId(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="boton boton--sm boton--suave" onClick={() => iniciarEdicionLinea(linea)}>
                                Editar
                              </button>
                              <button type="button" className="boton boton--sm boton--peligro-suave" onClick={() => setDialogo({ tipo: 'linea', linea })}>
                                Quitar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {puedeEscribir && (
          <div>
            <button type="button" className="boton boton--peligro-suave" onClick={() => setDialogo({ tipo: 'borrar' })}>
              <Icono nombre="trash" />
              Borrar presupuesto
            </button>
          </div>
        )}
      </div>

      {dialogo?.tipo === 'borrar' && (
        <DialogoConfirmar titulo="¿Borrar este presupuesto?" textoConfirmar="Sí, borrar" textoCancelar="No, volver" peligro onConfirmar={borrarPresupuesto} onCancelar={() => setDialogo(null)}>
          <p>
            Se borran el presupuesto y todas sus líneas. <strong>No se puede deshacer.</strong>
          </p>
        </DialogoConfirmar>
      )}
      {dialogo?.tipo === 'linea' && (
        <DialogoConfirmar titulo="¿Quitar el producto?" textoConfirmar="Sí, quitar" textoCancelar="No, volver" peligro onConfirmar={quitarLinea} onCancelar={() => setDialogo(null)}>
          <p>
            Se quita <strong>{dialogo.linea.producto_nombre}</strong> de este presupuesto.
          </p>
        </DialogoConfirmar>
      )}
    </div>
  );
}
