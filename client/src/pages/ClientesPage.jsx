import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { fechaCorta } from '../catalogoFormat';
import { Modal } from '../components/Modal';

const CAMPOS = [
  ['cuit', 'CUIT'],
  ['razon_social', 'Razón social'],
  ['direccion', 'Dirección'],
  ['contacto', 'Contacto'],
  ['mail', 'Mail'],
  ['telefono', 'Teléfono'],
];

export function ClientesPage() {
  const { puedeEscribir } = useAuth();
  const [busqueda, setBusqueda] = useState('');
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({});
  const [errorEdicion, setErrorEdicion] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    api
      .get(`/clientes?q=${encodeURIComponent(busqueda.trim())}`)
      .then((datos) => {
        setLista(datos);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [busqueda]);

  useEffect(() => {
    const espera = setTimeout(cargar, 250);
    return () => clearTimeout(espera);
  }, [cargar]);

  function abrir(cliente) {
    setEditando(cliente);
    setForm(Object.fromEntries(CAMPOS.map(([k]) => [k, cliente[k] || ''])));
    setErrorEdicion('');
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setErrorEdicion('');
    try {
      await api.put(`/clientes/${editando.id}`, form);
      setEditando(null);
      setAviso('Cliente guardado.');
      cargar();
    } catch (err) {
      setErrorEdicion(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(cliente) {
    const nombre = cliente.razon_social || cliente.cuit;
    if (!confirm(`¿Borrar el cliente "${nombre}"?\n\nLos presupuestos que ya tiene conservan sus datos. Si después se guarda otro presupuesto con este CUIT, el cliente se vuelve a crear.`)) return;
    try {
      await api.del(`/clientes/${cliente.id}`);
      setAviso('Cliente borrado.');
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Clientes</h2>
      <p className="texto-suave" style={{ marginTop: -8 }}>
        Los clientes se guardan solos, con el CUIT como clave, cuando guardás los datos de un presupuesto. La próxima vez que escribas su CUIT o su razón social, se completan sus datos.
      </p>

      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      <div className="card">
        <div className="toolbar">
          <div className="campo" style={{ minWidth: 280 }}>
            <label>Buscar</label>
            <input placeholder="Razón social, contacto o CUIT…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>

        {!lista ? (
          <p className="texto-suave">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="texto-suave">{busqueda.trim() ? 'No hay clientes con esa búsqueda.' : 'Todavía no hay clientes guardados. Se van a ir sumando al cargar presupuestos con CUIT.'}</p>
        ) : (
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>CUIT</th>
                  <th>Razón social</th>
                  <th>Contacto</th>
                  <th>Mail</th>
                  <th>Teléfono</th>
                  <th className="num">Presupuestos</th>
                  <th>Último</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{c.cuit}</strong>
                    </td>
                    <td>{c.razon_social || '—'}</td>
                    <td>{c.contacto || '—'}</td>
                    <td>{c.mail || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.telefono || '—'}</td>
                    <td className="num">{c.presupuestos}</td>
                    <td className="texto-suave">{c.ultimo_presupuesto ? fechaCorta(c.ultimo_presupuesto) : '—'}</td>
                    <td className="acciones-fila">
                      {puedeEscribir ? (
                        <>
                          <button onClick={() => abrir(c)}>Editar</button>
                          <button className="peligro" onClick={() => borrar(c)}>
                            Borrar
                          </button>
                        </>
                      ) : (
                        <button onClick={() => abrir(c)}>Ver</button>
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
          <h3 style={{ marginTop: 0 }}>{puedeEscribir ? 'Editar cliente' : 'Cliente'}</h3>
          {errorEdicion && <div className="aviso error">{errorEdicion}</div>}
          <form onSubmit={guardar}>
            <div className="form-grid">
              {CAMPOS.map(([campo, etiqueta]) => (
                <div className="campo" key={campo}>
                  <label>{etiqueta}</label>
                  <input value={form[campo]} disabled={!puedeEscribir} onChange={(e) => setForm({ ...form, [campo]: e.target.value })} />
                </div>
              ))}
            </div>
            {puedeEscribir && (
              <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
                <button type="submit" className="primario" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setEditando(null)}>
                  Cancelar
                </button>
              </div>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
