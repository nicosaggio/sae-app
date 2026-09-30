import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function UsuariosPage() {
  const { usuario: yo } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [nuevo, setNuevo] = useState({ nombre_usuario: '', password: '', nombre_completo: '', rol: 'operador', solo_estado: false });
  const [editandoId, setEditandoId] = useState(null);
  const [editado, setEditado] = useState({ nombre_completo: '', rol: 'operador', solo_estado: false });
  const [passwordPorUsuario, setPasswordPorUsuario] = useState({});

  async function cargar() {
    setError('');
    try {
      setUsuarios(await api.get('/usuarios'));
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
    if (!nuevo.nombre_usuario || !nuevo.password) return;
    try {
      await api.post('/usuarios', nuevo);
      setNuevo({ nombre_usuario: '', password: '', nombre_completo: '', rol: 'operador', solo_estado: false });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  function iniciarEdicion(u) {
    setEditandoId(u.id);
    setEditado({ nombre_completo: u.nombre_completo || '', rol: u.rol, solo_estado: !!u.solo_estado });
  }

  async function guardarEdicion() {
    setError('');
    try {
      await api.put(`/usuarios/${editandoId}`, editado);
      setEditandoId(null);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function alternarActivo(u) {
    setError('');
    try {
      await api.put(`/usuarios/${u.id}`, { activo: !u.activo });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cambiarPassword(u) {
    setError('');
    const password = passwordPorUsuario[u.id];
    if (!password) return;
    try {
      await api.post(`/usuarios/${u.id}/password`, { password });
      setPasswordPorUsuario({ ...passwordPorUsuario, [u.id]: '' });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Usuarios</h2>
      {error && <div className="aviso error">{error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nuevo usuario</h3>
        <form onSubmit={crear} className="form-grid">
          <div className="campo">
            <label>Usuario</label>
            <input
              required
              value={nuevo.nombre_usuario}
              onChange={(e) => setNuevo({ ...nuevo, nombre_usuario: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Contraseña</label>
            <input
              type="password"
              required
              value={nuevo.password}
              onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Nombre completo</label>
            <input
              value={nuevo.nombre_completo}
              onChange={(e) => setNuevo({ ...nuevo, nombre_completo: e.target.value })}
            />
          </div>
          <div className="campo">
            <label>Rol</label>
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
              <option value="operador">Operador</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="campo">
            <label>Permisos</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={nuevo.solo_estado}
                onChange={(e) => setNuevo({ ...nuevo, solo_estado: e.target.checked })}
              />
              Solo puede cambiar estado de presupuestos
            </label>
          </div>
        </form>
        <button type="button" className="primario" onClick={crear} style={{ marginTop: 8 }}>
          + Crear usuario
        </button>
      </div>

      <div className="card">
        {cargando ? (
          <p className="texto-suave">Cargando…</p>
        ) : (
          <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre completo</th>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Activo</th>
                <th>Cambiar contraseña</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  {editandoId === u.id ? (
                    <>
                      <td>{u.nombre_usuario}</td>
                      <td>
                        <input
                          value={editado.nombre_completo}
                          onChange={(e) => setEditado({ ...editado, nombre_completo: e.target.value })}
                        />
                      </td>
                      <td>
                        <select value={editado.rol} onChange={(e) => setEditado({ ...editado, rol: e.target.value })}>
                          <option value="operador">Operador</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={editado.solo_estado}
                            onChange={(e) => setEditado({ ...editado, solo_estado: e.target.checked })}
                          />
                          Solo estado
                        </label>
                      </td>
                      <td>{u.activo ? 'Sí' : 'No'}</td>
                      <td>—</td>
                      <td className="acciones-fila">
                        <button className="primario" onClick={guardarEdicion}>
                          Guardar
                        </button>
                        <button onClick={() => setEditandoId(null)}>Cancelar</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{u.nombre_usuario}</td>
                      <td>{u.nombre_completo || '—'}</td>
                      <td>{u.rol}</td>
                      <td>{u.solo_estado ? <span className="texto-suave">Solo cambiar estado</span> : '—'}</td>
                      <td>{u.activo ? 'Sí' : 'No'}</td>
                      <td className="toolbar" style={{ marginBottom: 0 }}>
                        <input
                          type="password"
                          placeholder="Nueva contraseña"
                          style={{ width: 140 }}
                          value={passwordPorUsuario[u.id] || ''}
                          onChange={(e) => setPasswordPorUsuario({ ...passwordPorUsuario, [u.id]: e.target.value })}
                        />
                        <button onClick={() => cambiarPassword(u)} disabled={!passwordPorUsuario[u.id]}>
                          Guardar
                        </button>
                      </td>
                      <td className="acciones-fila">
                        <button onClick={() => iniciarEdicion(u)}>Editar</button>
                        <button
                          className={u.activo ? 'peligro' : ''}
                          onClick={() => alternarActivo(u)}
                          disabled={u.id === yo?.id && u.activo}
                        >
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
