import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { FichaCatalogo, corridasDeFicha } from './FichaCatalogo';
import { catalogoApi } from '../api/catalogoApi';
import { ETIQUETA_TIPO_REGLA, fraccionATexto, pesos, textoAFraccion, urlImagen } from '../catalogoFormat';

const TIPOS = ['base', 'derivado', 'manual', 'proporcional', 'razon', 'sin_precio'];
const aTexto = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const aNumero = (t) => (String(t).trim() === '' ? null : Number(String(t).trim().replace(',', '.')));

const REGLA_VACIA = { tipo: 'sin_precio', codigo_base: '', ref: '', ref2: '', ref3: '', factor: '', num: '', den: '', valor: '', suma_adicional_pie: false };

function formularioDeItem(item) {
  return {
    codigo: item.codigo,
    rubro: item.rubro || '',
    descripcion: item.descripcion || '',
    unidad: item.unidad || '',
    porcentaje: fraccionATexto(item.porcentaje),
    activo: item.activo === 1,
    regla: {
      tipo: item.regla.tipo,
      codigo_base: item.regla.codigo_base || '',
      ref: item.regla.ref || '',
      ref2: item.regla.ref2 || '',
      ref3: item.regla.ref3 || '',
      factor: aTexto(item.regla.factor),
      num: aTexto(item.regla.num),
      den: aTexto(item.regla.den),
      valor: aTexto(item.regla.valor),
      suma_adicional_pie: item.regla.suma_adicional_pie,
    },
    titulo: item.ficha.titulo,
    detalle: item.ficha.detalle,
  };
}

function armarRegla(r) {
  switch (r.tipo) {
    case 'base':
      return { tipo: 'base', codigo_base: r.codigo_base.trim() || null, factor: aNumero(r.factor) };
    case 'derivado':
      return { tipo: 'derivado', ref: r.ref.trim(), factor: aNumero(r.factor) };
    case 'manual':
      return { tipo: 'manual', valor: aNumero(r.valor), suma_adicional_pie: r.suma_adicional_pie };
    case 'proporcional':
      return { tipo: 'proporcional', ref: r.ref.trim(), num: aNumero(r.num), den: aNumero(r.den) };
    case 'razon':
      return { tipo: 'razon', ref: r.ref.trim(), ref2: r.ref2.trim(), ref3: r.ref3.trim() };
    default:
      return { tipo: 'sin_precio' };
  }
}

function Campo({ etiqueta, children, ancho }) {
  return (
    <div className="campo" style={ancho ? { minWidth: ancho } : undefined}>
      <label>{etiqueta}</label>
      {children}
    </div>
  );
}

/**
 * Ficha completa de un ítem del catálogo: datos, regla de precio, ficha impresa, foto y dependencias.
 * Con itemId = null crea un ítem nuevo.
 */
