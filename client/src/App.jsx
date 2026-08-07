import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { CalendarioPage } from './pages/CalendarioPage';
import { EventoDetallePage } from './pages/EventoDetallePage';
import { PresupuestosPage } from './pages/PresupuestosPage';
import { TotalesPage } from './pages/TotalesPage';
import { AlertasPage } from './pages/AlertasPage';
import { ProductosPage } from './pages/ProductosPage';
import { ImportacionesPage } from './pages/ImportacionesPage';
import { UsuariosPage } from './pages/UsuariosPage';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/inicio" replace />} />
        <Route path="inicio" element={<HomePage />} />
        <Route path="calendario" element={<CalendarioPage />} />
        <Route path="eventos/:id" element={<EventoDetallePage />} />
        <Route path="presupuestos" element={<PresupuestosPage />} />
        <Route path="totales" element={<TotalesPage />} />
        <Route path="alertas" element={<AlertasPage />} />
        <Route path="productos" element={<ProductosPage />} />
        <Route path="importaciones" element={<ImportacionesPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
      </Route>
    </Routes>
  );
}

export default App;
