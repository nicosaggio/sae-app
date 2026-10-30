import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ESTADOS_PRESUPUESTO } from '../constants';
import { useAuth } from '../context/AuthContext';
import { fechaCorta, pesos } from '../catalogoFormat';
import { DialogoConfirmar } from './DialogoConfirmar';
import { EstadoCobro } from './EstadoCobro';
import { Icono } from './Icono';

const PRESUPUESTO_VACIO = { numero: '', fecha: '', cliente_nombre: '', cliente_contacto: '', condiciones_pago: '', monto_total: '', notas: '' };

/**
 * Lo que se ve de un lote sin abrirlo: cuántos presupuestos tiene, en qué estado de cobro están y cuánto suman.
 * Los cancelados quedan como registro pero no cuentan (ni en el total ni en el estado). Si los que cuentan están
 * en estados distintos no hay un solo estado para decir: se dice que son varios.
 */
function resumenDeLote(lote) {
  const todos = lote.presupuestos;
  const cuentan = todos.filter((p) => p.estado !== 'cancelado');
  const estados = new Set(cuentan.map((p) => p.estado));
  return {
    cantidad: todos.length,
    total: cuentan.length > 0 ? cuentan.reduce((suma, p) => suma + (Number(p.monto_total) || 0), 0) : null,
    cobro: todos.length === 0 ? null : cuentan.length === 0 ? 'cancelado' : estados.size === 1 ? [...estados][0] : 'varios',
  };
}

/**
 * Un lote (un stand) dentro de la pantalla del evento: cerrado es una fila con su resumen; abierto muestra sus
 * acciones (croquis, editar, nuevo presupuesto, borrar) y la tabla de sus presupuestos, donde se cambia el estado
 * de cobro y se abre el presupuesto. Quién tiene abierto cada lote lo decide la pantalla (`abierto`/`onAlternar`).
 */
