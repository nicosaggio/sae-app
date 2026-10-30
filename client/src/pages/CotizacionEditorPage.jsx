import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BuscadorEvento } from '../components/BuscadorEvento';
import { BuscadorCliente } from '../components/BuscadorCliente';
import { DialogoConfirmar } from '../components/DialogoConfirmar';
import { Icono } from '../components/Icono';
import { MenuMas } from '../components/MenuMas';
import { Sello } from '../components/Sello';
import { useListaTeclado } from '../hooks/useListaTeclado';
import { fechaCorta, fraccionATexto, pesos, textoAFraccion } from '../catalogoFormat';
import '../editor-presupuesto.css';

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
  guardado: { clase: 'mensaje--ok', icono: 'check-c', texto: (a) => `Cliente guardado${a.nombre ? `: ${a.nombre}` : ''}. Al guardar los datos se actualiza su ficha.` },
  nuevo: { clase: 'mensaje--info', icono: 'info', texto: () => 'Cliente nuevo: se guarda con este CUIT al guardar los datos.' },
  invalido: { clase: 'mensaje--aviso', icono: 'warn', texto: () => 'El CUIT no parece válido (son 11 dígitos). El presupuesto se guarda igual, pero no se guarda como cliente.' },
};

const formDe = (c) => ({ evento_id: c ? c.evento_id : null, ...Object.fromEntries(CAMPOS_TEXTO.map((k) => [k, (c && c[k]) || ''])) });

/** Lleva la vista hasta una sección de la página (sin animar si la persona pidió menos movimiento). */
function irA(id) {
  const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
}

