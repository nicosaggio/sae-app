import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { usuario, login } = useAuth();
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to="/calendario" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(nombreUsuario, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="logo-box">
          <img src="/anselmi-logo.jpg" alt="Anselmi Industria Publicitaria" />
        </div>
        <h2>Iniciar sesión</h2>
        {error && <div className="aviso error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="campo" style={{ marginBottom: 12 }}>
            <label>Usuario</label>
            <input
              autoFocus
              value={nombreUsuario}
              onChange={(e) => setNombreUsuario(e.target.value)}
            />
          </div>
          <div className="campo" style={{ marginBottom: 16 }}>
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="primario" disabled={enviando} style={{ width: '100%' }}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
