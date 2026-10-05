import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { BuscadorCliente } from '../components/BuscadorCliente';
import { fechaCorta, fraccionATexto, pesos, textoAFraccion } from '../catalogoFormat';

const CAMPOS_TEXTO = ['tipo', 'lote', 'nombre_stand', 'contacto', 'mail', 'telefono', 'razon_social', 'cuit', 'direccion', 'notas'];
// Los datos que se guardan en la ficha del cliente (el CUIT es la clave)
const CAMPOS_CLIENTE = ['razon_social', 'direccion', 'contacto', 'mail', 'telefono'];

/** De un cliente guardado, sólo los datos que en el formulario están vacíos (no pisa lo que ya se escribió). */
const completarVacios = (form, cliente) => Object.fromEntries(CAMPOS_CLIENTE.filter((k) => !form[k].trim() && cliente[k]).map((k) => [k, cliente[k]]));

/** Qué avisar debajo del CUIT: lo que se acaba de comprobar o, si no, lo que ya sabe el presupuesto guardado. */
function avisoDeCuit(edicion, cot, cuitActual, cuitGuardado) {
  if (edicion) return edicion;
  if (!cot || !cot.cuit || cuitActual !== cuitGuardado) return null;
  if (cot.cuit_valido === false) return { tipo: 'invalido' };
  return cot.cliente ? { tipo: 'guardado', nombre: cot.cliente.razon_social } : null;
}

const AVISOS_CUIT = {
  guardado: { color: 'var(--color-exito)', texto: (a) => `Cliente guardado${a.nombre ? `: ${a.nombre}` : ''}. Al guardar los datos se actualiza su ficha.` },
  nuevo: { color: 'var(--color-info)', texto: () => 'Cliente nuevo: se guarda con este CUIT al guardar los datos.' },
  invalido: { color: 'var(--color-advertencia)', texto: () => 'El CUIT no parece válido (son 11 dígitos). El presupuesto se guarda igual, pero no se guarda como cliente.' },
};

const formDe = (c) => ({ evento_id: c ? c.evento_id : null, ...Object.fromEntries(CAMPOS_TEXTO.map((k) => [k, (c && c[k]) || ''])) });

