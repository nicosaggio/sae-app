import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api
      .get('/auth/me')
      .then(setUsuario)
      .catch(() => setUsuario(null))
      .finally(() => setCargando(false));
  }, []);

  async function login(nombre_usuario, password) {
    const usuarioLogueado = await api.post('/auth/login', { nombre_usuario, password });
    setUsuario(usuarioLogueado);
  }

  async function logout() {
    await api.post('/auth/logout');
    setUsuario(null);
  }

  const puedeEscribir = !usuario?.solo_estado;

  return (
    <AuthContext.Provider value={{ usuario, cargando, login, logout, puedeEscribir }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
