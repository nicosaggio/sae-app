import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { CalendarioPage } from './pages/CalendarioPage';
import { EventoDetallePage } from './pages/EventoDetallePage';
import { CroquisLotePage } from './pages/CroquisLotePage';
import { PresupuestosPage } from './pages/PresupuestosPage';
import { CotizacionEditorPage } from './pages/CotizacionEditorPage';
import { ClientesPage } from './pages/ClientesPage';
import { TotalesPage } from './pages/TotalesPage';
import { AlertasPage } from './pages/AlertasPage';
import { ProductosPage } from './pages/ProductosPage';
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
        {/* Cada ruta con su propia instancia (key): son dos usos de la misma pantalla y no tienen que compartir estado. */}
        <Route path="eventos/:eventoId/lotes/:loteId/croquis" element={<CroquisLotePage key="lote" />} />
        <Route path="presupuestos" element={<PresupuestosPage />} />
        <Route path="presupuestos/nuevo" element={<CotizacionEditorPage />} />
        <Route path="presupuestos/carga/:id" element={<CotizacionEditorPage />} />
        <Route path="presupuestos/carga/:id/croquis" element={<CroquisLotePage key="presupuesto" />} />
        <Route path="clientes" element={<ClientesPage />} />
        <Route path="totales" element={<TotalesPage />} />
        <Route path="alertas" element={<AlertasPage />} />
        <Route path="productos" element={<ProductosPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
        <Route path="catalogo" element={<CatalogoLayout />}>
          <Route index element={<CatalogoPage />} />
          <Route path="items" element={<CatalogoItemsPage />} />
          <Route path="versiones" element={<CatalogoVersionesPage />} />
          <Route path="televisores" element={<CatalogoTelevisoresPage />} />
          <Route path="importar" element={<CatalogoImportarPage />} />
          <Route path="ajustes" element={<CatalogoAjustesPage />} />
        </Route>
        {/* Una dirección que ya no existe (por ejemplo un favorito viejo de /importaciones) lleva al inicio. */}
        <Route path="*" element={<Navigate to="/inicio" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