/** Busca en el catálogo y agrega un ítem al presupuesto con su cantidad. */
function AgregarItem({ versionId, onAgregar }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [resultadosDe, setResultadosDe] = useState(null); // el texto al que corresponden `resultados`
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState(null);
  const [cantidad, setCantidad] = useState('1');
  const [aviso, setAviso] = useState('');
  const contenedorRef = useRef(null);
  const idBuscar = useId();
  const idCantidad = useId();

  useEffect(() => {
    function onClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    const consulta = texto;
    const espera = setTimeout(() => {
      api
        .get(`/cotizaciones/catalogo/buscar?q=${encodeURIComponent(consulta)}&version=${versionId || ''}`)
        .then((r) => {
          setResultados(r);
          setResultadosDe(consulta);
        })
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

  // Enter/Tab aceptan la opción marcada; mientras se escribe queda marcada la primera (autocompletado),
  // pero sólo si la lista ya es la de lo escrito: con la búsqueda a medio responder sería una de antes.
  const lista = useListaTeclado({
    cantidad: resultados.length,
    abierto,
    setAbierto,
    elegirEn: (i) => elegir(resultados[i]),
    sugerirPrimera: texto.trim() !== '' && !elegido && resultadosDe === texto,
  });

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
      <div className="fila" style={{ alignItems: 'flex-end' }}>
        <div className="campo" style={{ flex: 1, minWidth: 260 }}>
          <label htmlFor={idBuscar}>Agregar ítem del catálogo</label>
          <div ref={contenedorRef} className="buscador-producto">
            <div className="entrada-icono">
              <Icono nombre="search" />
              <input
                id={idBuscar}
                placeholder="Buscar por código o descripción…"
                autoComplete="off"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setElegido(null);
                  setAbierto(true);
                  lista.reiniciar();
                }}
                onFocus={() => setAbierto(true)}
                onKeyDown={lista.onKeyDown}
              />
            </div>
            {abierto && resultados.length > 0 && (
              <div className="buscador-dropdown" {...lista.propsLista}>
                {resultados.map((r, i) => (
                  <div key={r.id} className="buscador-opcion cot-opcion" onMouseDown={() => elegir(r)} {...lista.propsOpcion(i)}>
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
          <label htmlFor={idCantidad}>Cantidad</label>
          <input
            id={idCantidad}
            type="number"
            min="1"
            step="1"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={(e) => {
              // Último campo de "Agregar ítem": Enter agrega la línea (no pasa al botón).
              if (e.key !== 'Enter') return;
              e.preventDefault();
              agregar();
            }}
          />
        </div>
        <button type="button" className="boton boton--primario" onClick={agregar}>
          <Icono nombre="plus" />
          Agregar
        </button>
      </div>
      {aviso && (
        <p className="mensaje mensaje--error" style={{ marginTop: 6 }} role="alert">
          <Icono nombre="warn" />
          <span>{aviso}</span>
        </p>
      )}
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
    <section className="tarjeta" id="ed-croquis" aria-labelledby="ed-t-croquis">
      <div className="tarjeta-cab">
        <div>
          <h2 id="ed-t-croquis">Croquis del stand</h2>
          <p className="sub">
            Dibujá el plano del stand con los materiales del catálogo, las paredes y las cotas, y elegí si sale o no en el PDF del presupuesto. Al confirmar el presupuesto, el croquis pasa al lote del stand
            y sale en los totales del evento.
          </p>
        </div>
      </div>
      <div className="tarjeta-cuerpo pila" style={{ gap: 'var(--s-3)' }}>
        {error && (
          <div className="aviso aviso--error" role="alert">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">{error}</div>
          </div>
        )}
        <div className="fila fila--entre">
          {resumen ? (
            <span>
              <Icono nombre="ruler" className="icono--sm" /> Croquis dibujado: {resumen.paredes} {resumen.paredes === 1 ? 'pared' : 'paredes'}, {resumen.materiales}{' '}
              {resumen.materiales === 1 ? 'material' : 'materiales'}, {resumen.cotas} {resumen.cotas === 1 ? 'cota' : 'cotas'}
              {resumen.con_comentarios ? ', con comentarios' : ''}.
            </span>
          ) : (
            <span className="sub">Todavía no hay un croquis dibujado.</span>
          )}
          {(puedeDibujar || resumen) && (
            <Link className="boton" to={`/presupuestos/carga/${cot.id}/croquis`}>
              <Icono nombre={puedeDibujar ? 'pencil' : 'eye'} />
              {puedeDibujar ? (resumen ? 'Editar croquis' : 'Dibujar croquis') : 'Ver croquis'}
            </Link>
          )}
        </div>
        {resumen && (
          <label className="check">
            <input type="checkbox" checked={resumen.incluir_en_pdf} disabled={!puedeEscribir || trabajando} onChange={(e) => cambiarInclusion(e.target.checked)} />
            Incluir el croquis en el PDF del presupuesto
          </label>
        )}
      </div>
    </section>
  );
}

/** Planos y archivos (imagen o PDF) que salen como anexos al final del PDF del presupuesto. */
function AdjuntosCard({ cot, puedeEscribir, onCot }) {
  const [titulo, setTitulo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [claveInput, setClaveInput] = useState(0);
  const [quitando, setQuitando] = useState(null); // el adjunto que se está por quitar (espera la confirmación)
  const idTitulo = useId();

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

  async function quitar() {
    const adjunto = quitando;
    setQuitando(null);
    await ejecutar(() => api.del(`/cotizaciones/adjuntos/${adjunto.id}`));
  }

  return (
    <section className="tarjeta" id="ed-adjuntos" aria-labelledby="ed-t-adjuntos">
      <div className="tarjeta-cab">
        <div>
          <h2 id="ed-t-adjuntos">Planos y archivos adjuntos</h2>
          <p className="sub">
            Podés adjuntar imágenes (JPG o PNG) y archivos PDF. Salen como anexos al final del PDF del presupuesto, en el orden en que los cargues. Hasta 10 por presupuesto y 25 MB cada uno.
          </p>
        </div>
      </div>
      <div className="tarjeta-cuerpo">
        {error && (
          <div className="aviso aviso--error" role="alert" style={{ marginBottom: 'var(--s-3)' }}>
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">{error}</div>
          </div>
        )}

        {cot.adjuntos.length === 0 ? (
          <p className="sub">Todavía no hay adjuntos.</p>
        ) : (
          <div>
            {cot.adjuntos.map((a) => (
              <div className="adjunto" key={a.id}>
                <a href={`/api/cotizaciones/adjuntos/${a.id}/archivo`} target="_blank" rel="noreferrer" title="Abrir">
                  {a.tipo === 'imagen' ? (
                    <img className="adjunto-mini" src={`/api/cotizaciones/adjuntos/${a.id}/archivo`} alt={a.nombre_original} />
                  ) : (
                    <span className="adjunto-mini adjunto-mini--pdf">PDF</span>
                  )}
                </a>
                <div className="adjunto-datos">
                  <input
                    key={`t-${a.id}-${a.titulo}`}
                    aria-label={`Título de ${a.nombre_original}`}
                    placeholder="Título (opcional, sale en el PDF)"
                    defaultValue={a.titulo || ''}
                    disabled={!puedeEscribir}
                    onBlur={(e) => (e.target.value.trim() || null) !== (a.titulo || null) && cambiar(a, { titulo: e.target.value })}
                  />
                  <span className="sub">
                    {a.nombre_original} · {tamanoLegible(a.tamano)}
                    {a.tipo === 'pdf' ? ` · ${a.paginas} ${a.paginas === 1 ? 'página' : 'páginas'}` : ''}
                  </span>
                </div>
                <label className="check">
                  <input type="checkbox" checked={a.incluir_en_pdf} disabled={!puedeEscribir} onChange={(e) => cambiar(a, { incluir_en_pdf: e.target.checked })} />
                  Incluir en el PDF
                </label>
                {puedeEscribir && (
                  <button type="button" className="boton boton--sm boton--peligro-suave" onClick={() => setQuitando(a)}>
                    Quitar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {puedeEscribir && cot.adjuntos.length < 10 && (
          <div className="fila" style={{ alignItems: 'flex-end', marginTop: 'var(--s-4)' }}>
            <div className="campo" style={{ minWidth: 260 }}>
              <label htmlFor={idTitulo}>
                Título del nuevo adjunto <span style={{ fontWeight: 400 }}>(opcional)</span>
              </label>
              <input id={idTitulo} value={titulo} placeholder="Ej.: Plano de la sala" onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <label className="boton" aria-disabled={subiendo} style={subiendo ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
              <Icono nombre="upload" />
              {subiendo ? 'Subiendo…' : 'Elegir archivo…'}
              <input key={claveInput} className="solo-lectores" type="file" accept="image/jpeg,image/png,application/pdf" disabled={subiendo} onChange={subir} />
            </label>
          </div>
        )}

        <div className="aviso aviso--info" style={{ marginTop: 'var(--s-4)' }}>
          <Icono nombre="info" />
          <div className="aviso-cuerpo">
            Los archivos se guardan en una carpeta del servidor que <strong>no entra en el backup automático</strong>: conviene respaldarla aparte.
          </div>
        </div>
      </div>

      {quitando && (
        <DialogoConfirmar titulo="¿Quitar el adjunto?" textoConfirmar="Sí, quitar" peligro onConfirmar={quitar} onCancelar={() => setQuitando(null)}>
          <p>
            Se quita <strong>{quitando.titulo || quitando.nombre_original}</strong> de este presupuesto y deja de salir en el PDF.
          </p>
        </DialogoConfirmar>
      )}
    </section>
  );
}

/** Los cuatro pasos de armar un presupuesto, con el que toca ahora resaltado. Cada uno lleva a su sección. */
function Pasos({ pasos }) {
  return (
    <ol className="pasos" aria-label="Pasos del presupuesto">
      {pasos.map((p, i) => (
        <li key={p.id}>
          {i > 0 && <span className="sep" aria-hidden="true" />}
          <button type="button" className={`paso${p.hecho ? ' paso--hecho' : ''}${p.actual ? ' paso--actual' : ''}`} aria-current={p.actual ? 'step' : undefined} onClick={() => irA(p.destino)}>
            <span className="n">{p.hecho ? <Icono nombre="check" /> : i + 1}</span>
            {p.texto}
            {p.opcional && <span className="opcional">(opcional)</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Opciones de la lista de precios: las vigentes y, aparte, el historial de la General. */
function OpcionesDeLista({ versiones, conGeneral = false }) {
  const vigentes = versiones.filter((v) => !v.es_historial && (conGeneral || !v.es_general));
  const historial = versiones.filter((v) => v.es_historial);
  return (
    <>
      <optgroup label="Vigentes">
        {vigentes.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nombre}
          </option>
        ))}
      </optgroup>
      {historial.length > 0 && (
        <optgroup label="Historial de la General">
          {historial.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nombre}
            </option>
          ))}
        </optgroup>
      )}
    </>
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
  const [dialogo, setDialogo] = useState(null); // la pregunta abierta: { tipo: 'confirmar' | 'rechazar' | 'eliminar' | 'lista', versionId? }
  const avisoErrorRef = useRef(null);
  const idDe = useId();

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
    setDialogo(null);
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

  // Un error se muestra arriba de todo: si la persona está más abajo (cargando ítems), se lo trae a la vista
  useEffect(() => {
    if (error) avisoErrorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

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

  const aplicarLista = (versionId) => operar(() => api.post(`/cotizaciones/${id}/lista`, { version_id: Number(versionId) }), 'Precios actualizados con la lista elegida.');

  /** Si hay precios cambiados a mano, antes de pisarlos se pregunta. */
  function cambiarLista(versionId) {
    if (cot.lineas.some((l) => l.precio_modificado)) setDialogo({ tipo: 'lista', versionId });
    else aplicarLista(versionId);
  }

  function guardarDescuento(valor) {
    const fraccion = textoAFraccion(valor) ?? 0;
    if (Number.isNaN(fraccion) || fraccion < 0 || fraccion > 1) return setError('El descuento tiene que ser un número entre 0 y 100 (por ejemplo 10 para 10 %)');
    if (fraccion === cot.descuento_porcentaje) return;
    operar(() => api.post(`/cotizaciones/${id}/descuento`, { descuento_porcentaje: fraccion }), 'Descuento actualizado.');
  }

  function confirmarCambioDeLista() {
    const { versionId } = dialogo;
    setDialogo(null);
    aplicarLista(versionId);
  }

  async function confirmarPresupuesto() {
    setDialogo(null);
    // Que quedó confirmado ya lo dice el aviso fijo de arriba: acá sólo se cuenta lo que pasó con el croquis
    await operar(
      () => api.post(`/cotizaciones/${id}/confirmar`),
      (r) => (r.croquis_en_lote === 'copiado' ? 'El croquis quedó guardado en el lote del stand.' : r.croquis_en_lote === 'lote_ya_tenia' ? 'El lote ya tenía un croquis, así que se conservó ese.' : '')
    );
  }

  async function rechazarPresupuesto() {
    setDialogo(null);
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
    setDialogo(null);
    try {
      await api.del(`/cotizaciones/${id}`);
      navigate('/presupuestos');
    } catch (err) {
      setError(err.message);
    }
  }

  if (!esNuevo && !cot) return error ? <div className="ed"><div className="aviso aviso--error" role="alert"><Icono nombre="warn" /><div className="aviso-cuerpo">{error}</div></div></div> : <p className="texto-suave">Cargando…</p>;

  const infoCuit = avisoDeCuit(infoCuitEdit, cot, form.cuit, guardado.cuit);
  const confirmada = cot?.estado === 'confirmada';
  const rechazada = cot?.estado === 'rechazada';

  // Lo que pide el servidor para confirmar, más que los datos estén guardados (se confirma lo guardado, no lo escrito)
  const requisitos = editable && cot ? [...cot.confirmable.requisitos, { clave: 'guardado', ok: !sinGuardar, texto: 'Datos guardados', motivo: 'Hay cambios sin guardar: guardá los datos' }] : [];
  const cumple = (clave) => cot?.confirmable.requisitos.find((r) => r.clave === clave)?.ok ?? false;
  const datosListos = cumple('evento') && cumple('lote') && !sinGuardar;
  const itemsListos = cumple('items') && cumple('precios');
  const puedeConfirmar = Boolean(cot) && cot.confirmable.ok && !sinGuardar && !trabajando;
  const pasos = [
    { id: 'datos', texto: 'Datos del cliente', destino: 'ed-datos', hecho: datosListos },
    { id: 'items', texto: 'Ítems', destino: 'ed-items', hecho: itemsListos },
    { id: 'croquis', texto: 'Croquis y adjuntos', destino: 'ed-croquis', hecho: Boolean(cot?.croquis) || (cot?.adjuntos.length ?? 0) > 0, opcional: true },
    { id: 'confirmar', texto: 'Confirmar', destino: 'ed-confirmar', hecho: false },
  ];
  pasos[!datosListos ? 0 : !itemsListos ? 1 : 3].actual = true; // el croquis y los adjuntos son opcionales: nunca "tocan"

  const accionesMenu = [
    puedeEscribir && cot && { texto: 'Duplicar', icono: 'copy', onSelect: duplicar },
    rechazada && puedeEscribir && { texto: 'Reabrir', icono: 'undo', onSelect: reabrirPresupuesto },
    editable && cot && { texto: 'Marcar como rechazado', icono: 'x-c', onSelect: () => setDialogo({ tipo: 'rechazar' }) },
    puedeEscribir && !confirmada && cot && { texto: 'Eliminar', icono: 'trash', onSelect: () => setDialogo({ tipo: 'eliminar' }), peligro: true, separadorAntes: true },
  ].filter(Boolean);

  const destino = cot ? `${cot.evento_nombre}, lote ${cot.lote}` : '';

  return (
    <div className="ed">
      <nav className="migas" aria-label="Ubicación">
        <Link to="/presupuestos">
          <Icono nombre="arrow-l" className="icono--sm" />
          Presupuestos
        </Link>
      </nav>

      <header className="pagina-cab">
        <div>
          <div className="titulo-fila">
            <h1>{esNuevo ? 'Nuevo presupuesto' : `Presupuesto ${cot.cod_fac || `N.º ${cot.id}`}`}</h1>
            {cot && <Sello estado={cot.estado} />}
          </div>
          <p className="sub">
            {esNuevo
              ? 'Cargá los datos del cliente y del stand; después agregás los ítems.'
              : `Cargado por ${cot.responsable || '—'} el ${fechaCorta(cot.fecha_carga)}${cot.estado === 'pendiente' ? ` · Válido hasta ${fechaCorta(cot.fecha_vencimiento)}` : ''}`}
          </p>
        </div>
        {cot && (
          <div className="fila" style={{ gap: 'var(--s-2)' }}>
            <a className="boton" href={`/api/cotizaciones/${cot.id}/pdf?ver=1`} target="_blank" rel="noreferrer">
              <Icono nombre="eye" />
              Ver PDF
            </a>
            <a className="boton" href={`/api/cotizaciones/${cot.id}/pdf`}>
              <Icono nombre="download" />
              Descargar PDF
            </a>
            <MenuMas acciones={accionesMenu} />
          </div>
        )}
      </header>

      <div className="avisos" ref={avisoErrorRef}>
        {error && (
          <div className="aviso aviso--error" role="alert">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">{error}</div>
          </div>
        )}
        {aviso && (
          <div className="aviso aviso--ok" role="status">
            <Icono nombre="check-c" />
            <div className="aviso-cuerpo">{aviso}</div>
          </div>
        )}
        {confirmada && (
          <div className="aviso aviso--ok">
            <Icono nombre="check-c" />
            <div className="aviso-cuerpo">
              Este presupuesto está confirmado y ya forma parte del evento{cot.evento_nombre ? <strong> {cot.evento_nombre}</strong> : ''}. Para cambiarlo, editalo dentro del evento.{' '}
              {cot.evento_id && <Link to={`/eventos/${cot.evento_id}`}>Ver el evento</Link>}
            </div>
          </div>
        )}
        {rechazada && (
          <div className="aviso aviso--aviso">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">
              {cot.rechazada_por ? 'Este presupuesto está marcado como rechazado' : <strong>Este presupuesto se rechazó solo porque no se confirmó antes de que terminara el evento</strong>}: queda como registro, de sólo
              lectura.{puedeEscribir && <> Se puede reabrir desde el menú <strong>⋯</strong>.</>}
            </div>
          </div>
        )}
        {opciones && !opciones.catalogo_cargado && !esNuevo && (
          <div className="aviso aviso--aviso">
            <Icono nombre="warn" />
            <div className="aviso-cuerpo">El catálogo todavía no está cargado (falta la carga inicial), así que no se pueden agregar ítems.</div>
          </div>
        )}
      </div>

      {cot && editable && <Pasos pasos={pasos} />}

      <div className={`editor${esNuevo ? ' editor--solo' : ''}`}>
        <div className="pila pila--grande">
          <form className="tarjeta" id="ed-datos" onSubmit={guardarDatos} aria-labelledby="ed-t-datos">
            <div className="tarjeta-cab">
              <div>
                <h2 id="ed-t-datos">Datos del cliente y del stand</h2>
                <p className="sub">Todos los datos son opcionales. Para confirmar hacen falta el evento y el número de stand.</p>
              </div>
              {editable && sinGuardar && !esNuevo && (
                <span className="mensaje mensaje--aviso" style={{ fontSize: 'var(--t-sm)' }}>
                  <Icono nombre="warn" />
                  Hay cambios sin guardar
                </span>
              )}
            </div>
            <div className="tarjeta-cuerpo pila pila--grande">
              <div className="grid grid-3">
                <div className="campo">
                  <label htmlFor={`${idDe}-evento`}>Expo (evento)</label>
                  {editable ? (
                    <BuscadorEvento id={`${idDe}-evento`} eventos={eventos} value={form.evento_id} onChange={(v) => cambiar('evento_id', v)} placeholder="Escribí para buscar el evento…" />
                  ) : (
                    <input id={`${idDe}-evento`} value={cot?.evento_nombre || ''} disabled />
                  )}
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-tipo`}>Tipo</label>
                  <select id={`${idDe}-tipo`} value={form.tipo} disabled={!editable} onChange={(e) => cambiar('tipo', e.target.value)}>
                    <option value="">—</option>
                    {(opciones?.tipos || []).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-lote`}>Lote (N.º de stand)</label>
                  <input id={`${idDe}-lote`} value={form.lote} disabled={!editable} onChange={(e) => cambiar('lote', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-stand`}>Nombre del stand</label>
                  <input id={`${idDe}-stand`} value={form.nombre_stand} disabled={!editable} onChange={(e) => cambiar('nombre_stand', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-razon`}>Razón social</label>
                  <BuscadorCliente id={`${idDe}-razon`} value={form.razon_social} disabled={!editable} onChange={(v) => cambiar('razon_social', v)} onElegir={elegirCliente} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-cuit`}>CUIT</label>
                  <input
                    id={`${idDe}-cuit`}
                    value={form.cuit}
                    disabled={!editable}
                    placeholder={editable ? 'Ej.: 30-52830354-0' : ''}
                    onChange={(e) => {
                      cambiar('cuit', e.target.value);
                      setInfoCuitEdit(null);
                    }}
                    onBlur={revisarCuit}
                  />
                  {infoCuit && (
                    <span className={`mensaje ${AVISOS_CUIT[infoCuit.tipo].clase}`}>
                      <Icono nombre={AVISOS_CUIT[infoCuit.tipo].icono} />
                      <span>{AVISOS_CUIT[infoCuit.tipo].texto(infoCuit)}</span>
                    </span>
                  )}
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-direccion`}>Dirección</label>
                  <input id={`${idDe}-direccion`} value={form.direccion} disabled={!editable} onChange={(e) => cambiar('direccion', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-contacto`}>Contacto</label>
                  <input id={`${idDe}-contacto`} value={form.contacto} disabled={!editable} onChange={(e) => cambiar('contacto', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-mail`}>Mail</label>
                  <input id={`${idDe}-mail`} type="email" value={form.mail} disabled={!editable} onChange={(e) => cambiar('mail', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idDe}-telefono`}>Teléfono</label>
                  <input id={`${idDe}-telefono`} value={form.telefono} disabled={!editable} onChange={(e) => cambiar('telefono', e.target.value)} />
                </div>
                {esNuevo && (
                  <div className="campo">
                    <label htmlFor={`${idDe}-lista`}>Lista de precios</label>
                    <select id={`${idDe}-lista`} value={listaInicial} disabled={!editable} onChange={(e) => setListaInicial(e.target.value)}>
                      <option value="">General (por defecto)</option>
                      <OpcionesDeLista versiones={opciones?.versiones || []} />
                    </select>
                    <span className="ayuda">Con qué precios arranca. Se puede volver a cambiar después, desde "Ítems".</span>
                  </div>
                )}
              </div>

              <div>
                <div className="campo-etiqueta" style={{ marginBottom: 'var(--s-2)' }}>
                  Se completan solos
                </div>
                <div className="grid grid-4">
                  <div className="campo campo--derivado">
                    <label htmlFor={`${idDe}-responsable`}>Responsable</label>
                    <input id={`${idDe}-responsable`} value={cot ? cot.responsable || '' : usuario?.nombre_completo || usuario?.nombre_usuario || ''} disabled />
                  </div>
                  <div className="campo campo--derivado">
                    <label htmlFor={`${idDe}-fecha`}>Fecha de carga</label>
                    <input id={`${idDe}-fecha`} value={cot ? fechaCorta(cot.fecha_carga) : fechaCorta(new Date().toISOString())} disabled />
                  </div>
                  <div className="campo campo--derivado">
                    <label htmlFor={`${idDe}-idcliente`}>ID de cliente</label>
                    <input id={`${idDe}-idcliente`} value={cot?.id_cliente || ''} placeholder="Se completa solo" disabled />
                  </div>
                  <div className="campo campo--derivado">
                    <label htmlFor={`${idDe}-numero`}>N.º de presupuesto</label>
                    <input id={`${idDe}-numero`} value={cot?.numero || ''} placeholder="Se completa solo" disabled />
                  </div>
                </div>
                <p className="ayuda" style={{ marginTop: 'var(--s-2)' }}>
                  El ID de cliente sale de la expo, el tipo, el nombre del stand, el responsable y el lote; aparece cuando están todos cargados y guardados. El número de presupuesto es correlativo por cliente.
                </p>
              </div>

              <div className="campo">
                <label htmlFor={`${idDe}-notas`}>
                  Observaciones <span style={{ fontWeight: 400, color: 'var(--c-texto-3)' }}>(salen en el PDF)</span>
                </label>
                <textarea id={`${idDe}-notas`} rows={2} value={form.notas} disabled={!editable} onChange={(e) => cambiar('notas', e.target.value)} />
              </div>
            </div>
            {editable && (
              <div className="tarjeta-pie fila fila--entre">
                <span className="ayuda">{esNuevo ? '' : 'Responsable, fecha, ID y número se completan solos.'}</span>
                <button type="submit" className="boton boton--primario" disabled={trabajando || (!esNuevo && !sinGuardar)}>
                  {esNuevo ? 'Crear y cargar ítems' : sinGuardar ? 'Guardar datos' : 'Datos guardados'}
                </button>
              </div>
            )}
          </form>

          {cot && (
            <section className="tarjeta" id="ed-items" aria-labelledby="ed-t-items">
              <div className="tarjeta-cab">
                <h2 id="ed-t-items">Ítems</h2>
                <div className="fila" style={{ gap: 'var(--s-4)' }}>
                  <div className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--s-2)' }}>
                    <label htmlFor={`${idDe}-lista-items`} style={{ whiteSpace: 'nowrap' }}>
                      Lista de precios
                    </label>
                    <select id={`${idDe}-lista-items`} style={{ minWidth: 210 }} value={cot.catalogo_version_id || ''} disabled={!editable || trabajando} onChange={(e) => cambiarLista(e.target.value)}>
                      <OpcionesDeLista versiones={opciones?.versiones || []} conGeneral />
                    </select>
                  </div>
                  <div className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--s-2)' }}>
                    <label htmlFor={`${idDe}-descuento`} style={{ whiteSpace: 'nowrap' }}>
                      Descuento especial
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id={`${idDe}-descuento`}
                        key={`desc-${cot.id}-${cot.descuento_porcentaje}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="0"
                        style={{ width: 92, paddingRight: 26, textAlign: 'right' }}
                        defaultValue={cot.descuento_porcentaje ? fraccionATexto(cot.descuento_porcentaje) : ''}
                        disabled={!editable || trabajando}
                        onBlur={(e) => guardarDescuento(e.target.value)}
                      />
                      <span aria-hidden="true" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-texto-2)' }}>
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {editable && opciones?.catalogo_cargado && (
                <div className="tarjeta-cuerpo" style={{ borderBottom: '1px solid var(--c-borde)' }}>
                  <AgregarItem versionId={cot.catalogo_version_id} onAgregar={agregarItem} />
                </div>
              )}

              {cot.lineas.length === 0 ? (
                <div className="vacio">
                  <span className="icono-vacio">
                    <Icono nombre="list" className="icono--lg" />
                  </span>
                  <h3>Todavía no se cargaron ítems</h3>
                  <p>{editable ? 'Buscá un ítem del catálogo por código o descripción y elegí la cantidad.' : 'Este presupuesto no tiene ítems.'}</p>
                </div>
              ) : (
                <div className="tabla-scroll">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th className="num">Cantidad</th>
                        <th className="num">Precio unitario</th>
                        <th className="num">Total</th>
                        <th>
                          <span className="solo-lectores">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cot.lineas.map((l) => (
                        <tr key={l.id}>
                          <td className="codigo">{l.codigo}</td>
                          <td>
                            <span className="descripcion-linea">{l.descripcion}</span>
                            {editable ? (
                              <input
                                key={`c-${l.id}-${l.comentario}`}
                                className="comentario-linea"
                                aria-label={`Comentario de ${l.codigo}`}
                                placeholder="Comentario (opcional)"
                                defaultValue={l.comentario || ''}
                                onBlur={(e) => guardarComentario(l, e.target.value)}
                              />
                            ) : (
                              l.comentario && <span className="sub comentario-fijo">{l.comentario}</span>
                            )}
                          </td>
                          <td className="num">
                            <input
                              key={`q-${l.id}-${l.cantidad}`}
                              className="input-tabla input-cantidad"
                              aria-label={`Cantidad de ${l.codigo}`}
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
                              className={`input-tabla${l.precio_unitario === null ? ' sin-precio' : ''}`}
                              aria-label={`Precio unitario de ${l.codigo}`}
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Sin precio"
                              defaultValue={l.precio_unitario ?? ''}
                              disabled={!editable}
                              onBlur={(e) => guardarPrecio(l, e.target.value)}
                            />
                            {l.precio_modificado && (
                              <span className="sub" title="El precio de la lista de precios era distinto">
                                lista: {pesos(l.precio_catalogo)}
                              </span>
                            )}
                          </td>
                          <td className="num celda-total">
                            {l.precio_unitario === null ? (
                              <span className="mensaje mensaje--error" style={{ justifyContent: 'flex-end' }}>
                                <Icono nombre="warn" />
                                Sin precio
                              </span>
                            ) : (
                              <strong>{pesos(l.subtotal)}</strong>
                            )}
                          </td>
                          <td className="acciones">
                            {editable && (
                              <button
                                type="button"
                                className="boton boton--sm boton--icono boton--peligro-suave"
                                aria-label={`Quitar ${l.codigo}`}
                                title="Quitar"
                                onClick={() => operar(() => api.del(`/cotizaciones/lineas/${l.id}`))}
                              >
                                <Icono nombre="x" className="icono--sm" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {cot.lineas.length > 0 && (
                <div className="total-compacto" aria-hidden="true">
                  <span>Total (IVA incluido)</span>
                  <strong>{pesos(cot.totales.total)}</strong>
                </div>
              )}
            </section>
          )}

          {cot && <CroquisCard cot={cot} puedeEscribir={puedeEscribir} onCot={setCot} />}

          {cot && <AdjuntosCard cot={cot} puedeEscribir={puedeEscribir} onCot={setCot} />}
        </div>

        {cot && (
          <aside className="riel" aria-label="Resumen del presupuesto">
            <section className="tarjeta" aria-labelledby="ed-t-resumen">
              <div className="tarjeta-cab">
                <h2 id="ed-t-resumen">Resumen</h2>
                {cot.lineas.length > 0 && <span className="sub">{cot.lineas.length === 1 ? '1 ítem' : `${cot.lineas.length} ítems`}</span>}
              </div>
              <div className="tarjeta-cuerpo">
                {cot.lineas.length === 0 ? (
                  <p className="sub">Todavía no hay ítems.</p>
                ) : (
                  <>
                    {cot.totales.descuento > 0 ? (
                      <>
                        <div className="resumen-fila">
                          <span>Subtotal</span>
                          <strong>{pesos(cot.totales.subtotal_bruto)}</strong>
                        </div>
                        <div className="resumen-fila resumen-fila--desc">
                          <span>Descuento {fraccionATexto(cot.totales.descuento_porcentaje)} %</span>
                          <strong>-{pesos(cot.totales.descuento)}</strong>
                        </div>
                        <div className="resumen-fila">
                          <span>Subtotal con descuento</span>
                          <strong>{pesos(cot.totales.subtotal)}</strong>
                        </div>
                      </>
                    ) : (
                      <div className="resumen-fila">
                        <span>Subtotal</span>
                        <strong>{pesos(cot.totales.subtotal)}</strong>
                      </div>
                    )}
                    <div className="resumen-fila">
                      <span>IVA {fraccionATexto(cot.totales.iva_porcentaje)} %</span>
                      <strong>{pesos(cot.totales.iva)}</strong>
                    </div>
                    <div className="resumen-fila resumen-fila--total">
                      <span>Total</span>
                      <strong>{pesos(cot.totales.total)}</strong>
                    </div>
                    {cot.totales.lineas_sin_precio > 0 && (
                      <p className="mensaje mensaje--error" style={{ marginTop: 8 }}>
                        <Icono nombre="warn" />
                        <span>{cot.totales.lineas_sin_precio} ítem(s) sin precio no suman al total.</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>

            {editable && (
              <section className="tarjeta" id="ed-confirmar" aria-labelledby="ed-t-confirmar">
                <div className="tarjeta-cab">
                  <h2 id="ed-t-confirmar">Para confirmar</h2>
                </div>
                <div className="tarjeta-cuerpo pila">
                  <ul className="requisitos">
                    {requisitos.map((r) => (
                      <li key={r.clave} className={r.ok ? 'cumple' : 'falta'}>
                        <Icono nombre={r.ok ? 'check-c' : 'x-c'} />
                        <span>{r.ok ? r.texto : r.motivo || r.texto}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="pila" style={{ gap: 'var(--s-2)' }}>
                    <button type="button" className="boton boton--primario boton--bloque" disabled={!puedeConfirmar} onClick={() => setDialogo({ tipo: 'confirmar' })}>
                      <Icono nombre="check-c" />
                      Confirmar presupuesto
                    </button>
                    <p className="ayuda">{puedeConfirmar ? 'Todo listo: al confirmar pasa a ser parte del evento.' : 'Completá lo que falta para poder confirmar.'}</p>
                  </div>
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      {dialogo?.tipo === 'lista' && (
        <DialogoConfirmar titulo="¿Cambiar la lista de precios?" textoConfirmar="Sí, cambiar la lista" onConfirmar={confirmarCambioDeLista} onCancelar={() => setDialogo(null)}>
          <p>
            Se vuelven a poner los precios de la lista en todos los ítems, y <strong>se pisan los que cambiaste a mano</strong>.
          </p>
        </DialogoConfirmar>
      )}
      {dialogo?.tipo === 'confirmar' && (
        <DialogoConfirmar titulo="¿Confirmar el presupuesto?" textoConfirmar="Sí, confirmar" onConfirmar={confirmarPresupuesto} onCancelar={() => setDialogo(null)}>
          <p>
            Pasa a ser parte del evento <strong>{destino}</strong>. Después ya no se edita desde acá, sino dentro del evento.
          </p>
        </DialogoConfirmar>
      )}
      {dialogo?.tipo === 'rechazar' && (
        <DialogoConfirmar titulo="¿Marcar como rechazado?" textoConfirmar="Marcar como rechazado" onConfirmar={rechazarPresupuesto} onCancelar={() => setDialogo(null)}>
          <p>No se borra: queda como registro de sólo lectura y se puede reabrir después si hace falta.</p>
        </DialogoConfirmar>
      )}
      {dialogo?.tipo === 'eliminar' && (
        <DialogoConfirmar titulo="¿Eliminar el presupuesto?" textoConfirmar="Sí, eliminar" textoCancelar="No, volver" peligro onConfirmar={eliminar} onCancelar={() => setDialogo(null)}>
          <p>
            Se borra con todos sus ítems. <strong>No se puede deshacer.</strong>
          </p>
        </DialogoConfirmar>
      )}
    </div>
  );
}
