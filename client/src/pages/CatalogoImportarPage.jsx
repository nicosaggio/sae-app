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

  function descartar() {
    setVista(null);
    setArchivo(null);
    setClaveInput((n) => n + 1);
  }

  async function confirmar() {
    const versiones = vista.versiones_afectadas.filter((v) => v.items_afectados > 0).length;
    const grandes = vista.resumen.variacionesGrandes;
    const desaparecidos = vista.resumen.codigosDesaparecidos;
    const advertencias = [
      grandes > 0 ? `${grandes} ítems varían más de ±${vista.umbral_variacion_pct} %` : '',
      desaparecidos > 0 ? `${desaparecidos} códigos desaparecieron de la base y quedan con error de precio` : '',
    ].filter(Boolean);
    const texto =
      `Se hace un backup de la base, se guardan los precios nuevos y se recalculan la General y ${versiones} versión(es).\n\n` +
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
        </div>
      ) : (
        <div className="aviso advertencia">Sólo un administrador puede actualizar los precios desde la base parche. Abajo podés ver el historial.</div>
      )}

      {vista && (
        <div>
          <div className="aviso advertencia">
            <strong>Todavía no se guardó nada.</strong> Revisá los cambios de "{vista.archivo}". Al confirmar se hace un backup de la base y se recalculan la General y {vista.versiones_afectadas.filter((v) => !v.es_general && v.items_afectados > 0).length} versión(es) de evento.
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
          </div>
          <ReporteCatalogo reporte={aplicado} />
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Archivo</th>
              <th>Usuario</th>
              <th className="num">Ítems afectados</th>
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
                  <button onClick={() => verDetalle(h.id)}>Ver reporte</button>
                </td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={5} className="texto-suave">
                  Todavía no hay importaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