/** Busca en el catálogo y agrega un ítem al presupuesto con su cantidad. */
function AgregarItem({ versionId, onAgregar }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState(null);
  const [cantidad, setCantidad] = useState('1');
  const [aviso, setAviso] = useState('');
  const contenedorRef = useRef(null);

  useEffect(() => {
    function onClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    const espera = setTimeout(() => {
      api
        .get(`/cotizaciones/catalogo/buscar?q=${encodeURIComponent(texto)}&version=${versionId || ''}`)
        .then(setResultados)
        .catch(() => setResultados([]));
    }, 200);
    return () => clearTimeout(espera);
  }, [texto, abierto, versionId]);

  function elegir(item) {
    setElegido(item);
    setTexto(`${item.codigo} — ${item.descripcion}`);
    setAbierto(false);
    setAviso('');
  }

  async function agregar() {
    if (!elegido) return setAviso('Elegí un ítem de la lista');
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 1) return setAviso('La cantidad tiene que ser un número entero de 1 en adelante');
    setAviso('');
    if (await onAgregar(elegido.id, n)) {
      setTexto('');
      setElegido(null);
      setCantidad('1');
    }
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 6, alignItems: 'flex-end' }}>
        <div className="campo" style={{ flex: 1, minWidth: 260 }}>
          <label>Agregar ítem del catálogo</label>
          <div ref={contenedorRef} className="buscador-producto">
            <input
              placeholder="Buscar por código o descripción…"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setElegido(null);
                setAbierto(true);
              }}
              onFocus={() => setAbierto(true)}
            />
            {abierto && resultados.length > 0 && (
              <div className="buscador-dropdown">
                {resultados.map((r) => (
                  <div key={r.id} className="buscador-opcion cot-opcion" onMouseDown={() => elegir(r)}>
                    <span>
                      <strong>{r.codigo}</strong> {r.descripcion} {r.rubro && <span className="texto-suave">({r.rubro})</span>}
                    </span>
                    <span className={r.precio === null ? 'cot-sin-precio' : 'cot-precio'}>{r.precio === null ? 'sin precio' : pesos(r.precio)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="campo" style={{ width: 90 }}>
          <label>Cantidad</label>
          <input type="number" min="1" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} />
        </div>
        <button className="primario" onClick={agregar}>
          + Agregar
        </button>
      </div>
      {aviso && <div className="texto-suave" style={{ color: 'var(--color-peligro)' }}>{aviso}</div>}
    </div>
  );
}

function tamanoLegible(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** El croquis del stand dibujado en la app: se dibuja desde acá y se elige si sale o no en el PDF del presupuesto. */
function CroquisCard({ cot, puedeEscribir, onCot }) {
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const resumen = cot.croquis;
  const puedeDibujar = puedeEscribir && cot.estado === 'pendiente';

  async function cambiarInclusion(incluir) {
    setError('');
    setTrabajando(true);
    try {
      onCot(await api.put(`/cotizaciones/${cot.id}/croquis/pdf`, { incluir_en_pdf: incluir }));
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Croquis del stand</h3>
      <p className="texto-suave" style={{ marginTop: 0 }}>
        Dibujá el plano del stand con los materiales del catálogo, las paredes y las cotas, y elegí si sale o no en el PDF del presupuesto. Al confirmar el presupuesto, el
        croquis pasa al lote del stand y sale en los totales del evento.
      </p>
      {error && <div className="aviso error">{error}</div>}
      <div className="toolbar" style={{ marginBottom: 0, alignItems: 'center' }}>
        {resumen ? (
          <span>
            Croquis dibujado: {resumen.paredes} {resumen.paredes === 1 ? 'pared' : 'paredes'}, {resumen.materiales} {resumen.materiales === 1 ? 'material' : 'materiales'}, {resumen.cotas}{' '}
            {resumen.cotas === 1 ? 'cota' : 'cotas'}
            {resumen.con_comentarios ? ', con comentarios' : ''}.
          </span>
        ) : (
          <span className="texto-suave">Todavía no hay un croquis dibujado.</span>
        )}
        {(puedeDibujar || resumen) && (
          <Link className="boton" to={`/presupuestos/carga/${cot.id}/croquis`}>
            {puedeDibujar ? (resumen ? 'Editar croquis' : 'Dibujar croquis') : 'Ver croquis'}
          </Link>
        )}
      </div>
      {resumen && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={resumen.incluir_en_pdf} disabled={!puedeEscribir || trabajando} onChange={(e) => cambiarInclusion(e.target.checked)} />
          Incluir el croquis en el PDF del presupuesto
        </label>
      )}
    </div>
  );
}

/** Planos y archivos (imagen o PDF) que salen como anexos al final del PDF del presupuesto. */
function AdjuntosCard({ cot, puedeEscribir, onCot }) {
  const [titulo, setTitulo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [claveInput, setClaveInput] = useState(0);

  async function ejecutar(accion) {
    setError('');
    try {
      onCot(await accion());
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function subir(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setSubiendo(true);
    const datos = new FormData();
    datos.append('archivo', archivo);
    if (titulo.trim()) datos.append('titulo', titulo.trim());
    if (await ejecutar(() => api.post(`/cotizaciones/${cot.id}/adjuntos`, datos))) setTitulo('');
    setSubiendo(false);
    setClaveInput((n) => n + 1);
  }

  const cambiar = (a, cambios) => ejecutar(() => api.put(`/cotizaciones/adjuntos/${a.id}`, cambios));

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Planos y archivos adjuntos</h3>
      <p className="texto-suave" style={{ marginTop: 0 }}>
        Podés adjuntar imágenes (JPG o PNG) y archivos PDF. Salen como anexos al final del PDF del presupuesto, en el orden en que los cargues. Hasta 10 por presupuesto y 25 MB cada uno.
      </p>
      {error && <div className="aviso error">{error}</div>}

      {cot.adjuntos.length === 0 ? (
        <p className="texto-suave">Todavía no hay adjuntos.</p>
      ) : (
        <ul className="adjuntos">
          {cot.adjuntos.map((a) => (
            <li key={a.id}>
              <a href={`/api/cotizaciones/adjuntos/${a.id}/archivo`} target="_blank" rel="noreferrer" title="Abrir">
                {a.tipo === 'imagen' ? <img className="adjunto-mini" src={`/api/cotizaciones/adjuntos/${a.id}/archivo`} alt={a.nombre_original} /> : <span className="adjunto-pdf">PDF</span>}
              </a>
              <div className="adjunto-datos">
                <input
                  key={`t-${a.id}-${a.titulo}`}
                  placeholder="Título (opcional, sale en el PDF)"
                  defaultValue={a.titulo || ''}
                  disabled={!puedeEscribir}
                  onBlur={(e) => (e.target.value.trim() || null) !== (a.titulo || null) && cambiar(a, { titulo: e.target.value })}
                />
                <span className="texto-suave">
                  {a.nombre_original} · {tamanoLegible(a.tamano)}
                  {a.tipo === 'pdf' ? ` · ${a.paginas} ${a.paginas === 1 ? 'página' : 'páginas'}` : ''}
                </span>
              </div>
              <label className="adjunto-incluir">
                <input type="checkbox" checked={a.incluir_en_pdf} disabled={!puedeEscribir} onChange={(e) => cambiar(a, { incluir_en_pdf: e.target.checked })} />
                Incluir en el PDF
              </label>
              {puedeEscribir && (
                <button className="peligro" onClick={() => confirm(`¿Quitar "${a.titulo || a.nombre_original}"?`) && ejecutar(() => api.del(`/cotizaciones/adjuntos/${a.id}`))}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEscribir && cot.adjuntos.length < 10 && (
        <div className="toolbar" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
          <div className="campo" style={{ minWidth: 240 }}>
            <label>Título del nuevo adjunto (opcional)</label>
            <input value={titulo} placeholder="Ej.: Plano de la sala" onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="campo">
            <label>{subiendo ? 'Subiendo…' : 'Archivo'}</label>
            <input key={claveInput} type="file" accept="image/jpeg,image/png,application/pdf" disabled={subiendo} onChange={subir} />
          </div>
        </div>
      )}
      <p className="texto-suave" style={{ marginBottom: 0, marginTop: 10 }}>
        Los archivos se guardan en una carpeta del servidor que <strong>no entra en el backup automático</strong>: conviene respaldarla aparte.
      </p>
    </div>
  );
}

export function CotizacionEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario, puedeEscribir } = useAuth();
  const [cot, setCot] = useState(null);
  const [form, setForm] = useState(formDe(null));
  const [guardado, setGuardado] = useState(formDe(null));
  const [opciones, setOpciones] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [infoCuitEdit, setInfoCuitEdit] = useState(null);
  const [listaInicial, setListaInicial] = useState(''); // sólo para "Nuevo presupuesto": con qué lista arranca (vacío = General)

  const esNuevo = !id;

  const cargar = useCallback(async () => {
    if (!id) return;
    try {
      const c = await api.get(`/cotizaciones/${id}`);
      setCot(c);
      setForm(formDe(c));
      setGuardado(formDe(c));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    // Al pasar de un presupuesto a otro (por ejemplo al duplicar) se parte de cero
    setCot(null);
    setForm(formDe(null));
    setGuardado(formDe(null));
    setError('');
    setAviso('');
    setInfoCuitEdit(null);
    setListaInicial('');
    cargar();
  }, [cargar]);

  /** Vuelve a leer el presupuesto sin tocar lo que hay escrito en el formulario. */
  const refrescar = useCallback(async () => {
    try {
      setCot(await api.get(`/cotizaciones/${id}`));
    } catch {
      // si no se pudo leer, queda lo que había en pantalla
    }
  }, [id]);

  useEffect(() => {
    api
      .get('/cotizaciones/opciones')
      .then(setOpciones)
      .catch((err) => setError(err.message));
    api
      .get('/eventos')
      .then(setEventos)
      .catch(() => {});
  }, []);

  const editable = puedeEscribir && (esNuevo || cot?.estado === 'pendiente');
  const sinGuardar = JSON.stringify(form) !== JSON.stringify(guardado);
  const cambiar = (campo, valor) => setForm({ ...form, [campo]: valor });

  /** Al salir del CUIT: lo valida, lo escribe con guiones y, si ya es un cliente guardado, completa lo que esté vacío. */
  async function revisarCuit() {
    const texto = form.cuit.trim();
    if (!editable || !texto) return;
    try {
      const r = await api.get(`/clientes/por-cuit/${encodeURIComponent(texto)}`);
      if (r.vacio) return;
      if (!r.valido) {
        setInfoCuitEdit({ tipo: 'invalido' });
        return;
      }
      setForm((f) => ({ ...f, cuit: r.cuit_formateado, ...(r.cliente ? completarVacios(f, r.cliente) : {}) }));
      setInfoCuitEdit(r.cliente ? { tipo: 'guardado', nombre: r.cliente.razon_social } : { tipo: 'nuevo' });
    } catch {
      // si no hay conexión con el servidor, se sigue sin el aviso
    }
  }

  /** Al elegir un cliente de la lista se completan todos sus datos. */
  function elegirCliente(c) {
    setForm((f) => ({ ...f, cuit: c.cuit, ...Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, c[k] || f[k]])) }));
    setInfoCuitEdit({ tipo: 'guardado', nombre: c.razon_social });
  }

  /** Ejecuta una acción del servidor que devuelve el presupuesto completo. */
  async function operar(accion, mensaje = '') {
    setError('');
    setAviso('');
    setTrabajando(true);
    try {
      const respuesta = await accion();
      setCot(respuesta);
      if (mensaje) setAviso(typeof mensaje === 'function' ? mensaje(respuesta) : mensaje);
      return true;
    } catch (err) {
      setError(err.message);
      refrescar();
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarDatos(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    setTrabajando(true);
    try {
      if (esNuevo) {
        const creado = await api.post('/cotizaciones', form);
        // Si se eligió otra lista (una versión de evento o del historial), se aplica antes de entrar:
        // el presupuesto todavía no tiene ítems, así que sólo deja fijada la lista con la que arranca.
        if (listaInicial && Number(listaInicial) !== creado.catalogo_version_id) {
          await api.post(`/cotizaciones/${creado.id}/lista`, { version_id: Number(listaInicial) });
        }
        navigate(`/presupuestos/carga/${creado.id}`, { replace: true });
      } else {
        const actualizado = await api.put(`/cotizaciones/${id}`, form);
        setCot(actualizado);
        setForm(formDe(actualizado));
        setGuardado(formDe(actualizado));
        setInfoCuitEdit(null);
        setAviso('Datos guardados.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando(false);
    }
  }

  const agregarItem = (itemId, cantidad) => operar(() => api.post(`/cotizaciones/${id}/lineas`, { catalogo_item_id: itemId, cantidad }));

  function guardarCantidad(linea, valor) {
    const n = Number(valor);
    if (n !== linea.cantidad) operar(() => api.put(`/cotizaciones/lineas/${linea.id}`, { cantidad: n }));
  }

  function guardarPrecio(linea, valor) {
    const nuevo = valor === '' ? null : Number(valor);
    if (nuevo !== linea.precio_unitario) operar(() => api.put(`/cotizaciones/lineas/${linea.id}`, { precio_unitario: nuevo }));
  }

  function guardarComentario(linea, valor) {
    if ((valor.trim() || null) !== (linea.comentario || null)) operar(() => api.put(`/cotizaciones/lineas/${linea.id}`, { comentario: valor }));
  }

  function cambiarLista(versionId) {
    const hayEditados = cot.lineas.some((l) => l.precio_modificado);
    if (hayEditados && !confirm('Se vuelven a poner los precios de la lista en todos los ítems, y se pisan los que cambiaste a mano. ¿Seguir?')) return;
    operar(() => api.post(`/cotizaciones/${id}/lista`, { version_id: Number(versionId) }), 'Precios actualizados con la lista elegida.');
  }

  function guardarDescuento(valor) {
    const fraccion = textoAFraccion(valor) ?? 0;
    if (Number.isNaN(fraccion) || fraccion < 0 || fraccion > 1) return setError('El descuento tiene que ser un número entre 0 y 100 (por ejemplo 10 para 10 %)');
    if (fraccion === cot.descuento_porcentaje) return;
    operar(() => api.post(`/cotizaciones/${id}/descuento`, { descuento_porcentaje: fraccion }), 'Descuento actualizado.');
  }

  async function confirmarPresupuesto() {
    const destino = `${cot.evento_nombre}, lote ${cot.lote}`;
    if (!confirm(`Se confirma el presupuesto y pasa a ser parte del evento (${destino}). Después ya no se edita desde acá, sino dentro del evento.\n\n¿Confirmar?`)) return;
    await operar(
      () => api.post(`/cotizaciones/${id}/confirmar`),
      (r) =>
        'Presupuesto confirmado: ya forma parte del evento.' +
        (r.croquis_en_lote === 'copiado'
          ? ' El croquis quedó guardado en el lote del stand.'
          : r.croquis_en_lote === 'lote_ya_tenia'
            ? ' El lote ya tenía un croquis, así que se conservó ese.'
            : '')
    );
  }

  async function rechazarPresupuesto() {
    if (!confirm('¿Marcar este presupuesto como rechazado? No se borra, queda como registro; se puede reabrir después si hace falta.\n\n¿Confirmar?')) return;
    await operar(() => api.post(`/cotizaciones/${id}/rechazar`), 'Presupuesto marcado como rechazado.');
  }

  async function reabrirPresupuesto() {
    await operar(() => api.post(`/cotizaciones/${id}/reabrir`), 'Presupuesto reabierto: vuelve a estar pendiente.');
  }

  async function duplicar() {
    setError('');
    try {
      const copia = await api.post(`/cotizaciones/${id}/duplicar`);
      navigate(`/presupuestos/carga/${copia.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function eliminar() {
    if (!confirm('¿Eliminar este presupuesto con todos sus ítems? No se puede deshacer.')) return;
    try {
      await api.del(`/cotizaciones/${id}`);
      navigate('/presupuestos');
    } catch (err) {
      setError(err.message);
    }
  }

  if (!esNuevo && !cot) return error ? <div className="aviso error">{error}</div> : <p className="texto-suave">Cargando…</p>;

  const infoCuit = avisoDeCuit(infoCuitEdit, cot, form.cuit, guardado.cuit);
  const confirmada = cot?.estado === 'confirmada';
  const rechazada = cot?.estado === 'rechazada';

  return (
    <div>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/presupuestos">← Presupuestos</Link>
      </p>
      <div className="cot-cabecera">
        <h2 style={{ margin: 0 }}>{esNuevo ? 'Nuevo presupuesto' : `Presupuesto ${cot.cod_fac || `N.º ${cot.id}`}`}</h2>
        {cot && (
          <span className={`badge ${confirmada ? 'confirmada' : rechazada ? 'rechazada' : 'pendiente_confirmacion'}`}>
            {confirmada ? 'Confirmado' : rechazada ? 'Rechazado' : 'Pendiente de confirmación'}
          </span>
        )}
      </div>

      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}
      {confirmada && (
        <div className="aviso exito">
          Este presupuesto está confirmado y ya forma parte del evento{cot.evento_nombre ? ` ${cot.evento_nombre}` : ''}. Para cambiarlo, editalo dentro del evento.{' '}
          {cot.evento_id && <Link to={`/eventos/${cot.evento_id}`}>Ver el evento</Link>}
        </div>
      )}
      {rechazada && <div className="aviso advertencia">Este presupuesto está marcado como rechazado: queda como registro, de sólo lectura. Se puede reabrir con el botón de abajo.</div>}
      {opciones && !opciones.catalogo_cargado && !esNuevo && (
        <div className="aviso advertencia">El catálogo todavía no está cargado (falta la carga inicial), así que no se pueden agregar ítems.</div>
      )}

      <form className="card" onSubmit={guardarDatos}>
        <h3 style={{ marginTop: 0 }}>Datos del cliente</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Todos los datos son opcionales. Para confirmar hacen falta el evento y el número de stand.
        </p>
        <div className="form-grid">
          <div className="campo">
            <label>Expo (evento)</label>
            {editable ? (
              <BuscadorEvento eventos={eventos} value={form.evento_id} onChange={(v) => cambiar('evento_id', v)} placeholder="Escribí para buscar el evento…" />
            ) : (
              <input value={cot?.evento_nombre || ''} disabled />
            )}
          </div>
          <div className="campo">
            <label>Tipo</label>
            <select value={form.tipo} disabled={!editable} onChange={(e) => cambiar('tipo', e.target.value)}>
              <option value="">—</option>
              {(opciones?.tipos || []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Lote (N.º de stand)</label>
            <input value={form.lote} disabled={!editable} onChange={(e) => cambiar('lote', e.target.value)} />
          </div>
          <div className="campo">
            <label>Nombre del stand</label>
            <input value={form.nombre_stand} disabled={!editable} onChange={(e) => cambiar('nombre_stand', e.target.value)} />
          </div>
          <div className="campo">
            <label>Razón social</label>
            <BuscadorCliente value={form.razon_social} disabled={!editable} onChange={(v) => cambiar('razon_social', v)} onElegir={elegirCliente} />
          </div>
          <div className="campo">
            <label>CUIT</label>
            <input
              value={form.cuit}
              disabled={!editable}
              placeholder="Ej.: 30-52830354-0"
              onChange={(e) => {
                cambiar('cuit', e.target.value);
                setInfoCuitEdit(null);
              }}
              onBlur={revisarCuit}
            />
            {infoCuit && (
              <span className="texto-suave" style={{ color: AVISOS_CUIT[infoCuit.tipo].color }}>
                {AVISOS_CUIT[infoCuit.tipo].texto(infoCuit)}
              </span>
            )}
          </div>
          <div className="campo">
            <label>Dirección</label>
            <input value={form.direccion} disabled={!editable} onChange={(e) => cambiar('direccion', e.target.value)} />
          </div>
          <div className="campo">
            <label>Contacto</label>
            <input value={form.contacto} disabled={!editable} onChange={(e) => cambiar('contacto', e.target.value)} />
          </div>
          <div className="campo">
            <label>Mail</label>
            <input type="email" value={form.mail} disabled={!editable} onChange={(e) => cambiar('mail', e.target.value)} />
          </div>
          <div className="campo">
            <label>Teléfono</label>
            <input value={form.telefono} disabled={!editable} onChange={(e) => cambiar('telefono', e.target.value)} />
          </div>
          <div className="campo">
            <label>Responsable</label>
            <input value={cot ? cot.responsable || '' : usuario?.nombre_completo || usuario?.nombre_usuario || ''} disabled />
          </div>
          <div className="campo">
            <label>Fecha de carga</label>
            <input value={cot ? fechaCorta(cot.fecha_carga) : fechaCorta(new Date().toISOString())} disabled />
          </div>
          <div className="campo">
            <label>ID de cliente</label>
            <input value={cot?.id_cliente || ''} placeholder="Se completa solo" disabled />
          </div>
          <div className="campo">
            <label>N.º de presupuesto</label>
            <input value={cot?.numero || ''} placeholder="Se completa solo" disabled />
          </div>
          {esNuevo && (
            <div className="campo">
              <label>Lista de precios</label>
              <select value={listaInicial} disabled={!editable} onChange={(e) => setListaInicial(e.target.value)}>
                <option value="">General (por defecto)</option>
                <optgroup label="Vigentes">
                  {(opciones?.versiones || []).filter((v) => !v.es_historial && !v.es_general).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nombre}
                    </option>
                  ))}
                </optgroup>
                {(opciones?.versiones || []).some((v) => v.es_historial) && (
                  <optgroup label="Historial de la General">
                    {(opciones?.versiones || []).filter((v) => v.es_historial).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="texto-suave">Con qué precios arranca. Se puede volver a cambiar después, desde "Ítems".</span>
            </div>
          )}
        </div>
        <p className="texto-suave" style={{ marginBottom: 4 }}>
          El ID de cliente sale de la expo, el tipo, el nombre del stand, el responsable y el lote; aparece cuando están todos cargados y guardados. El número de presupuesto es correlativo por cliente.
        </p>
        <div className="campo" style={{ marginTop: 8 }}>
          <label>Observaciones (salen en el PDF)</label>
          <textarea rows={2} value={form.notas} disabled={!editable} onChange={(e) => cambiar('notas', e.target.value)} />
        </div>
        {editable && (
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button type="submit" className="primario" disabled={trabajando || (!esNuevo && !sinGuardar)}>
              {esNuevo ? 'Crear y cargar ítems' : sinGuardar ? 'Guardar datos' : 'Datos guardados'}
            </button>
            {sinGuardar && !esNuevo && <span className="texto-suave">Hay cambios sin guardar</span>}
          </div>
        )}
      </form>

      {cot && (
        <div className="card">
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Ítems</h3>
            <div className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <label style={{ whiteSpace: 'nowrap' }}>Lista de precios</label>
              <select value={cot.catalogo_version_id || ''} disabled={!editable || trabajando} onChange={(e) => cambiarLista(e.target.value)}>
                <optgroup label="Vigentes">
                  {(opciones?.versiones || []).filter((v) => !v.es_historial).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nombre}
                    </option>
                  ))}
                </optgroup>
                {(opciones?.versiones || []).some((v) => v.es_historial) && (
                  <optgroup label="Historial de la General">
                    {(opciones?.versiones || []).filter((v) => v.es_historial).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <label style={{ whiteSpace: 'nowrap' }}>Descuento especial (%)</label>
              <input
                key={`desc-${cot.id}-${cot.descuento_porcentaje}`}
                className="cot-numero"
                style={{ width: 80 }}
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="0"
                defaultValue={cot.descuento_porcentaje ? fraccionATexto(cot.descuento_porcentaje) : ''}
                disabled={!editable || trabajando}
                onBlur={(e) => guardarDescuento(e.target.value)}
              />
            </div>
          </div>

          {editable && opciones?.catalogo_cargado && <AgregarItem versionId={cot.catalogo_version_id} onAgregar={agregarItem} />}

          {cot.lineas.length === 0 ? (
            <p className="texto-suave">Todavía no se cargaron ítems.</p>
          ) : (
            <div className="tabla-scroll">
              <table className="cot-lineas">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Precio unitario</th>
                    <th className="num">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cot.lineas.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.codigo}</strong>
                      </td>
                      <td>
                        {l.descripcion}
                        {editable ? (
                          <input
                            key={`c-${l.id}-${l.comentario}`}
                            className="cot-comentario"
                            placeholder="Comentario (opcional)"
                            defaultValue={l.comentario || ''}
                            onBlur={(e) => guardarComentario(l, e.target.value)}
                          />
                        ) : (
                          l.comentario && <div className="texto-suave">{l.comentario}</div>
                        )}
                      </td>
                      <td className="num">
                        <input
                          key={`q-${l.id}-${l.cantidad}`}
                          className="cot-numero cot-cantidad"
                          type="number"
                          min="1"
                          step="1"
                          defaultValue={l.cantidad}
                          disabled={!editable}
                          onBlur={(e) => guardarCantidad(l, e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          key={`p-${l.id}-${l.precio_unitario}`}
                          className={`cot-numero cot-precio-input${l.precio_unitario === null ? ' sin-precio' : ''}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Sin precio"
                          defaultValue={l.precio_unitario ?? ''}
                          disabled={!editable}
                          onBlur={(e) => guardarPrecio(l, e.target.value)}
                        />
                        {l.precio_modificado && (
                          <div className="texto-suave" title="El precio de la lista de precios era distinto">
                            lista: {pesos(l.precio_catalogo)}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <strong>{pesos(l.subtotal)}</strong>
                      </td>
                      <td>{editable && <button title="Quitar" onClick={() => operar(() => api.del(`/cotizaciones/lineas/${l.id}`))}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cot-totales">
            {cot.totales.descuento > 0 ? (
              <>
                <div>
                  <span>Subtotal</span>
                  <strong>{pesos(cot.totales.subtotal_bruto)}</strong>
                </div>
                <div>
                  <span>Descuento {String(Math.round(cot.totales.descuento_porcentaje * 10000) / 100).replace('.', ',')} %</span>
                  <strong>-{pesos(cot.totales.descuento)}</strong>
                </div>
                <div>
                  <span>Subtotal con descuento</span>
                  <strong>{pesos(cot.totales.subtotal)}</strong>
                </div>
              </>
            ) : (
              <div>
                <span>Subtotal</span>
                <strong>{pesos(cot.totales.subtotal)}</strong>
              </div>
            )}
            <div>
              <span>IVA {String(Math.round(cot.totales.iva_porcentaje * 10000) / 100).replace('.', ',')} %</span>
              <strong>{pesos(cot.totales.iva)}</strong>
            </div>
            <div className="cot-total">
              <span>Total</span>
              <strong>{pesos(cot.totales.total)}</strong>
            </div>
            {cot.totales.lineas_sin_precio > 0 && <div className="cot-sin-precio">{cot.totales.lineas_sin_precio} ítem(s) sin precio no suman al total</div>}
          </div>
        </div>
      )}

      {cot && <CroquisCard cot={cot} puedeEscribir={puedeEscribir} onCot={setCot} />}

      {cot && <AdjuntosCard cot={cot} puedeEscribir={puedeEscribir} onCot={setCot} />}

      {cot && (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <a className="boton primario" href={`/api/cotizaciones/${cot.id}/pdf?ver=1`} target="_blank" rel="noreferrer">
              Ver PDF
            </a>
            <a className="boton" href={`/api/cotizaciones/${cot.id}/pdf`}>
              Descargar PDF
            </a>
            {puedeEscribir && <button onClick={duplicar}>Duplicar</button>}
            {editable && (
              <button className="primario" disabled={trabajando || sinGuardar || !cot.confirmable.ok} onClick={confirmarPresupuesto}>
                Confirmar presupuesto
              </button>
            )}
            {editable && (
              <button onClick={rechazarPresupuesto} disabled={trabajando}>
                Marcar como rechazado
              </button>
            )}
            {rechazada && puedeEscribir && (
              <button onClick={reabrirPresupuesto} disabled={trabajando}>
                Reabrir
              </button>
            )}
            {puedeEscribir && !confirmada && (
              <button className="peligro" onClick={eliminar}>
                Eliminar
              </button>
            )}
          </div>
          {editable && sinGuardar && <p className="texto-suave" style={{ marginBottom: 0 }}>Guardá los datos antes de confirmar.</p>}
          {editable && !cot.confirmable.ok && (
            <div className="aviso advertencia" style={{ marginTop: 12, marginBottom: 0 }}>
              Para confirmar todavía falta:
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {cot.confirmable.motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
