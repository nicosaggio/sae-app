import { useEffect, useState } from 'react';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { fechaLarga, fraccionATexto, textoAFraccion } from '../catalogoFormat';

const aTexto = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

function formularioDe(a) {
  return {
    porcentaje_defecto: fraccionATexto(a.porcentaje_defecto),
    multiplo_redondeo: aTexto(a.multiplo_redondeo),
    adicional_pie_tv: aTexto(a.adicional_pie_tv),
    fecha_vigencia: a.fecha_vigencia || '',
    mostrar_decimales: a.mostrar_decimales,
    pie_legal: a.pie_legal,
  };
}

export function CatalogoAjustesPage() {
  const { usuario } = useAuth();
  const puedeEditar = usuario?.rol === 'admin';
  const [ajustes, setAjustes] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  function aplicar(datos) {
    setAjustes(datos);
    setForm(formularioDe(datos));
  }

  useEffect(() => {
    catalogoApi
      .get('/ajustes')
      .then(aplicar)
      .catch((err) => setError(err.message));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    const porcentaje = textoAFraccion(form.porcentaje_defecto);
    if (porcentaje === null || Number.isNaN(porcentaje)) return setError('El porcentaje por defecto tiene que ser un número (por ejemplo 40 para 40 %)');
    const cuerpo = {
      porcentaje_defecto: porcentaje,
      multiplo_redondeo: Number(String(form.multiplo_redondeo).replace(',', '.')),
      adicional_pie_tv: Number(String(form.adicional_pie_tv).replace(',', '.')),
      mostrar_decimales: form.mostrar_decimales,
      pie_legal: form.pie_legal,
    };
    if (form.fecha_vigencia) cuerpo.fecha_vigencia = form.fecha_vigencia;
    setGuardando(true);
    try {
      aplicar(await catalogoApi.put('/ajustes', cuerpo));
      setAviso('Ajustes guardados. Los precios de la versión General se recalcularon.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!form) return error ? <div className="aviso error">{error}</div> : <p className="texto-suave">Cargando…</p>;

  const cambiar = (campo, valor) => setForm({ ...form, [campo]: valor });

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      <div className="aviso advertencia">
        <strong>Las fotos no entran en el backup automático.</strong> {ajustes.aviso_imagenes}
        <br />
        Carpeta de fotos en este servidor: <code>{ajustes.carpeta_imagenes}</code>
      </div>

      <form onSubmit={guardar} className="card">
        {!puedeEditar && <p className="texto-suave" style={{ marginTop: 0 }}>Sólo un administrador puede cambiar los ajustes.</p>}
        <div className="form-grid">
          <div className="campo">
            <label>Porcentaje por defecto (%)</label>
            <input value={form.porcentaje_defecto} disabled={!puedeEditar} onChange={(e) => cambiar('porcentaje_defecto', e.target.value)} />
          </div>
          <div className="campo">
            <label>Redondeo: múltiplo hacia arriba ($)</label>
            <input value={form.multiplo_redondeo} disabled={!puedeEditar} onChange={(e) => cambiar('multiplo_redondeo', e.target.value)} />
          </div>
          <div className="campo">
            <label>Adicional del pie de los TV ($)</label>
            <input value={form.adicional_pie_tv} disabled={!puedeEditar} onChange={(e) => cambiar('adicional_pie_tv', e.target.value)} />
          </div>
          <div className="campo">
            <label>Vigencia de los precios</label>
            <input type="date" value={form.fecha_vigencia} disabled={!puedeEditar} onChange={(e) => cambiar('fecha_vigencia', e.target.value)} />
            <span className="texto-suave">{fechaLarga(form.fecha_vigencia)}</span>
          </div>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '14px 0' }}>
          <input type="checkbox" checked={form.mostrar_decimales} disabled={!puedeEditar} onChange={(e) => cambiar('mostrar_decimales', e.target.checked)} />
          Mostrar los decimales en el catálogo (por ejemplo $ 40.200,00)
        </label>
        <div className="campo">
          <label>Pie legal (usá {'{fecha_vigencia}'} donde va la fecha en letras)</label>
          <textarea rows={4} value={form.pie_legal} disabled={!puedeEditar} onChange={(e) => cambiar('pie_legal', e.target.value)} />
        </div>
        <p className="texto-suave">
          El porcentaje por defecto es el de la versión General. Al guardar se recalculan los precios de la General; las versiones de evento no se tocan.
        </p>
        {puedeEditar && (
          <button type="submit" className="primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar ajustes'}
          </button>
        )}
      </form>
    </div>
  );
}