export function ItemCatalogoModal({ itemId, codigos, onClose, onCambio, onAbrirOtro, puedeEscribir }) {
  const nuevo = itemId === null;
  const [item, setItem] = useState(null);
  const [form, setForm] = useState({ codigo: '', rubro: '', descripcion: '', unidad: '', porcentaje: '', activo: true, regla: REGLA_VACIA, titulo: '', detalle: '' });
  const [foto, setFoto] = useState(null);
  const [cargando, setCargando] = useState(!nuevo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  async function cargar() {
    setCargando(true);
    try {
      const datos = await catalogoApi.get(`/items/${itemId}`);
      setItem(datos);
      setForm(formularioDeItem(datos));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (!nuevo) cargar();
  }, [itemId]);

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const cambiarRegla = (campo, valor) => setForm((f) => ({ ...f, regla: { ...f.regla, [campo]: valor } }));

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    const porcentaje = textoAFraccion(form.porcentaje);
    if (Number.isNaN(porcentaje)) return setError('El porcentaje tiene que ser un número (por ejemplo 55 para 55 %). Vacío = el porcentaje general.');

    const cuerpo = {
      codigo: form.codigo,
      rubro: form.rubro,
      descripcion: form.descripcion,
      unidad: form.unidad,
      porcentaje,
      regla: armarRegla(form.regla),
      ficha: { titulo: form.titulo, detalle: form.detalle },
    };
    if (!nuevo) cuerpo.activo = form.activo;

    setGuardando(true);
    try {
      let guardado = nuevo ? await catalogoApi.post('/items', cuerpo) : await catalogoApi.put(`/items/${itemId}`, cuerpo);
      if (foto) {
        const datos = new FormData();
        datos.append('imagen', foto);
        guardado = await catalogoApi.put(`/items/${guardado.id}/imagen`, datos);
        setFoto(null);
      }
      onCambio();
      if (nuevo) {
        onAbrirOtro(guardado.id);
      } else {
        setItem(guardado);
        setForm(formularioDeItem(guardado));
        setAviso('Guardado. Los precios de la versión General ya están recalculados.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!confirm(`¿Dar de baja o borrar el ítem ${item.codigo}?`)) return;
    setError('');
    try {
      const r = await catalogoApi.del(`/items/${itemId}`);
      onCambio();
      alert(r.mensaje);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  const r = form.regla;
  const corridas = corridasDeFicha({ titulo: form.titulo, detalle: form.detalle });
  const lectura = !puedeEscribir;

  return (
    <Modal onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>{nuevo ? 'Nuevo ítem del catálogo' : `${item ? item.codigo : 'Ítem'}`}</h3>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}
      {cargando ? (
        <p className="texto-suave">Cargando…</p>
      ) : (
        <form onSubmit={guardar}>
          {item && item.estado_precio !== 'ok' && (
            <div className={`aviso ${item.estado_precio === 'error' ? 'error' : 'advertencia'}`}>
              {item.estado_precio === 'error' ? 'Error de precio' : 'Sin precio'}: {item.motivo_texto || 'el ítem está marcado sin precio'}
            </div>
          )}
          {item && (
            <p style={{ marginTop: 0 }}>
              <strong>Pase parche:</strong> {pesos(item.pase_parche)} · <strong>Precio de catálogo (SAE):</strong> {item.sae === null ? 'S / P' : pesos(item.sae)}
            </p>
          )}

          <div className="form-grid">
            <Campo etiqueta="Código">
              <input value={form.codigo} required disabled={lectura} onChange={(e) => cambiar('codigo', e.target.value)} />
            </Campo>
            <Campo etiqueta="Rubro">
              <input value={form.rubro} disabled={lectura} onChange={(e) => cambiar('rubro', e.target.value)} />
            </Campo>
            <Campo etiqueta="Unidad">
              <input value={form.unidad} disabled={lectura} onChange={(e) => cambiar('unidad', e.target.value)} />
            </Campo>
            <Campo etiqueta="% propio (vacío = el general)">
              <input value={form.porcentaje} disabled={lectura} placeholder="ej. 100" onChange={(e) => cambiar('porcentaje', e.target.value)} />
            </Campo>
          </div>
          <div className="campo" style={{ marginTop: 12 }}>
            <label>Descripción interna</label>
            <input value={form.descripcion} disabled={lectura} onChange={(e) => cambiar('descripcion', e.target.value)} />
          </div>

          <div className="seccion-modal">
            <h4>Regla de precio</h4>
            <div className="form-grid">
              <Campo etiqueta="Cómo se calcula">
                <select value={r.tipo} disabled={lectura} onChange={(e) => cambiarRegla('tipo', e.target.value)}>
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETA_TIPO_REGLA[t]}
                    </option>
                  ))}
                </select>
              </Campo>
              {r.tipo === 'base' && (
                <>
                  <Campo etiqueta="Código en la base parche">
                    <input value={r.codigo_base} placeholder={form.codigo} disabled={lectura} onChange={(e) => cambiarRegla('codigo_base', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Factor (opcional)">
                    <input value={r.factor} placeholder="1" disabled={lectura} onChange={(e) => cambiarRegla('factor', e.target.value)} />
                  </Campo>
                </>
              )}
              {r.tipo === 'derivado' && (
                <>
                  <Campo etiqueta="Depende del ítem">
                    <input list="lista-codigos" value={r.ref} disabled={lectura} onChange={(e) => cambiarRegla('ref', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="Factor (ej. 1,5)">
                    <input value={r.factor} placeholder="1" disabled={lectura} onChange={(e) => cambiarRegla('factor', e.target.value)} />
                  </Campo>
                </>
              )}
              {r.tipo === 'manual' && (
                <>
                  <Campo etiqueta="Precio base fijo">
                    <input value={r.valor} disabled={lectura} onChange={(e) => cambiarRegla('valor', e.target.value)} />
                  </Campo>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'end' }}>
                    <input type="checkbox" checked={r.suma_adicional_pie} disabled={lectura} onChange={(e) => cambiarRegla('suma_adicional_pie', e.target.checked)} />
                    Suma el adicional del pie (televisores)
                  </label>
                </>
              )}
              {r.tipo === 'proporcional' && (
                <>
                  <Campo etiqueta="Proporcional al SAE de">
                    <input list="lista-codigos" value={r.ref} disabled={lectura} onChange={(e) => cambiarRegla('ref', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="× numerador">
                    <input value={r.num} disabled={lectura} onChange={(e) => cambiarRegla('num', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="÷ denominador">
                    <input value={r.den} disabled={lectura} onChange={(e) => cambiarRegla('den', e.target.value)} />
                  </Campo>
                </>
              )}
              {r.tipo === 'razon' && (
                <>
                  <Campo etiqueta="A (multiplica)">
                    <input list="lista-codigos" value={r.ref} disabled={lectura} onChange={(e) => cambiarRegla('ref', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="B (multiplica)">
                    <input list="lista-codigos" value={r.ref2} disabled={lectura} onChange={(e) => cambiarRegla('ref2', e.target.value)} />
                  </Campo>
                  <Campo etiqueta="C (divide)">
                    <input list="lista-codigos" value={r.ref3} disabled={lectura} onChange={(e) => cambiarRegla('ref3', e.target.value)} />
                  </Campo>
                </>
              )}
            </div>
            <p className="texto-suave" style={{ marginBottom: 0 }}>
              Un ítem derivado sigue al de origen: si cambia el precio del origen, éste se recalcula solo.
            </p>
          </div>

          <div className="seccion-modal">
            <h4>Ficha en el catálogo</h4>
            <div className="form-grid">
              <Campo etiqueta="Título (negrita)">
                <textarea rows={3} value={form.titulo} disabled={lectura} onChange={(e) => cambiar('titulo', e.target.value)} />
              </Campo>
              <Campo etiqueta="Medidas y detalle">
                <textarea rows={3} value={form.detalle} disabled={lectura} onChange={(e) => cambiar('detalle', e.target.value)} />
              </Campo>
              <div className="campo">
                <label>Así se ve</label>
                <div className="ficha-preview">
                  <FichaCatalogo corridas={corridas} texto="" />
                </div>
              </div>
            </div>
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0, alignItems: 'flex-start' }}>
              {item && item.imagen && <img className="foto-item" src={urlImagen(item.imagen)} alt={item.codigo} />}
              <Campo etiqueta={item && item.imagen ? 'Cambiar la foto (JPG, PNG o GIF)' : 'Foto (JPG, PNG o GIF)'}>
                <input type="file" accept="image/jpeg,image/png,image/gif" disabled={lectura} onChange={(e) => setFoto(e.target.files[0] || null)} />
              </Campo>
            </div>
          </div>

          {item && (
            <div className="seccion-modal">
              <h4>Dependencias y ubicación</h4>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Depende de:</strong>{' '}
                {item.depende_de.length === 0 ? <span className="texto-suave">nada (precio propio)</span> : item.depende_de.map((d) => (
                  <button type="button" key={d.id} className="chip" onClick={() => onAbrirOtro(d.id)}>
                    {d.codigo}
                  </button>
                ))}
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Dependen de este ítem:</strong>{' '}
                {item.dependientes.length === 0 ? <span className="texto-suave">nadie</span> : item.dependientes.map((d) => (
                  <button type="button" key={d.id} className="chip" onClick={() => onAbrirOtro(d.id)}>
                    {d.codigo}
                  </button>
                ))}
              </p>
              {item.dependientes_indirectos.length > item.dependientes.length && (
                <p className="texto-suave" style={{ margin: '0 0 8px' }}>
                  Si cambia su precio, en total se recalculan {item.dependientes_indirectos.length} ítems (contando los indirectos): {item.dependientes_indirectos.map((d) => d.codigo).join(', ')}.
                </p>
              )}
              <p style={{ margin: '0 0 8px' }}>
                <strong>En el catálogo:</strong>{' '}
                {item.posicion ? `${item.posicion.orden}. ${item.posicion.titulo} (banda ${item.posicion.banda}, columna ${item.posicion.columna})` : 'no está publicado en ninguna página'}
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>Producto de presupuestos:</strong> {item.producto ? `${item.producto.codigo} — ${item.producto.nombre}` : 'sin enlazar'}
              </p>
              {item.precios_por_version.length > 0 && (
                <table style={{ maxWidth: 420 }}>
                  <thead>
                    <tr>
                      <th>Versión</th>
                      <th className="num">SAE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.precios_por_version.map((p) => (
                      <tr key={p.version_id}>
                        <td>{p.nombre}</td>
                        <td className="num">{p.sae === null ? 'S / P' : pesos(p.sae)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!lectura && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                  <input type="checkbox" checked={form.activo} onChange={(e) => cambiar('activo', e.target.checked)} />
                  Activo (si se desmarca, no sale en el PDF)
                </label>
              )}
            </div>
          )}

          <datalist id="lista-codigos">
            {codigos.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {!lectura && (
            <div className="toolbar" style={{ marginTop: 20, marginBottom: 0, justifyContent: 'space-between' }}>
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <button type="submit" className="primario" disabled={guardando}>
                  {guardando ? 'Guardando…' : nuevo ? 'Crear ítem' : 'Guardar cambios'}
                </button>
                <button type="button" onClick={onClose}>
                  Cerrar
                </button>
              </div>
              {!nuevo && (
                <button type="button" className="peligro" onClick={borrar}>
                  Dar de baja / borrar
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
