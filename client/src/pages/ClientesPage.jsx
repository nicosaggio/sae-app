import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { fechaCorta } from '../catalogoFormat';
import { DialogoConfirmar } from '../components/DialogoConfirmar';
import { Icono } from '../components/Icono';

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
  const [editando, setEditando] = useState(null); // el cliente abierto en la ventana
  const [borrando, setBorrando] = useState(null); // el cliente que se está por borrar (espera la confirmación)
  const [form, setForm] = useState({});
  const [errorEdicion, setErrorEdicion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, mostrarAviso] = useToast();
  const idf = useId();

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

  async function guardar() {
    setGuardando(true);
    setErrorEdicion('');
    try {
      await api.put(`/clientes/${editando.id}`, form);
      setEditando(null);
      mostrarAviso('Cliente guardado');
      cargar();
    } catch (err) {
      setErrorEdicion(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    const cliente = borrando;
    setBorrando(null);
    try {
      await api.del(`/clientes/${cliente.id}`);
      mostrarAviso('Cliente borrado');
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  const buscando = busqueda.trim() !== '';

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Clientes</h1>
          <p className="sub">Los clientes se guardan solos, con el CUIT como clave, cuando guardás los datos de un presupuesto. La próxima vez que escribas su CUIT o su razón social, se completan sus datos.</p>
        </div>
      </header>

      {error && (
        <div className="aviso aviso--error" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <Icono nombre="warn" />
          <div className="aviso-cuerpo">{error}</div>
        </div>
      )}

      <section className="tarjeta" aria-label="Lista de clientes">
        <div className="tarjeta-cuerpo fila fila--entre" style={{ borderBottom: '1px solid var(--c-borde)' }}>
          <div className="campo" style={{ width: 'min(420px, 100%)' }}>
            <label htmlFor={`${idf}-buscar`} className="solo-lectores">
              Buscar
            </label>
            <div className="entrada-icono">
              <Icono nombre="search" />
              <input id={`${idf}-buscar`} type="search" placeholder="Buscar por razón social, contacto o CUIT…" autoComplete="off" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
          <span className="sub" aria-live="polite">
            {lista ? (lista.length === 1 ? '1 cliente' : `${lista.length} clientes`) : ''}
          </span>
        </div>

        {!lista ? (
          <div className="tarjeta-cuerpo pila" aria-busy="true" aria-label="Cargando">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="esqueleto" />
            ))}
          </div>
        ) : lista.length === 0 ? (
          <div className="vacio">
            <span className="icono-vacio">
              <Icono nombre="users" className="icono--lg" />
            </span>
            <h3>{buscando ? 'No hay clientes con esa búsqueda' : 'Todavía no hay clientes guardados'}</h3>
            <p>{buscando ? 'Probá con otra razón social, contacto o CUIT.' : 'Se van a ir sumando al cargar presupuestos con CUIT.'}</p>
          </div>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla tabla--clic">
              <thead>
                <tr>
                  <th>CUIT</th>
                  <th>Razón social</th>
                  <th>Contacto</th>
                  <th>Mail</th>
                  <th>Teléfono</th>
                  <th className="num">Presupuestos</th>
                  <th>Último</th>
                  <th>
                    <span className="solo-lectores">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => abrir(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        abrir(c);
                      }
                    }}
                  >
                    <td className="codigo">{c.cuit}</td>
                    <td className="cel-ell" style={{ maxWidth: 220 }} title={c.razon_social || ''}>
                      <strong style={{ fontWeight: 600 }}>{c.razon_social || '—'}</strong>
                    </td>
                    <td>{c.contacto || '—'}</td>
                    <td className="cel-ell" style={{ maxWidth: 220 }} title={c.mail || ''}>
                      {c.mail || '—'}
                    </td>
                    <td className="nw">{c.telefono || '—'}</td>
                    <td className="num">{c.presupuestos}</td>
                    <td className="nw" style={{ color: 'var(--c-texto-2)' }}>
                      {c.ultimo_presupuesto ? fechaCorta(c.ultimo_presupuesto) : '—'}
                    </td>
                    <td className="acciones">
                      <button
                        type="button"
                        className="boton boton--sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          abrir(c);
                        }}
                      >
                        {puedeEscribir ? 'Editar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando && (
        <DialogoConfirmar
          titulo={puedeEscribir ? 'Editar cliente' : 'Cliente'}
          subtitulo={`${editando.presupuestos} ${editando.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}${editando.ultimo_presupuesto ? ` · último ${fechaCorta(editando.ultimo_presupuesto)}` : ''}`}
          textoConfirmar={guardando ? 'Guardando…' : 'Guardar'}
          ancho={640}
          foco="primero"
          formulario
          soloCerrar={!puedeEscribir}
          confirmarDeshabilitado={guardando}
          pieIzquierda={
            puedeEscribir ? (
              <button
                type="button"
                className="boton boton--peligro-suave"
                onClick={() => {
                  setBorrando(editando);
                  setEditando(null);
                }}
              >
                <Icono nombre="trash" />
                Borrar cliente
              </button>
            ) : null
          }
          onConfirmar={guardar}
          onCancelar={() => !guardando && setEditando(null)}
        >
          <div className="pila">
            {errorEdicion && (
              <div className="aviso aviso--error" role="alert">
                <Icono nombre="warn" />
                <div className="aviso-cuerpo">{errorEdicion}</div>
              </div>
            )}
            <div className="grid grid-2">
              {CAMPOS.map(([campo, etiqueta]) => (
                <div className={`campo${campo === 'direccion' ? ' span-2' : ''}${campo === 'cuit' && /cuit/i.test(errorEdicion) ? ' campo--error' : ''}`} key={campo}>
                  <label htmlFor={`${idf}-c-${campo}`}>{etiqueta}</label>
                  <input id={`${idf}-c-${campo}`} type={campo === 'mail' ? 'email' : undefined} value={form[campo]} disabled={!puedeEscribir} onChange={(e) => setForm({ ...form, [campo]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        </DialogoConfirmar>
      )}

      {borrando && (
        <DialogoConfirmar titulo="¿Borrar el cliente?" subtitulo={borrando.razon_social || borrando.cuit} textoConfirmar="Sí, borrar" textoCancelar="No, volver" peligro ancho={500} onConfirmar={borrar} onCancelar={() => setBorrando(null)}>
          <p>
            Los presupuestos que ya tiene <strong>conservan sus datos</strong>. Si después se guarda otro presupuesto con este CUIT, el cliente se vuelve a crear.
          </p>
        </DialogoConfirmar>
      )}

      {aviso}
    </div>
  );
}
