import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { DialogoConfirmar } from '../components/DialogoConfirmar';
import { Icono } from '../components/Icono';

const CLAVE_MINIMA = 8; // el servidor pide lo mismo
const NUEVO_VACIO = { nombre_usuario: '', password: '', nombre_completo: '', rol: 'operador', solo_estado: false };

/** El interruptor de "sólo puede cambiar el estado de los presupuestos", con su explicación. */
function CampoSoloEstado({ valor, onChange, explicacion }) {
  return (
    <label className="check check--bloque">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>Solo puede cambiar el estado de los presupuestos</strong>
        {explicacion && (
          <>
            <br />
            <span className="sub">{explicacion}</span>
          </>
        )}
      </span>
    </label>
  );
}

export function UsuariosPage() {
  const { usuario: yo } = useAuth();
  const [usuarios, setUsuarios] = useState(null);
  const [error, setError] = useState('');
  const [dialogo, setDialogo] = useState(null); // { tipo: 'nuevo' | 'editar' | 'clave' | 'desactivar', usuario?, ... }
  const [errorDialogo, setErrorDialogo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [nuevo, setNuevo] = useState(NUEVO_VACIO);
  const [editado, setEditado] = useState({ nombre_completo: '', rol: 'operador', solo_estado: false });
  const [clave, setClave] = useState('');
  const [aviso, mostrarAviso] = useToast();
  const idf = useId();
  const esAdmin = yo?.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await api.get('/usuarios'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (esAdmin) cargar();
  }, [esAdmin, cargar]);

  const cerrar = () => {
    if (!trabajando) setDialogo(null);
  };

  /** Hace lo que pide el diálogo; si el servidor lo rechaza, el mensaje queda adentro del diálogo. */
  async function ejecutar(accion, mensaje) {
    setTrabajando(true);
    setErrorDialogo('');
    try {
      await accion();
      setDialogo(null);
      mostrarAviso(mensaje);
      cargar();
    } catch (err) {
      setErrorDialogo(err.message);
    } finally {
      setTrabajando(false);
    }
  }

  function abrirNuevo() {
    setNuevo(NUEVO_VACIO);
    setErrorDialogo('');
    setDialogo({ tipo: 'nuevo' });
  }

  function abrirEditar(u) {
    setEditado({ nombre_completo: u.nombre_completo || '', rol: u.rol, solo_estado: Boolean(u.solo_estado) });
    setErrorDialogo('');
    setDialogo({ tipo: 'editar', usuario: u });
  }

  function abrirClave(u) {
    setClave('');
    setErrorDialogo('');
    setDialogo({ tipo: 'clave', usuario: u });
  }

  function crear() {
    if (!nuevo.nombre_usuario.trim()) return setErrorDialogo('Falta el nombre de usuario.');
    if (nuevo.password.length < CLAVE_MINIMA) return setErrorDialogo(`La contraseña tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
    return ejecutar(() => api.post('/usuarios', { ...nuevo, nombre_usuario: nuevo.nombre_usuario.trim() }), 'Usuario creado');
  }

  function guardarClave() {
    if (clave.length < CLAVE_MINIMA) return setErrorDialogo(`Tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
    return ejecutar(() => api.post(`/usuarios/${dialogo.usuario.id}/password`, { password: clave }), 'Contraseña cambiada');
  }

  const campoNuevo = (clave_) => ({ value: nuevo[clave_], onChange: (e) => setNuevo({ ...nuevo, [clave_]: e.target.value }) });
  const u = dialogo?.usuario;

  if (!esAdmin) {
    return (
      <div className="ed">
        <header className="pagina-cab">
          <div>
            <h1>Usuarios</h1>
          </div>
        </header>
        <div className="aviso aviso--error" role="alert">
          <Icono nombre="lock" />
          <div className="aviso-cuerpo">
            <strong>Esta sección es sólo para administradores.</strong> Tu usuario no tiene permiso para verla.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ed">
      <header className="pagina-cab">
        <div>
          <h1>Usuarios</h1>
          <p className="sub">Quién puede entrar y qué puede hacer. Desactivar a alguien corta su acceso al instante.</p>
        </div>
        <button type="button" className="boton boton--primario" onClick={abrirNuevo}>
          <Icono nombre="plus" />
          Nuevo usuario
        </button>
      </header>

      {error && (
        <div className="aviso aviso--error" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <Icono nombre="warn" />
          <div className="aviso-cuerpo">{error}</div>
        </div>
      )}

      <section className="tarjeta" aria-label="Lista de usuarios">
        {!usuarios ? (
          <div className="tarjeta-cuerpo pila" aria-busy="true" aria-label="Cargando">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="esqueleto" />
            ))}
          </div>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre completo</th>
                  <th>Rol</th>
                  <th>Permisos</th>
                  <th>Estado</th>
                  <th>
                    <span className="solo-lectores">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((x) => {
                  const soyYo = x.id === yo?.id;
                  return (
                    <tr key={x.id}>
                      <td className="codigo">
                        {x.nombre_usuario}{' '}
                        {soyYo && (
                          <span className="etiqueta etiqueta--ciruela" style={{ fontWeight: 600 }}>
                            Vos
                          </span>
                        )}
                      </td>
                      <td>{x.nombre_completo || '—'}</td>
                      <td>
                        <span className={`etiqueta${x.rol === 'admin' ? ' etiqueta--info' : ''}`}>{x.rol === 'admin' ? 'Administrador' : 'Operador'}</span>
                      </td>
                      <td>{x.solo_estado ? <span className="etiqueta etiqueta--ciruela">Solo cambia estado</span> : <span style={{ color: 'var(--c-texto-3)' }}>Completos</span>}</td>
                      <td>{x.activo ? <span className="cobro cobro--cobrado">Activo</span> : <span className="cobro">Inactivo</span>}</td>
                      <td className="acciones">
                        <button type="button" className="boton boton--sm" onClick={() => abrirEditar(x)}>
                          <Icono nombre="pencil" className="icono--sm" />
                          Editar
                        </button>{' '}
                        <button type="button" className="boton boton--sm" onClick={() => abrirClave(x)}>
                          <Icono nombre="key" className="icono--sm" />
                          Contraseña
                        </button>{' '}
                        {x.activo ? (
                          <button
                            type="button"
                            className="boton boton--sm boton--peligro-suave"
                            disabled={soyYo}
                            title={soyYo ? 'No podés desactivarte a vos mismo' : undefined}
                            onClick={() => {
                              setErrorDialogo('');
                              setDialogo({ tipo: 'desactivar', usuario: x });
                            }}
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="boton boton--sm"
                            onClick={async () => {
                              try {
                                await api.put(`/usuarios/${x.id}`, { activo: true });
                                mostrarAviso('Usuario activado');
                                cargar();
                              } catch (err) {
                                setError(err.message);
                              }
                            }}
                          >
                            Activar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialogo?.tipo === 'nuevo' && (
        <DialogoConfirmar titulo="Nuevo usuario" textoConfirmar="Crear usuario" ancho={620} foco="primero" formulario confirmarDeshabilitado={trabajando} onConfirmar={crear} onCancelar={cerrar}>
          <div className="pila">
            {errorDialogo && (
              <div className="aviso aviso--error" role="alert">
                <Icono nombre="warn" />
                <div className="aviso-cuerpo">{errorDialogo}</div>
              </div>
            )}
            <div className="grid grid-2">
              <div className="campo">
                <label htmlFor={`${idf}-nu-usuario`}>
                  Usuario <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
                </label>
                <input id={`${idf}-nu-usuario`} autoComplete="off" {...campoNuevo('nombre_usuario')} />
              </div>
              <div className={`campo${errorDialogo.includes('contraseña') ? ' campo--error' : ''}`}>
                <label htmlFor={`${idf}-nu-clave`}>
                  Contraseña <span style={{ color: 'var(--c-peligro-fg)', fontWeight: 700 }} aria-hidden="true">*</span>
                </label>
                <input id={`${idf}-nu-clave`} type="password" autoComplete="new-password" {...campoNuevo('password')} />
                <span className="ayuda">Al menos {CLAVE_MINIMA} caracteres.</span>
              </div>
              <div className="campo">
                <label htmlFor={`${idf}-nu-nombre`}>Nombre completo</label>
                <input id={`${idf}-nu-nombre`} {...campoNuevo('nombre_completo')} />
              </div>
              <div className="campo">
                <label htmlFor={`${idf}-nu-rol`}>Rol</label>
                <select id={`${idf}-nu-rol`} {...campoNuevo('rol')}>
                  <option value="operador">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            <CampoSoloEstado valor={nuevo.solo_estado} onChange={(v) => setNuevo({ ...nuevo, solo_estado: v })} explicacion="No ve Clientes, Productos ni Catálogo y no puede cargar ni editar nada más." />
          </div>
        </DialogoConfirmar>
      )}

      {dialogo?.tipo === 'editar' && (
        <DialogoConfirmar
          titulo="Editar usuario"
          subtitulo={u.nombre_usuario}
          textoConfirmar="Guardar"
          ancho={560}
          foco="primero"
          formulario
          confirmarDeshabilitado={trabajando}
          onConfirmar={() => ejecutar(() => api.put(`/usuarios/${u.id}`, editado), 'Usuario guardado')}
          onCancelar={cerrar}
        >
          <div className="pila">
            {errorDialogo && (
              <div className="aviso aviso--error" role="alert">
                <Icono nombre="warn" />
                <div className="aviso-cuerpo">{errorDialogo}</div>
              </div>
            )}
            <div className="grid grid-2">
              <div className="campo">
                <label htmlFor={`${idf}-eu-nombre`}>Nombre completo</label>
                <input id={`${idf}-eu-nombre`} value={editado.nombre_completo} onChange={(e) => setEditado({ ...editado, nombre_completo: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor={`${idf}-eu-rol`}>Rol</label>
                <select id={`${idf}-eu-rol`} value={editado.rol} onChange={(e) => setEditado({ ...editado, rol: e.target.value })}>
                  <option value="operador">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            <CampoSoloEstado valor={editado.solo_estado} onChange={(v) => setEditado({ ...editado, solo_estado: v })} />
          </div>
        </DialogoConfirmar>
      )}

      {dialogo?.tipo === 'clave' && (
        <DialogoConfirmar
          titulo="Cambiar contraseña"
          subtitulo={`${u.nombre_usuario}${u.nombre_completo ? ` · ${u.nombre_completo}` : ''}`}
          textoConfirmar="Guardar contraseña"
          ancho={460}
          foco="primero"
          formulario
          confirmarDeshabilitado={trabajando}
          onConfirmar={guardarClave}
          onCancelar={cerrar}
        >
          <div className={`campo${errorDialogo ? ' campo--error' : ''}`}>
            <label htmlFor={`${idf}-cp-clave`}>Nueva contraseña</label>
            <input id={`${idf}-cp-clave`} type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />
            {errorDialogo && (
              <span className="mensaje mensaje--error" role="alert">
                <Icono nombre="warn" />
                {errorDialogo}
              </span>
            )}
            <span className="ayuda">Al menos {CLAVE_MINIMA} caracteres.</span>
          </div>
        </DialogoConfirmar>
      )}

      {dialogo?.tipo === 'desactivar' && (
        <DialogoConfirmar
          titulo={`¿Desactivar a ${u.nombre_completo || u.nombre_usuario}?`}
          textoConfirmar="Desactivar"
          peligro
          ancho={480}
          confirmarDeshabilitado={trabajando}
          onConfirmar={() => ejecutar(() => api.put(`/usuarios/${u.id}`, { activo: false }), 'Usuario desactivado')}
          onCancelar={cerrar}
        >
          <p>
            Se corta su acceso <strong>al instante</strong>. Sus presupuestos y datos se conservan, y se puede volver a activar cuando haga falta.
          </p>
          {errorDialogo && (
            <p className="mensaje mensaje--error" style={{ marginTop: 'var(--s-3)' }} role="alert">
              <Icono nombre="warn" />
              <span>{errorDialogo}</span>
            </p>
          )}
        </DialogoConfirmar>
      )}

      {aviso}
    </div>
  );
}