export function LoteFila({ lote, eventoId, abierto, onAlternar, onAbrirPresupuesto, onCambiado }) {
  const { puedeEscribir } = useAuth();
  const idDetalle = useId();
  const idEdicion = useId();
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [editado, setEditado] = useState({ codigo: lote.codigo, expositor: lote.expositor || '', contacto: lote.contacto || '' });
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [nuevo, setNuevo] = useState(null); // el formulario de "Nuevo presupuesto" mientras está abierto
  const [errorNuevo, setErrorNuevo] = useState('');
  const resumen = resumenDeLote(lote);

  function empezarEdicion() {
    setEditado({ codigo: lote.codigo, expositor: lote.expositor || '', contacto: lote.contacto || '' });
    setError('');
    setEditando(true);
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    if (!editado.codigo.trim()) return;
    setGuardando(true);
    setError('');
    try {
      await api.put(`/lotes/${lote.id}`, editado);
      setEditando(false);
      onCambiado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrarLote() {
    setBorrando(false);
    try {
      await api.del(`/lotes/${lote.id}`);
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  async function crearPresupuesto() {
    setErrorNuevo('');
    try {
      await api.post(`/lotes/${lote.id}/presupuestos`, nuevo);
      setNuevo(null);
      onCambiado();
    } catch (err) {
      setErrorNuevo(err.message);
    }
  }

  async function cambiarEstado(presupuesto, estado) {
    setError('');
    try {
      await api.patch(`/presupuestos/${presupuesto.id}/estado`, { estado });
      onCambiado();
    } catch (err) {
      setError(err.message);
    }
  }

  const campoNuevo = (clave) => ({ value: nuevo?.[clave] ?? '', onChange: (e) => setNuevo({ ...nuevo, [clave]: e.target.value }) });
  const codigoCambiado = editando && editado.codigo.trim() !== lote.codigo;

  return (
    <div className={`lote-fila${abierto ? ' lote-fila--abierto' : ''}`}>
      <button type="button" className="lote-cab" aria-expanded={abierto} aria-controls={idDetalle} onClick={onAlternar}>
        <Icono nombre="chev-r" className="chevron icono--sm" />
        <span className="lote-cod">{lote.codigo}</span>
        <span className="lote-nombre">
          {lote.expositor ? <strong>{lote.expositor}</strong> : <span style={{ color: 'var(--c-texto-3)' }}>Sin expositor</span>}
          {lote.contacto && <span style={{ color: 'var(--c-texto-2)' }}> · {lote.contacto}</span>}
        </span>
        <span className="lote-cuenta">{resumen.cantidad === 0 ? '' : resumen.cantidad === 1 ? '1 presupuesto' : `${resumen.cantidad} presupuestos`}</span>
        <span className="lote-cobro">
          {resumen.cobro === null ? (
            <span style={{ color: 'var(--c-texto-3)' }}>Sin presupuestos</span>
          ) : resumen.cobro === 'varios' ? (
            <span className="etiqueta">Estados varios</span>
          ) : (
            <EstadoCobro estado={resumen.cobro} />
          )}
        </span>
        <strong className="lote-total">{resumen.total === null ? <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>—</span> : pesos(resumen.total)}</strong>
      </button>

      {abierto && (
        <div className="lote-detalle" id={idDetalle}>
          {error && (
            <div className="aviso aviso--error" role="alert">
              <Icono nombre="warn" />
              <div className="aviso-cuerpo">{error}</div>
            </div>
          )}

          <div className="fila fila--entre">
            <div className="fila" style={{ gap: 'var(--s-2)' }}>
              <Link className="boton boton--sm" to={`/eventos/${eventoId}/lotes/${lote.id}/croquis`}>
                <Icono nombre="ruler" className="icono--sm" />
                {lote.tiene_croquis ? 'Ver croquis' : 'Dibujar croquis'}
              </Link>
              {puedeEscribir && (
                <>
                  <button type="button" className="boton boton--sm" onClick={empezarEdicion} aria-expanded={editando} aria-controls={idEdicion}>
                    <Icono nombre="pencil" className="icono--sm" />
                    Editar lote
                  </button>
                  <button
                    type="button"
                    className="boton boton--sm"
                    onClick={() => {
                      setErrorNuevo('');
                      setNuevo({ ...PRESUPUESTO_VACIO });
                    }}
                  >
                    <Icono nombre="plus" className="icono--sm" />
                    Nuevo presupuesto
                  </button>
                </>
              )}
            </div>
            {puedeEscribir && (
              <button type="button" className="boton boton--sm boton--peligro-suave" onClick={() => setBorrando(true)}>
                <Icono nombre="trash" className="icono--sm" />
                Borrar lote
              </button>
            )}
          </div>

          {puedeEscribir && editando && (
            <form className="lote-edicion" id={idEdicion} onSubmit={guardarEdicion}>
              <div className="fila" style={{ alignItems: 'flex-end' }}>
                <div className="campo" style={{ width: 160 }}>
                  <label htmlFor={`${idEdicion}-codigo`}>Código</label>
                  <input id={`${idEdicion}-codigo`} value={editado.codigo} autoFocus onChange={(e) => setEditado({ ...editado, codigo: e.target.value })} />
                </div>
                <div className="campo" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor={`${idEdicion}-expositor`}>Expositor</label>
                  <input id={`${idEdicion}-expositor`} value={editado.expositor} onChange={(e) => setEditado({ ...editado, expositor: e.target.value })} />
                </div>
                <div className="campo" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor={`${idEdicion}-contacto`}>Contacto</label>
                  <input id={`${idEdicion}-contacto`} value={editado.contacto} onChange={(e) => setEditado({ ...editado, contacto: e.target.value })} />
                </div>
                <button type="submit" className="boton boton--primario" disabled={guardando || !editado.codigo.trim()}>
                  Guardar
                </button>
                <button type="button" className="boton" disabled={guardando} onClick={() => setEditando(false)}>
                  Cancelar
                </button>
              </div>
              {codigoCambiado && (
                <p className="mensaje mensaje--info" style={{ marginTop: 8 }}>
                  <Icono nombre="info" />
                  <span>Al guardar, el número nuevo también pasa a los presupuestos de este lote cargados desde la app, y se recalcula su código de facturación.</span>
                </p>
              )}
            </form>
          )}

          {lote.presupuestos.length === 0 ? (
            <p className="sub">Este lote todavía no tiene presupuestos.</p>
          ) : (
            <div className="tabla-scroll">
              <table className="tabla tabla--panel">
                <thead>
                  <tr>
                    <th>N.º</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th className="num">Monto total</th>
                    <th>Estado de cobro</th>
                    <th>
                      <span className="solo-lectores">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lote.presupuestos.map((p) => (
                    <tr key={p.id}>
                      <td>{p.numero || '—'}</td>
                      <td className="nw">{fechaCorta(p.fecha)}</td>
                      <td className={p.estado === 'cancelado' ? 'tachado' : undefined}>
                        {p.cliente_nombre || '—'}
                        {p.cliente_contacto && <span className="sub">{p.cliente_contacto}</span>}
                      </td>
                      <td className="num">{p.monto_total === null || p.monto_total === undefined ? '—' : pesos(p.monto_total)}</td>
                      <td>
                        <div className="campo" style={{ width: 190 }}>
                          <select aria-label={`Estado de cobro del presupuesto ${p.numero || ''} del lote ${lote.codigo}`.replace('  ', ' ')} value={p.estado} onChange={(e) => cambiarEstado(p, e.target.value)}>
                            {ESTADOS_PRESUPUESTO.map((estado) => (
                              <option key={estado.value} value={estado.value}>
                                {estado.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="acciones">
                        <button type="button" className="boton boton--sm" onClick={() => onAbrirPresupuesto(p, lote)}>
                          Abrir presupuesto
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {borrando && (
        <DialogoConfirmar titulo={`¿Borrar el lote ${lote.codigo}?`} textoConfirmar="Sí, borrar el lote" textoCancelar="No, volver" peligro ancho={460} onConfirmar={borrarLote} onCancelar={() => setBorrando(false)}>
          <p>
            {resumen.cantidad === 0 ? (
              <>Se borra el lote. </>
            ) : (
              <>
                Se borran el lote y <strong>{resumen.cantidad === 1 ? '1 presupuesto con todas sus líneas' : `${resumen.cantidad} presupuestos con todas sus líneas`}</strong>.{' '}
              </>
            )}
            <strong>No se puede deshacer.</strong>
          </p>
        </DialogoConfirmar>
      )}

      {nuevo && (
        <DialogoConfirmar
          titulo="Nuevo presupuesto"
          subtitulo={`Lote ${lote.codigo}${lote.expositor ? ` — ${lote.expositor}` : ''}`}
          textoConfirmar="Crear presupuesto"
          ancho={640}
          foco="primero"
          formulario
          onConfirmar={crearPresupuesto}
          onCancelar={() => setNuevo(null)}
        >
          <div className="pila">
            <div className="grid grid-2">
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-numero`}>Número</label>
                <input id={`${idEdicion}-np-numero`} {...campoNuevo('numero')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-fecha`}>Fecha</label>
                <input id={`${idEdicion}-np-fecha`} type="date" {...campoNuevo('fecha')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-cliente`}>Cliente</label>
                <input id={`${idEdicion}-np-cliente`} {...campoNuevo('cliente_nombre')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-contacto`}>Contacto</label>
                <input id={`${idEdicion}-np-contacto`} {...campoNuevo('cliente_contacto')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-condiciones`}>Condiciones de pago</label>
                <input id={`${idEdicion}-np-condiciones`} {...campoNuevo('condiciones_pago')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idEdicion}-np-monto`}>Monto total</label>
                <div className="entrada-moneda">
                  <input id={`${idEdicion}-np-monto`} type="number" step="0.01" {...campoNuevo('monto_total')} />
                </div>
              </div>
              <div className="campo span-2">
                <label htmlFor={`${idEdicion}-np-notas`}>Notas</label>
                <input id={`${idEdicion}-np-notas`} {...campoNuevo('notas')} />
              </div>
            </div>
            {errorNuevo && (
              <p className="mensaje mensaje--error" role="alert">
                <Icono nombre="warn" />
                <span>{errorNuevo}</span>
              </p>
            )}
          </div>
        </DialogoConfirmar>
      )}
    </div>
  );
}
