import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function ProductosPage() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [nuevo, setNuevo] = useState({ codigo: '', nombre: '', rubro: '' });
  const [editandoId, setEditandoId] = useState(null);
  const [editado, setEditado] = useState({ codigo: '', nombre: '', rubro: '' });

  async function cargar() {
    setError('');
    try {
      setProductos(await api.get('/productos'));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    if (!nuevo.codigo || !nuevo.nombre) return;
    try {
      await api.post('/productos', nuevo);
      setNuevo({ codigo: '', nombre: '', rubro: '' });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  function iniciarEdicion(producto) {
    setEditandoId(producto.id);
    setEditado({ codigo: producto.codigo, nombre: producto.nombre, rubro: producto.rubro || '', activo: producto.activo });
  }

  async function guardarEdicion() {
    setError('');
    try {
      await api.put(`/productos/${editandoId}`, editado);
      setEditandoId(null);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function alternarActivo(producto) {
    setError('');
    try {
      await api.put(`/productos/${producto.id}`, { ...producto, activo: !producto.activo });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function borrar(producto) {
    if (!confirm(`¿Borrar el producto "${producto.nombre}"?`)) return;
    try {
      await api.del(`/productos/${producto.id}`);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Catálogo de productos</h2>
      {error && <div className="aviso error">{error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nuevo producto</h3>
        <form onSubmit={crear} className="toolbar">
          <input
            placeholder="Código"
            required
            value={nuevo.codigo}
            onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
          />
          <input
            placeholder="Nombre"
            required
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
          />
          <input
            placeholder="Rubro"
            value={nuevo.rubro}
            onChange={(e) => setNuevo({ ...nuevo, rubro: e.target.value })}
          />
          <button type="submit" className="primario">
            + Agregar producto
          </button>
        </form>
      </div>

      <div className="card">
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Rubro</th>
                <th>Activo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id}>
                  {editandoId === p.id ? (
                    <>
                      <td>
                        <input value={editado.codigo} onChange={(e) => setEditado({ ...editado, codigo: e.target.value })} />
                      </td>
                      <td>
                        <input value={editado.nombre} onChange={(e) => setEditado({ ...editado, nombre: e.target.value })} />
                      </td>
                      <td>
                        <input value={editado.rubro} onChange={(e) => setEditado({ ...editado, rubro: e.target.value })} />
                      </td>
                      <td>{p.activo ? 'Sí' : 'No'}</td>
                      <td className="acciones-fila">
                        <button className="primario" onClick={guardarEdicion}>
                          Guardar
                        </button>
                        <button onClick={() => setEditandoId(null)}>Cancelar</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{p.codigo}</td>
                      <td>{p.nombre}</td>
                      <td className="texto-suave">{p.rubro || '—'}</td>
                      <td>{p.activo ? 'Sí' : 'No'}</td>
                      <td className="acciones-fila">
                        <button onClick={() => iniciarEdicion(p)}>Editar</button>
                        <button onClick={() => alternarActivo(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                        <button className="peligro" onClick={() => borrar(p)}>
                          Borrar
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
