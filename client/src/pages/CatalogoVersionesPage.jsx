import { useEffect, useState } from 'react';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { fechaCorta, fechaLarga, fraccionATexto, pesos, porcentaje, textoAFraccion } from '../catalogoFormat';

const VACIA = { nombre: '', porcentaje: '', aplicar_a_todos: false, fecha_vigencia: '', pie_legal: '' };

function FormularioVersion({ valor, onCambio, esGeneral }) {
  return (
    <>
      <div className="form-grid">
        <div className="campo">
          <label>Nombre (normalmente el del evento)</label>
          <input value={valor.nombre} required disabled={esGeneral} onChange={(e) => onCambio({ ...valor, nombre: e.target.value })} />
        </div>
        <div className="campo">
          <label>Porcentaje general (%)</label>
          <input value={valor.porcentaje} required placeholder="ej. 55" onChange={(e) => onCambio({ ...valor, porcentaje: e.target.value })} />
        </div>
        <div className="campo">
          <label>Vigencia (pie del catálogo)</label>
          <input type="date" value={valor.fecha_vigencia} onChange={(e) => onCambio({ ...valor, fecha_vigencia: e.target.value })} />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '12px 0' }}>
        <input type="checkbox" checked={valor.aplicar_a_todos} onChange={(e) => onCambio({ ...valor, aplicar_a_todos: e.target.checked })} />
        Aplicar a todos (también pisa los ítems con porcentaje propio, como los televisores al 100 %)
      </label>
      <div className="campo">
        <label>Pie legal propio (opcional; usá {'{fecha_vigencia}'} donde va la fecha)</label>
        <textarea rows={3} value={valor.pie_legal} onChange={(e) => onCambio({ ...valor, pie_legal: e.target.value })} placeholder="Vacío = el pie legal de los ajustes" />
      </div>
    </>
  );
}

const VACIA_IMPORTAR = { nombre: '', aplicar_a_todos: false, fecha_vigencia: '', pie_legal: '' };

/**
 * Crear una versión con los precios finales de un evento puntual, leídos de un archivo (la misma
 * planilla de presupuesto de siempre, hoja DATOS con una columna que empieza con "SAE..."). A
 * diferencia de "Nueva versión para un evento", acá no se aplica ningún porcentaje: el precio de
 * cada ítem es el que trae el archivo, tal cual, y la versión queda fija (no se recalcula sola).
 */
