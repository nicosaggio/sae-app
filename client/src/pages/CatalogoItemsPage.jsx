import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { ItemCatalogoModal } from '../components/ItemCatalogoModal';
import { fraccionATexto, pesos, porcentaje, textoAFraccion } from '../catalogoFormat';

function EstadoPrecio({ item }) {
  if (item.estado_precio === 'ok') return null;
  return (
    <span className={`badge ${item.estado_precio === 'error' ? 'error' : 'sin_precio'}`} title={item.motivo_texto || ''}>
      {item.estado_precio === 'error' ? 'Error' : 'S / P'}
    </span>
  );
}

export function CatalogoItemsPage() {
  const { puedeEscribir } = useAuth();
  const [parametros, setParametros] = useSearchParams();
  const [todos, setTodos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [rubro, setRubro] = useState('');
  const [estado, setEstado] = useState('');
  const [publicado, setPublicado] = useState('');
  const [conBajas, setConBajas] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [editado, setEditado] = useState({ rubro: '', descripcion: '', porcentaje: '' });
  const [guardando, setGuardando] = useState(false);
  const [creando, setCreando] = useState(false);

  const abrirId = parametros.get('abrir') ? Number(parametros.get('abrir')) : null;

  async function cargar() {
    try {
      setTodos(await catalogoApi.get('/items?activo=todos'));
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

  const rubros = useMemo(() => [...new Set(todos.map((i) => i.rubro).filter(Boolean))].sort(), [todos]);
  const codigos = useMemo(() => todos.map((i) => i.codigo), [todos]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return todos.filter(
      (i) =>
        (conBajas || i.activo === 1) &&
        (!rubro || i.rubro === rubro) &&
        (!estado || i.estado_precio === estado) &&
        (publicado === '' || i.publicado === Number(publicado)) &&
        (!q || [i.codigo, i.descripcion].some((t) => t && t.toUpperCase().includes(q)))
    );
  }, [todos, busqueda, rubro, estado, publicado, conBajas]);

  const sinPrecio = todos.filter((i) => i.activo === 1 && i.estado_precio !== 'ok').length;

  function iniciarEdicion(item) {
    setEditandoId(item.id);
    setEditado({ rubro: item.rubro || '', descripcion: item.descripcion || '', porcentaje: fraccionATexto(item.porcentaje) });
  }

  async function guardarEdicion() {
    const fraccion = textoAFraccion(editado.porcentaje);
    if (Number.isNaN(fraccion)) return setError('El porcentaje tiene que ser un número (por ejemplo 55 para 55 %). Vacío = el porcentaje general.');
    setGuardando(true);
    setError('');
    try {
      await catalogoApi.put(`/items/${editandoId}`, { rubro: editado.rubro, descripcion: editado.descripcion, porcentaje: fraccion });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  function abrirItem(id) {
    setParametros(id ? { abrir: String(id) } : {});
  }

  if (cargando) return <p className="texto-suave">Cargando…</p>;

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="campo">
              <label htmlFor="buscar-item">Buscar</label>
              <input id="buscar-item" placeholder="Código o descripción" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="filtro-rubro">Rubro</label>
              <select id="filtro-rubro" value={rubro} onChange={(e) => setRubro(e.target.value)}>
                <option value="">Todos</option>
                {rubros.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="filtro-estado">Precio</label>
              <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option>
                <option value="ok">Con precio</option>
                <option value="sin_precio">Sin precio (S / P)</option>
                <option value="error">Con error</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="filtro-publicado">En el catálogo</label>
              <select id="filtro-publicado" value={publicado} onChange={(e) => setPublicado(e.target.value)}>
                <option value="">Todos</option>
                <option value="1">Publicados</option>
                <option value="0">No publicados</option>
              </select>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={conBajas} onChange={(e) => setConBajas(e.target.checked)} />
              Incluir dados de baja
            </label>
          </div>
          {puedeEscribir && (
            <button className="primario" onClick={() => setCreando(true)}>
              + Nuevo ítem
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <p className="texto-suave" style={{ marginTop: 0 }}>
          {visibles.length} ítems mostrados de {todos.filter((i) => i.activo === 1).length} · {sinPrecio} sin precio o con error
        </p>
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Rubro</th>
                <th>Descripción</th>
                <th>Regla</th>
                <th className="num">Pase parche</th>
                <th className="num">%</th>
                <th className="num">SAE</th>
                <th>Publicado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((i) => (
                <tr key={i.id} className={i.activo === 0 ? 'fila-baja' : ''}>
                  <td>
                    <button className="chip" onClick={() => abrirItem(i.id)} title="Abrir la ficha del ítem">
                      {i.codigo}
                    </button>
                    {i.activo === 0 && <span className="badge baja">baja</span>}
                  </td>
                  {editandoId === i.id ? (
                    <>
                      <td>
                        <input value={editado.rubro} onChange={(e) => setEditado({ ...editado, rubro: e.target.value })} style={{ width: 120 }} />
                      </td>
                      <td>
                        <input value={editado.descripcion} onChange={(e) => setEditado({ ...editado, descripcion: e.target.value })} style={{ width: '100%', minWidth: 200 }} />
                      </td>
                      <td className="texto-suave">{i.regla_texto}</td>
                      <td className="num">{pesos(i.pase_parche)}</td>
                      <td className="num">
                        <input value={editado.porcentaje} placeholder="general" onChange={(e) => setEditado({ ...editado, porcentaje: e.target.value })} style={{ width: 70, textAlign: 'right' }} />
                      </td>
                      <td className="num">{i.sae === null ? 'S / P' : pesos(i.sae)}</td>
                      <td>{i.publicado ? 'Sí' : '—'}</td>
                      <td className="acciones-fila">
                        <button className="primario" onClick={guardarEdicion} disabled={guardando}>
                          Guardar
                        </button>
                        <button onClick={() => setEditandoId(null)}>Cancelar</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="texto-suave">{i.rubro || '—'}</td>
                      <td>{i.descripcion || '—'}</td>
                      <td className="texto-suave">{i.regla_texto}</td>
                      <td className="num">{pesos(i.pase_parche)}</td>
                      <td className="num">{i.porcentaje === null ? <span className="texto-suave">general</span> : porcentaje(i.porcentaje)}</td>
                      <td className="num">
                        {i.sae === null ? <EstadoPrecio item={i} /> : pesos(i.sae)} {i.sae !== null && <EstadoPrecio item={i} />}
                      </td>
                      <td>{i.publicado ? 'Sí' : '—'}</td>
                      <td className="acciones-fila">
                        {puedeEscribir && <button onClick={() => iniciarEdicion(i)}>Editar</button>}
                        <button onClick={() => abrirItem(i.id)}>Ficha</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={9} className="texto-suave">
                    No hay ítems con esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(abrirId || creando) && (
        <ItemCatalogoModal
          key={creando ? 'nuevo' : abrirId}
          itemId={creando ? null : abrirId}
          codigos={codigos}
          puedeEscribir={puedeEscribir}
          onClose={() => {
            setCreando(false);
            abrirItem(null);
            cargar();
          }}
          onCambio={cargar}
          onAbrirOtro={(id) => {
            setCreando(false);
            abrirItem(id);
          }}
        />
      )}
    </div>
  );
}
