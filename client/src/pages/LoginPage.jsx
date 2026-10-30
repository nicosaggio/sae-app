import { useId, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icono } from '../components/Icono';

export function LoginPage() {
  const { usuario, login } = useAuth();
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null); // { texto, bloqueado, credenciales }
  const [enviando, setEnviando] = useState(false);
  const idf = useId();

  if (usuario) return <Navigate to="/calendario" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(nombreUsuario, password);
    } catch (err) {
      // 429: el servidor frenó la PC por demasiados intentos; 401: usuario o contraseña que no coinciden
      setError({ texto: err.message, bloqueado: err.status === 429, credenciales: err.status === 401 });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="ed login-fondo">
      <main className="tarjeta login-tarjeta">
        <div className="tarjeta-cuerpo pila" style={{ gap: 'var(--s-5)' }}>
          <div className="login-logo">
            <img src="/anselmi-logo.jpg" alt="Anselmi Industria Publicitaria" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 'var(--t-lg)' }}>Iniciar sesión</h1>
            <p className="sub" style={{ marginTop: 4, fontSize: 'var(--t-base)' }}>
              Presupuestos y eventos
            </p>
          </div>
          {error && (
            <div className="aviso aviso--error" role="alert">
              <Icono nombre="warn" />
              <div className="aviso-cuerpo">
                {error.bloqueado ? <strong>Demasiados intentos fallidos. </strong> : error.credenciales ? <strong>No pudimos ingresarte. </strong> : null}
                {error.bloqueado ? error.texto.replace(/^Demasiados intentos fallidos\.\s*/, '') : error.credenciales ? 'Revisá el usuario y la contraseña.' : error.texto}
              </div>
            </div>
          )}
          <form className="pila" onSubmit={onSubmit} data-enter-envia>
            <div className="campo">
              <label htmlFor={`${idf}-usuario`}>Usuario</label>
              <input id={`${idf}-usuario`} name="usuario" autoComplete="username" autoFocus value={nombreUsuario} onChange={(e) => setNombreUsuario(e.target.value)} />
            </div>
            <div className={`campo${error?.credenciales ? ' campo--error' : ''}`}>
              <label htmlFor={`${idf}-clave`}>Contraseña</label>
              <input id={`${idf}-clave`} name="clave" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="boton boton--primario boton--bloque" disabled={enviando}>
              {enviando ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
          <p className="ayuda" style={{ textAlign: 'center' }}>
            ¿No podés entrar? Pedile a un administrador que revise tu usuario.
          </p>
        </div>
      </main>
    </div>
  );
}
