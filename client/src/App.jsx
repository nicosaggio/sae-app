import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { CalendarioPage } from './pages/CalendarioPage';
import { EventoDetallePage } from './pages/EventoDetallePage';
import { PresupuestosPage } from './pages/PresupuestosPage';
import { CotizacionEditorPage } from './pages/CotizacionEditorPage';
import { ClientesPage } from './pages/ClientesPage';
import { TotalesPage } from './pages/TotalesPage';
import { AlertasPage } from './pages/AlertasPage';
import { ProductosPage } from './pages/ProductosPage';
import { ImportacionesPage } from './pages/ImportacionesPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { CatalogoLayout } from './components/CatalogoLayout';
import { CatalogoPage } from './pages/CatalogoPage';
import { CatalogoItemsPage } from './pages/CatalogoItemsPage';
import { CatalogoVersionesPage } from './pages/CatalogoVersionesPage';
import { CatalogoTelevisoresPage } from './pages/CatalogoTelevisoresPage';
import { CatalogoImportarPage } from './pages/CatalogoImportarPage';
import { CatalogoAjustesPage } from './pages/CatalogoAjustesPage';

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
        <Route path="presupuestos/nuevo" element={<CotizacionEditorPage />} />
        <Route path="presupuestos/carga/:id" element={<CotizacionEditorPage />} />
        <Route path="clientes" element={<ClientesPage />} />
        <Route path="totales" element={<TotalesPage />} />
        <Route path="alertas" element={<AlertasPage />} />
        <Route path="productos" element={<ProductosPage />} />
        <Route path="importaciones" element={<ImportacionesPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
        <Route path="catalogo" element={<CatalogoLayout />}>
          <Route index element={<CatalogoPage />} />
          <Route path="items" element={<CatalogoItemsPage />} />
          <Route path="versiones" element={<CatalogoVersionesPage />} />
          <Route path="televisores" element={<CatalogoTelevisoresPage />} />
          <Route path="importar" element={<CatalogoImportarPage />} />
          <Route path="ajustes" element={<CatalogoAjustesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
