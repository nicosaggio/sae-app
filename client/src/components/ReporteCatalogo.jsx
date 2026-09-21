import { useMemo, useState } from 'react';
import { fechaLarga, pesos } from '../catalogoFormat';

function Cifra({ valor, texto, alerta }) {
  return (
    <div className={`cifra${alerta && valor > 0 ? ' alerta' : ''}`}>
      <strong>{valor}</strong>
      <span>{texto}</span>
    </div>
  );
}

function Seccion({ titulo, cantidad, abierta = false, children }) {
  return (
    <details className="card" open={abierta} style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {titulo} {cantidad !== undefined && <span className="badge baja">{cantidad}</span>}
      </summary>
      <div style={{ marginTop: 12 }} className="tabla-scroll">
        {children}
      </div>
    </details>
  );
}

const textoValor = (v) => (typeof v === 'number' ? pesos(v) : v === null || v === undefined ? '—' : `"${v}"`);

/** Reporte de una actualización de la base parche (previsualización o ya aplicada). */
function ReporteActualizacion({ reporte }) {
  const [soloGrandes, setSoloGrandes] = useState(false);
  const r = reporte.resumen;
  const cambios = soloGrandes ? reporte.cambios.filter((c) => c.destacado) : reporte.cambios;
  const a = reporte.advertencias;

  return (
    <div>
      <div className="resumen-cifras">
        <Cifra valor={r.itemsConCambios} texto={`ítems cambian de precio (de ${r.itemsEvaluados})`} />
        <Cifra valor={r.variacionesGrandes} texto={`variaciones de más de ±${reporte.umbral_variacion_pct} %`} alerta />
        <Cifra valor={r.codigosDesaparecidos} texto="códigos que ya no existen en la base" alerta />
        <Cifra valor={r.itemsQuePerdieronPrecio} texto="ítems que pierden su precio" alerta />
        <Cifra valor={r.itemsSinPrecio} texto="ítems sin precio en total" />
        <Cifra valor={r.codigosNuevosEnBase} texto="códigos nuevos en la base" />
        <Cifra valor={r.versionesAfectadas} texto="versiones afectadas" />
      </div>

      <Seccion titulo="Versiones que quedan afectadas" cantidad={reporte.versiones_afectadas.length} abierta>
        <table>
          <thead>
            <tr>
              <th>Versión</th>
              <th className="num">Porcentaje</th>
              <th className="num">Ítems con otro precio</th>
            </tr>
          </thead>
          <tbody>
            {reporte.versiones_afectadas.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.nombre} {v.es_general === 1 && <span className="badge tipo">General</span>}
                </td>
                <td className="num">{Math.round(v.porcentaje_global * 10000) / 100} %</td>
                <td className="num">{v.items_afectados}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      {reporte.codigos_desaparecidos.length > 0 && (
        <Seccion titulo="⚠ Códigos del catálogo que ya no existen en la base parche" cantidad={reporte.codigos_desaparecidos.length} abierta>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Código buscado en la base</th>
              </tr>
            </thead>
            <tbody>
              {reporte.codigos_desaparecidos.map((d) => (
                <tr key={d.codigo} className="fila-alerta">
                  <td>
                    <strong>{d.codigo}</strong>
                  </td>
                  <td>{d.descripcion}</td>
                  <td>{d.codigo_base}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="texto-suave">Estos ítems quedan con error de precio (no en $ 0) hasta que les cambies el código o la regla.</p>
        </Seccion>
      )}

      <Seccion titulo="Cambios de precio" cantidad={reporte.cambios.length} abierta={reporte.cambios.length > 0 && reporte.cambios.length <= 40}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <input type="checkbox" checked={soloGrandes} onChange={(e) => setSoloGrandes(e.target.checked)} />
          Mostrar sólo las variaciones grandes
        </label>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th className="num">Pase parche</th>
              <th className="num">SAE anterior</th>
              <th className="num">SAE nuevo</th>
              <th className="num">Variación</th>
            </tr>
          </thead>
          <tbody>
            {cambios.map((c) => (
              <tr key={c.id} className={c.destacado ? 'fila-destacada' : ''}>
                <td>
                  <strong>{c.codigo}</strong>
                </td>
                <td>{c.descripcion}</td>
                <td className="num">
                  {pesos(c.pase_anterior)} → {pesos(c.pase_nuevo)}
                </td>
                <td className="num">{pesos(c.sae_anterior)}</td>
                <td className="num">
                  {c.estado_nuevo === 'ok' ? pesos(c.sae_nuevo) : <span className={`badge ${c.estado_nuevo === 'error' ? 'error' : 'sin_precio'}`}>{c.estado_nuevo === 'error' ? 'Error' : 'S / P'}</span>}
                </td>
                <td className="num">{c.variacion_pct === null ? '—' : `${c.variacion_pct > 0 ? '+' : ''}${String(c.variacion_pct).replace('.', ',')} %`}</td>
              </tr>
            ))}
            {cambios.length === 0 && (
              <tr>
                <td colSpan={6} className="texto-suave">
                  Ningún precio cambia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo="Ítems que están (o quedan) sin precio" cantidad={reporte.items_sin_precio.length}>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Motivo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reporte.items_sin_precio.map((s) => (
              <tr key={s.codigo} className={s.tenia_precio ? 'fila-alerta' : ''}>
                <td>
                  <strong>{s.codigo}</strong>
                </td>
                <td>{s.descripcion}</td>
                <td>{s.motivo_texto}</td>
                <td>{s.tenia_precio && <span className="badge error">lo perdió ahora</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo="Códigos nuevos en la base que no están en el catálogo (informativo)" cantidad={r.codigosNuevosEnBase}>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Grupo</th>
              <th className="num">$ Cliente</th>
            </tr>
          </thead>
          <tbody>
            {reporte.codigos_nuevos_en_base.map((n) => (
              <tr key={n.codigo}>
                <td>{n.codigo}</td>
                <td>{n.descripcion}</td>
                <td className="texto-suave">{n.grupo}</td>
                <td className="num">{textoValor(n.cliente)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.codigosNuevosEnBase > reporte.codigos_nuevos_en_base.length && <p className="texto-suave">Se muestran los primeros {reporte.codigos_nuevos_en_base.length}.</p>}
      </Seccion>

      <Seccion titulo="Advertencias sobre el archivo">
        <ul style={{ margin: 0 }}>
          <li>
            Códigos repetidos en el archivo: {a.codigos_repetidos_en_el_archivo.length === 0 ? 'ninguno' : a.codigos_repetidos_en_el_archivo.map((d) => `${d.codigo} (filas ${d.filas.join(' y ')})`).join(', ')}. Se usa la primera aparición.
          </li>
          <li>Filas con precio pero sin código (se ignoran): {a.filas_con_precio_y_sin_codigo}</li>
          <li>Filas ocultas ignoradas: {a.filas_ocultas_ignoradas}</li>
          <li>
            Valores de $ CLIENTE: {a.valores_de_la_base.numericos} con precio, {a.valores_de_la_base.ceros} en 0, {a.valores_de_la_base.textos} con texto (por ejemplo "S / P"), {a.valores_de_la_base.vacios} vacíos. Nunca se convierten en $ 0.
          </li>
        </ul>
      </Seccion>
    </div>
  );
}

/** Reporte de la siembra inicial: cómo quedó clasificado cada ítem del catálogo. */
function ReporteSiembra({ reporte }) {
  const [filtroRegla, setFiltroRegla] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const t = reporte.totales;
  const tipos = Object.keys(reporte.clasificacion);

  const items = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return reporte.items.filter((i) => (!filtroRegla || i.regla.startsWith(filtroRegla)) && (!q || i.codigo.toUpperCase().includes(q)));
  }, [reporte, filtroRegla, busqueda]);

  return (
    <div>
      <div className="resumen-cifras">
        <Cifra valor={t.itemsImportados} texto="ítems importados" />
        <Cifra valor={t.itemsPublicados} texto="publicados en el catálogo" />
        <Cifra valor={t.paginas} texto="páginas" />
        <Cifra valor={t.productosEnlazados} texto="enlazados a Productos" />
        <Cifra valor={reporte.verificacion.coinciden} texto="con el mismo SAE que el Excel" />
        <Cifra valor={reporte.verificacion.difieren.length} texto="con distinto SAE que el Excel" alerta />
        <Cifra valor={reporte.difierenDeBaseParche.length} texto="difieren de la base parche" />
      </div>

      <p>
        <strong>Reglas de precio:</strong>{' '}
        {tipos.map((k) => (
          <span key={k} className="chip">
            {k} {reporte.clasificacion[k]}
          </span>
        ))}
      </p>
      <p className="texto-suave">Vigencia de los precios: {fechaLarga(t.vigencia)}. Archivos: {reporte.archivos?.catalogo} y {reporte.archivos?.baseParche}.</p>

      {reporte.difierenDeBaseParche.length > 0 && (
        <Seccion titulo="Difieren de la base parche: se dejó su regla actual (no cambian de precio)" cantidad={reporte.difierenDeBaseParche.length} abierta>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Regla actual</th>
                <th className="num">Valor en el catálogo</th>
                <th className="num">Valor en la base parche</th>
              </tr>
            </thead>
            <tbody>
              {reporte.difierenDeBaseParche.map((d) => (
                <tr key={d.codigo}>
                  <td>
                    <strong>{d.codigo}</strong>
                  </td>
                  <td>{d.regla}</td>
                  <td className="num">{textoValor(d.valor_en_catalogo)}</td>
                  <td className="num">{textoValor(d.valor_en_base_parche)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="texto-suave">Para pasarlos a la base parche, abrí el ítem y cambiale la regla a "Base".</p>
        </Seccion>
      )}

      {(reporte.salteadas.length > 0 || reporte.notas.length > 0 || reporte.avisos.length > 0) && (
        <Seccion titulo="Filas salteadas y avisos" cantidad={reporte.salteadas.length + reporte.notas.length + reporte.avisos.length} abierta>
          <ul style={{ margin: 0 }}>
            {reporte.salteadas.map((s) => (
              <li key={s.fila}>
                Fila {s.fila} {s.codigo || '(sin código)'} — {s.descripcion}: {s.motivo}
              </li>
            ))}
            {reporte.notas.map((n) => (
              <li key={`n${n.fila}`}>
                Fila {n.fila}: nota ignorada "{n.texto}"
              </li>
            ))}
            {reporte.avisos.map((a, i) => (
              <li key={`a${i}`}>{a}</li>
            ))}
          </ul>
        </Seccion>
      )}

      <Seccion titulo="Imágenes">
        <p style={{ margin: 0 }}>
          {reporte.imagenes.celdasConImagen} celdas con imagen → {reporte.imagenes.archivosDistintos} archivos distintos. {reporte.imagenes.pesoOriginalMB} MB → {reporte.imagenes.pesoFinalMB} MB. Errores: {reporte.imagenes.errores.length}.
        </p>
      </Seccion>

      <Seccion titulo="Cómo quedó cada ítem" cantidad={reporte.items.length}>
        <div className="toolbar">
          <input placeholder="Buscar código" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select value={filtroRegla} onChange={(e) => setFiltroRegla(e.target.value)} aria-label="Filtrar por regla">
            <option value="">Todas las reglas</option>
            {['base', 'derivado', 'manual', 'proporcional', 'razón', 'sin precio'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <span className="texto-suave">{items.length} ítems</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Rubro</th>
              <th>Regla</th>
              <th className="num">Pase parche</th>
              <th className="num">SAE</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.codigo}>
                <td>
                  <strong>{i.codigo}</strong> {i.publicado && <span className="badge tipo">publicado</span>}
                </td>
                <td className="texto-suave">{i.rubro}</td>
                <td>{i.regla}</td>
                <td className="num">{pesos(i.pase_parche)}</td>
                <td className="num">{i.sae_app === null ? <span className="badge sin_precio">S / P</span> : pesos(i.sae_app)}</td>
                <td>
                  {i.difiere_de_base_parche && <span className="badge sin_precio">difiere de BDatos</span>}
                  {i.codigo_tomado_de_base_parche && <span className="badge ok">código de la base parche</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>
    </div>
  );
}

/** Muestra el reporte de una importación, sea una actualización de la base parche o la siembra inicial. */
export function ReporteCatalogo({ reporte }) {
  if (!reporte) return <p className="texto-suave">Esta importación no guardó reporte.</p>;
  if (reporte.cambios) return <ReporteActualizacion reporte={reporte} />;
  if (reporte.clasificacion) return <ReporteSiembra reporte={reporte} />;
  return <p className="texto-suave">Formato de reporte desconocido.</p>;
}
