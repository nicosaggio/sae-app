import { useEffect, useState } from 'react';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { fechaCorta, fechaLarga, fraccionATexto, porcentaje, textoAFraccion } from '../catalogoFormat';

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

function aCuerpo(valor, { conNombre }) {
  const fraccion = textoAFraccion(valor.porcentaje);
  if (fraccion === null || Number.isNaN(fraccion)) throw new Error('El porcentaje tiene que ser un número (por ejemplo 55 para 55 %)');
  const cuerpo = { porcentaje_global: fraccion, aplicar_a_todos: valor.aplicar_a_todos, pie_legal: valor.pie_legal.trim() || null };
  if (valor.fecha_vigencia) cuerpo.fecha_vigencia = valor.fecha_vigencia;
  if (conNombre) cuerpo.nombre = valor.nombre;
  return cuerpo;
}

export function CatalogoVersionesPage() {
  const { puedeEscribir } = useAuth();
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

  function recalcular(v) {
    if (!confirm(`¿Recalcular "${v.nombre}" con las reglas y la base parche de hoy? Los precios guardados de esta versión van a cambiar.`)) return;
    ejecutar(() => catalogoApi.post(`/versiones/${v.id}/recalcular`), `"${v.nombre}" recalculada.`);
  }

  function borrar(v) {
    if (!confirm(`¿Borrar la versión "${v.nombre}"? Se pierde su foto de precios.`)) return;
    ejecutar(() => catalogoApi.del(`/versiones/${v.id}`), `Versión "${v.nombre}" borrada.`);
  }

  if (cargando) return <p className="texto-suave">Cargando…</p>;

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

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
              {versiones.map((v) => (
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
                        <button onClick={() => duplicar(v)}>Duplicar</button>
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
