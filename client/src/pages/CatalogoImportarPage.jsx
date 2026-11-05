import { useEffect, useState } from 'react';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { ReporteCatalogo } from '../components/ReporteCatalogo';

function fechaHora(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—';
}

export function CatalogoImportarPage() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const [archivo, setArchivo] = useState(null);
  const [aumento, setAumento] = useState('');
  const [claveInput, setClaveInput] = useState(0);
  const [vista, setVista] = useState(null);
  const [aplicado, setAplicado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');

  async function cargarHistorial() {
    try {
      setHistorial(await catalogoApi.get('/importaciones'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function revisar(e) {
    e.preventDefault();
    if (!archivo) return;
    setError('');
    setAplicado(null);
    setTrabajando('Leyendo y calculando…');
    try {
      const datos = new FormData();
      datos.append('archivo', archivo);
      setVista(await catalogoApi.post('/importar', datos));
    } catch (err) {
      setVista(null);
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  }

  async function revisarAumento(e) {
    e.preventDefault();
    const porcentaje = Number(String(aumento).replace(',', '.'));
    if (!(porcentaje > 0)) return;
    setError('');
    setAplicado(null);
    setTrabajando('Calculando…');
    try {
      setVista(await catalogoApi.post('/importar/aumento', { porcentaje: porcentaje / 100 }));
    } catch (err) {
      setVista(null);
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  }

  function descartar() {
    setVista(null);
    setArchivo(null);
    setAumento('');
    setClaveInput((n) => n + 1);
  }

  async function confirmar() {
    const grandes = vista.resumen.variacionesGrandes;
    const desaparecidos = vista.resumen.codigosDesaparecidos;
    const advertencias = [
      grandes > 0 ? `${grandes} ítems varían más de ±${vista.umbral_variacion_pct} %` : '',
      desaparecidos > 0 ? `${desaparecidos} códigos desaparecieron de la base y quedan con error de precio` : '',
    ].filter(Boolean);
    const texto =
      'Se hace un backup de la base, la lista General de hoy se guarda sola en el historial, se guardan los precios nuevos y se recalcula la General. Las versiones de evento no cambian.\n\n' +
      (advertencias.length > 0 ? `Ojo: ${advertencias.join('; ')}.\n\n` : '') +
      '¿Confirmás la actualización?';
    if (!confirm(texto)) return;

    setError('');
    setTrabajando('Aplicando…');
    try {
      const reporte = await catalogoApi.post('/importar/confirmar', { token: vista.token });
      setAplicado(reporte);
      setVista(null);
      setArchivo(null);
      setAumento('');
      setClaveInput((n) => n + 1);
      cargarHistorial();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  }

  async function verDetalle(id) {
    setError('');
    try {
      setDetalle(await catalogoApi.get(`/importaciones/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}

      {esAdmin ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Actualizar precios desde la base parche</h3>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Subí el Excel de la base parche (hoja BDatos). Primero se muestra qué cambiaría; recién cuando confirmás se guarda algo. El archivo original no se modifica.
          </p>
          <form onSubmit={revisar} className="toolbar" style={{ marginBottom: 0 }}>
            <input key={claveInput} type="file" accept=".xlsx,.xlsm" onChange={(e) => setArchivo(e.target.files[0] || null)} />
            <button type="submit" className="primario" disabled={!archivo || Boolean(trabajando)}>
              {trabajando || 'Revisar cambios'}
            </button>
          </form>

          <h3>Aumentar la base cargada un porcentaje</h3>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Sube todos los precios de la base parche que ya está cargada (sin subir un Excel) y arma con eso una nueva lista General. Igual que con un Excel, primero se muestra qué cambiaría. Las versiones de evento no se tocan.
          </p>
          <form onSubmit={revisarAumento} className="toolbar" style={{ marginBottom: 0 }}>
            <div className="campo">
              <label htmlFor="aumento-base">Aumento (%)</label>
              <input id="aumento-base" inputMode="decimal" placeholder="Ej.: 10" value={aumento} onChange={(e) => setAumento(e.target.value)} style={{ width: 120 }} />
            </div>
            <button type="submit" className="primario" disabled={!(Number(String(aumento).replace(',', '.')) > 0) || Boolean(trabajando)}>
              {trabajando || 'Revisar cambios'}
            </button>
          </form>
        </div>
      ) : (
        <div className="aviso advertencia">Sólo un administrador puede actualizar los precios de la base parche. Abajo podés ver el historial.</div>
      )}

      {vista && (
        <div>
          <div className="aviso advertencia">
            <strong>Todavía no se guardó nada.</strong> Revisá los cambios de "{vista.archivo}". Al confirmar se hace un backup de la base, la lista General de hoy queda guardada en el historial y se recalcula la General. Las versiones de evento no cambian.
          </div>
          <div className="toolbar">
            <button className="primario" onClick={confirmar} disabled={Boolean(trabajando)}>
              {trabajando || 'Confirmar y aplicar'}
            </button>
            <button onClick={descartar} disabled={Boolean(trabajando)}>
              Descartar
            </button>
          </div>
          <ReporteCatalogo reporte={vista} />
        </div>
      )}

      {aplicado && (
        <div>
          <div className="aviso exito">
            <strong>Actualización aplicada.</strong> {aplicado.resumen.itemsConCambios} ítems cambiaron de precio. Se hizo un backup de la base antes de guardar.
            {aplicado.historial_version && (
              <>
                {' '}
                La lista de precios de antes quedó guardada como{' '}
                <a href="/catalogo/versiones">"{aplicado.historial_version.nombre}"</a>.
              </>
            )}
          </div>
          <ReporteCatalogo reporte={aplicado} />
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Archivo</th>
              <th>Usuario</th>
              <th className="num">Ítems afectados</th>
              <th>Precios de antes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((h) => (
              <tr key={h.id}>
                <td>{fechaHora(h.fecha)}</td>
                <td>{h.archivo}</td>
                <td className="texto-suave">{h.usuario || 'siembra por línea de comandos'}</td>
                <td className="num">{h.items_afectados}</td>
                <td>
                  {h.historial_version_id ? (
                    <a href="/catalogo/versiones" title="Ver en Versiones → Historial de la General">
                      {h.historial_version_nombre}
                    </a>
                  ) : (
                    <span className="texto-suave">—</span>
                  )}
                </td>
                <td>
                  <button onClick={() => verDetalle(h.id)}>Ver reporte</button>
                </td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={6} className="texto-suave">
                  Todavía no hay importaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {detalle && (
        <Modal onClose={() => setDetalle(null)}>
          <h3 style={{ marginTop: 0 }}>{detalle.archivo}</h3>
          <p className="texto-suave">{fechaHora(detalle.fecha)}</p>
          <ReporteCatalogo reporte={detalle.resumen} />
        </Modal>
      )}
    </div>
  );
}