function ImportarVersionCard({ onCreada }) {
  const [datos, setDatos] = useState(VACIA_IMPORTAR);
  const [archivo, setArchivo] = useState(null);
  const [claveInput, setClaveInput] = useState(0);
  const [vista, setVista] = useState(null);
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');

  function limpiar() {
    setVista(null);
    setArchivo(null);
    setDatos(VACIA_IMPORTAR);
    setClaveInput((n) => n + 1);
  }

  async function revisar(e) {
    e.preventDefault();
    if (!archivo) return;
    setError('');
    setTrabajando('Leyendo y comparando…');
    try {
      const formulario = new FormData();
      formulario.append('archivo', archivo);
      formulario.append('nombre', datos.nombre);
      formulario.append('aplicar_a_todos', String(datos.aplicar_a_todos));
      if (datos.fecha_vigencia) formulario.append('fecha_vigencia', datos.fecha_vigencia);
      if (datos.pie_legal.trim()) formulario.append('pie_legal', datos.pie_legal.trim());
      setVista(await catalogoApi.post('/versiones/importar', formulario));
    } catch (err) {
      setVista(null);
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  }

  async function confirmar() {
    const advertencias = [
      vista.codigos_desconocidos.length > 0 ? `${vista.codigos_desconocidos.length} código(s) del archivo no existen en el catálogo` : '',
      vista.advertencias.codigos_repetidos_en_el_archivo.length > 0 ? `${vista.advertencias.codigos_repetidos_en_el_archivo.length} código(s) repetidos en el archivo (gana la primera fila)` : '',
    ].filter(Boolean);
    const texto =
      `Se crea la versión "${datos.nombre}" con ${vista.resumen.itemsConPrecio} ítems con precio y ${vista.resumen.itemsSinPrecio} sin precio. Queda fija: no se toca con una base parche nueva.\n\n` +
      (advertencias.length > 0 ? `Ojo: ${advertencias.join('; ')}.\n\n` : '') +
      '¿Confirmás?';
    if (!confirm(texto)) return;
    setError('');
    setTrabajando('Creando…');
    try {
      const creada = await catalogoApi.post('/versiones/importar/confirmar', { token: vista.token });
      limpiar();
      onCreada(creada);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Importar una versión desde un archivo</h3>
      <p className="texto-suave" style={{ marginTop: 0 }}>
        Para cuando el precio final de cada ítem ya está decidido en una planilla de presupuesto (hoja DATOS, con una columna de precio que empiece con "SAE..."), en vez de aplicar un porcentaje. Primero se muestra qué encontró; recién al confirmar se crea la versión.
      </p>
      {error && <div className="aviso error">{error}</div>}

      {!vista ? (
        <form onSubmit={revisar}>
          <div className="form-grid">
            <div className="campo">
              <label>Nombre (normalmente el del evento)</label>
              <input value={datos.nombre} required onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
            </div>
            <div className="campo">
              <label>Vigencia (pie del catálogo)</label>
              <input type="date" value={datos.fecha_vigencia} onChange={(e) => setDatos({ ...datos, fecha_vigencia: e.target.value })} />
            </div>
            <div className="campo">
              <label>Archivo (.xlsx o .xlsm)</label>
              <input key={claveInput} type="file" accept=".xlsx,.xlsm" required onChange={(e) => setArchivo(e.target.files[0] || null)} />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '12px 0' }}>
            <input type="checkbox" checked={datos.aplicar_a_todos} onChange={(e) => setDatos({ ...datos, aplicar_a_todos: e.target.checked })} />
            Aplicar a todos (sólo a modo de referencia: el precio de cada ítem siempre es el del archivo)
          </label>
          <div className="campo" style={{ marginBottom: 12 }}>
            <label>Pie legal propio (opcional)</label>
            <textarea rows={2} value={datos.pie_legal} onChange={(e) => setDatos({ ...datos, pie_legal: e.target.value })} placeholder="Vacío = el pie legal de los ajustes" />
          </div>
          <button type="submit" className="primario" disabled={!archivo || !datos.nombre.trim() || Boolean(trabajando)}>
            {trabajando || 'Revisar antes de crear'}
          </button>
        </form>
      ) : (
        <div>
          <div className="aviso advertencia">
            <strong>Todavía no se creó nada.</strong> Se leyó "{vista.archivo}" (columna de precio: "{vista.columna_precio}").
          </div>
          <div className="toolbar">
            <button className="primario" onClick={confirmar} disabled={Boolean(trabajando)}>
              {trabajando || `Confirmar y crear "${datos.nombre}"`}
            </button>
            <button onClick={limpiar} disabled={Boolean(trabajando)}>
              Descartar
            </button>
          </div>

          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="campo">
              <label>Con precio</label>
              <strong className="cifra">{vista.resumen.itemsConPrecio}</strong>
            </div>
            <div className="campo">
              <label>Sin precio en el archivo</label>
              <strong className="cifra">{vista.resumen.itemsSinPrecio}</strong>
            </div>
            <div className="campo">
              <label>Códigos del archivo que no existen en el catálogo</label>
              <strong className="cifra">{vista.resumen.codigosDesconocidos}</strong>
            </div>
          </div>

          {vista.advertencias.codigos_repetidos_en_el_archivo.length > 0 && (
            <p className="texto-suave">
              Códigos repetidos en el archivo (gana la primera fila): {vista.advertencias.codigos_repetidos_en_el_archivo.map((d) => d.codigo).join(', ')}
            </p>
          )}
          {vista.codigos_desconocidos.length > 0 && (
            <p className="texto-suave">
              En el archivo pero no en el catálogo: {vista.codigos_desconocidos.map((c) => `${c.codigo} (fila ${c.fila})`).join(', ')}
            </p>
          )}

          <div className="tabla-scroll" style={{ maxHeight: 320 }}>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th className="num">Precio nuevo</th>
                  <th className="num">General hoy</th>
                  <th className="num">Variación</th>
                </tr>
              </thead>
              <tbody>
                {vista.items_con_precio.map((i) => (
                  <tr key={i.codigo}>
                    <td>{i.codigo}</td>
                    <td>{i.descripcion}</td>
                    <td className="num">{pesos(i.sae_nuevo)}</td>
                    <td className="num">{i.sae_general_actual !== null ? pesos(i.sae_general_actual) : '—'}</td>
                    <td className="num">{i.variacion_pct !== null ? `${i.variacion_pct > 0 ? '+' : ''}${i.variacion_pct} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vista.items_sin_precio.length > 0 && (
            <p className="texto-suave" style={{ marginBottom: 0 }}>
              Sin precio en el archivo (quedan "S / P" en esta versión): {vista.items_sin_precio.map((i) => i.codigo).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function aCuerpo(valor, { conNombre }) {
  const fraccion = textoAFraccion(valor.porcentaje);
  if (fraccion === null || Number.isNaN(fraccion)) throw new Error('El porcentaje tiene que ser un número (por ejemplo 55 para 55 %)');
  const cuerpo = { porcentaje_global: fraccion, aplicar_a_todos: valor.aplicar_a_todos, pie_legal: valor.pie_legal.trim() || null };
  if (valor.fecha_vigencia) cuerpo.fecha_vigencia = valor.fecha_vigencia;
  if (conNombre) cuerpo.nombre = valor.nombre;
  return cuerpo;
}

export function CatalogoVersionesPage() {
  const { usuario, puedeEscribir } = useAuth();
  const [versiones, setVersiones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [nueva, setNueva] = useState(VACIA);
  const [editando, setEditando] = useState(null);
  const [formEdicion, setFormEdicion] = useState(VACIA);
  const [trabajando, setTrabajando] = useState(false);

  async function cargar() {
    try {
      setVersiones(await catalogoApi.get('/versiones'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function ejecutar(accion, mensaje) {
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      await accion();
      if (mensaje) setAviso(mensaje);
      await cargar();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function crear(e) {
    e.preventDefault();
    let cuerpo;
    try {
      cuerpo = aCuerpo(nueva, { conNombre: true });
    } catch (err) {
      return setError(err.message);
    }
    const ok = await ejecutar(() => catalogoApi.post('/versiones', cuerpo), `Versión "${nueva.nombre}" creada con todos sus precios calculados.`);
    if (ok) setNueva(VACIA);
  }

  function abrirEdicion(v) {
    setEditando(v);
    setFormEdicion({
      nombre: v.nombre,
      porcentaje: fraccionATexto(v.porcentaje_global),
      aplicar_a_todos: v.aplicar_a_todos === 1,
      fecha_vigencia: v.fecha_vigencia || '',
      pie_legal: v.pie_legal || '',
    });
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    let cuerpo;
    try {
      cuerpo = aCuerpo(formEdicion, { conNombre: !editando.es_general });
    } catch (err) {
      return setError(err.message);
    }
    const ok = await ejecutar(() => catalogoApi.put(`/versiones/${editando.id}`, cuerpo), 'Versión guardada.');
    if (ok) setEditando(null);
  }

  function duplicar(v) {
    const nombre = prompt('Nombre de la copia:', `${v.nombre} (copia)`);
    if (!nombre) return;
    ejecutar(() => catalogoApi.post(`/versiones/${v.id}/duplicar`, { nombre }), `Versión "${nombre}" creada (copia exacta de los precios de "${v.nombre}").`);
  }

  function guardarHistorial(general) {
    const nombre = prompt('Nombre para guardar la lista General de hoy (por ejemplo la fecha o el motivo):', `General ${fechaCorta(new Date().toISOString())}`);
    if (!nombre) return;
    ejecutar(
      () => catalogoApi.post(`/versiones/${general.id}/duplicar`, { nombre }),
      `Versión "${nombre}" guardada. Queda con los precios de hoy, fija: no se toca cuando cambien los precios.`
    );
  }

  function renombrarHistorial(v) {
    const nombre = prompt('Nuevo nombre para esta versión guardada:', v.nombre);
    if (!nombre || nombre === v.nombre) return;
    ejecutar(() => catalogoApi.put(`/versiones/${v.id}`, { nombre }), 'Nombre actualizado.');
  }

  function recalcular(v) {
    if (!confirm(`¿Recalcular "${v.nombre}" con las reglas y la base parche de hoy? Los precios guardados de esta versión van a cambiar.`)) return;
    ejecutar(() => catalogoApi.post(`/versiones/${v.id}/recalcular`), `"${v.nombre}" recalculada.`);
  }

  function borrar(v) {
    if (!confirm(`¿Borrar la versión "${v.nombre}"? Se pierde su foto de precios.`)) return;
    ejecutar(() => catalogoApi.del(`/versiones/${v.id}`), `Versión "${v.nombre}" borrada.`);
  }

  if (cargando) return <p className="texto-suave">Cargando…</p>;

  const general = versiones.find((v) => v.es_general === 1);
  const principales = versiones.filter((v) => !v.es_historial);
  const historial = versiones.filter((v) => v.es_historial === 1);

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      {usuario?.rol === 'admin' && (
        <ImportarVersionCard
          onCreada={(creada) => {
            setAviso(`Versión "${creada.nombre}" creada con los precios del archivo.`);
            cargar();
          }}
        />
      )}

      {puedeEscribir && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nueva versión para un evento</h3>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Recalcula todos los precios con otro porcentaje y el mismo redondeo. Queda guardada tal cual: aunque después cambie la base, se puede reimprimir igual.
          </p>
          <form onSubmit={crear}>
            <FormularioVersion valor={nueva} onCambio={setNueva} />
            <button type="submit" className="primario" disabled={trabajando} style={{ marginTop: 12 }}>
              {trabajando ? 'Calculando…' : '+ Crear versión'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Versión</th>
                <th className="num">Porcentaje</th>
                <th>Vigencia</th>
                <th className="num">Con precio</th>
                <th className="num">Sin precio</th>
                <th>Estado</th>
                <th>Creada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {principales.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.nombre}</strong> {v.es_general === 1 && <span className="badge tipo">General</span>}
                    {v.aplicar_a_todos === 1 && <span className="badge baja" title="Pisa también los porcentajes propios">a todos</span>}
                  </td>
                  <td className="num">{porcentaje(v.porcentaje_global)}</td>
                  <td>{v.fecha_vigencia ? fechaLarga(v.fecha_vigencia) : '—'}</td>
                  <td className="num">{v.items_con_precio}</td>
                  <td className="num">{v.items_sin_precio}</td>
                  <td>
                    {v.items_desactualizados > 0 ? (
                      <span className="badge sin_precio" title="Su precio guardado ya no coincide con las reglas de hoy">
                        {v.items_desactualizados} desactualizados
                      </span>
                    ) : (
                      <span className="badge ok">al día</span>
                    )}
                  </td>
                  <td className="texto-suave">{fechaCorta(v.creado_en)}</td>
                  <td className="acciones-fila">
                    <a className="boton" href={`/api/catalogo/versiones/${v.id}/pdf`}>
                      PDF
                    </a>
                    {puedeEscribir && (
                      <>
                        <button onClick={() => abrirEdicion(v)}>Editar</button>
                        {v.es_general === 0 && <button onClick={() => duplicar(v)}>Duplicar</button>}
                        {v.es_general === 0 && <button onClick={() => recalcular(v)}>Recalcular</button>}
                        {v.es_general === 0 && (
                          <button className="peligro" onClick={() => borrar(v)}>
                            Borrar
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="texto-suave" style={{ marginBottom: 0 }}>
          Cuando cambian los precios de la base parche se recalculan todas las versiones (con aviso antes de confirmar). Si sólo editás reglas o ítems, se recalcula la General y las de evento quedan como "desactualizadas" hasta que las recalcules.
        </p>
      </div>

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Historial y versiones fijas</h3>
          {puedeEscribir && general && (
            <button onClick={() => guardarHistorial(general)} disabled={trabajando}>
              + Guardar la versión de hoy
            </button>
          )}
        </div>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Acá quedan dos cosas: las versiones guardadas de la lista General (la del {porcentaje(general?.porcentaje_global)}) — con nombre, para volver a verlas más adelante — y las versiones importadas de un archivo (ver arriba). Todas quedan fijas: no cambian cuando se actualiza la base parche ni cuando se edita un ítem. Cada vez que se confirma una base parche nueva con cambios, se guarda sola una con la lista de la General de antes.
        </p>
        {historial.length === 0 ? (
          <p className="texto-suave" style={{ marginBottom: 0 }}>Todavía no hay ninguna guardada.</p>
        ) : (
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th className="num">Con precio</th>
                  <th className="num">Sin precio</th>
                  <th>Guardada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historial.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.nombre}</strong>{' '}
                      {v.origen_archivo ? (
                        <span className="badge tipo" title={`Importada de "${v.origen_archivo}"`}>
                          Importada
                        </span>
                      ) : (
                        <span className="badge ok" title="Foto guardada de la lista General">
                          General
                        </span>
                      )}
                      {v.origen_archivo && <div className="texto-suave">{v.origen_archivo}</div>}
                    </td>
                    <td className="num">{v.items_con_precio}</td>
                    <td className="num">{v.items_sin_precio}</td>
                    <td className="texto-suave">{fechaCorta(v.creado_en)}</td>
                    <td className="acciones-fila">
                      <a className="boton" href={`/api/catalogo/versiones/${v.id}/pdf`}>
                        PDF
                      </a>
                      {puedeEscribir && (
                        <>
                          <button onClick={() => renombrarHistorial(v)}>Renombrar</button>
                          <button className="peligro" onClick={() => borrar(v)}>
                            Borrar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editando && (
        <Modal onClose={() => setEditando(null)}>
          <h3 style={{ marginTop: 0 }}>Editar versión "{editando.nombre}"</h3>
          <form onSubmit={guardarEdicion}>
            <FormularioVersion valor={formEdicion} onCambio={setFormEdicion} esGeneral={editando.es_general === 1} />
            <p className="texto-suave">Si cambiás el porcentaje o "aplicar a todos", los precios de esta versión se recalculan al guardar.</p>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button type="submit" className="primario" disabled={trabajando}>
                Guardar
              </button>
              <button type="button" onClick={() => setEditando(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
