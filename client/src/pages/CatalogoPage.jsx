import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogoApi as api } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { FichaCatalogo } from '../components/FichaCatalogo';
import { fechaLarga, formatearImporte, urlImagen } from '../catalogoFormat';

function CeldaDeItem({ item, conDecimales, onClick }) {
  const foto = urlImagen(item.imagen);
  return (
    <button type="button" className="hoja-item" onClick={onClick} title="Ver el ítem">
      <div className="hoja-etiqueta">CODIGO:</div>
      <div className="hoja-codigo">{item.codigo}</div>
      <div className={`hoja-foto${foto ? '' : ' sin-foto'}`}>{foto ? <img src={foto} alt={item.codigo} loading="lazy" /> : 'sin foto'}</div>
      <FichaCatalogo corridas={item.descripcion_formato} texto={item.descripcion_catalogo} />
      <div className="hoja-precio">
        {item.estado_precio === 'ok' && typeof item.sae === 'number' ? (
          <>
            <span>$</span>
            <span>{formatearImporte(item.sae, conDecimales)}</span>
          </>
        ) : (
          <span style={{ marginLeft: 'auto' }}>S / P</span>
        )}
      </div>
    </button>
  );
}

function CeldaOrganizable({ posicion, items, onCambiar, onQuitar, conDecimales }) {
  const [texto, setTexto] = useState('');

  function alEscribir(valor) {
    setTexto(valor);
    const encontrado = items.find((i) => i.codigo.toUpperCase() === valor.trim().toUpperCase());
    if (encontrado) {
      onCambiar(encontrado);
      setTexto('');
    }
  }

  return (
    <div>
      {posicion ? (
        <CeldaDeItem item={posicion.item} conDecimales={conDecimales} onClick={() => {}} />
      ) : (
        <div className="hoja-vacia">celda vacía</div>
      )}
      <div className="organizar-celda">
        <input list="items-catalogo" placeholder={posicion ? 'Cambiar por…' : 'Código del ítem'} value={texto} onChange={(e) => alEscribir(e.target.value)} />
        {posicion && (
          <button type="button" className="peligro" onClick={onQuitar} title="Sacar de esta celda">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Hoja({ pagina, logo, pie, conDecimales, organizando, items, onCelda, onAbrirItem }) {
  return (
    <div className="hoja-catalogo">
      {!pagina.logo_grande && logo && (
        <div className="hoja-logo">
          <img src={logo} alt="Anselmi" />
        </div>
      )}
      <h3 className="hoja-titulo">{pagina.titulo}</h3>
      {[1, 2].map((banda) => (
        <div className="hoja-banda" key={banda}>
          {[1, 2, 3].map((columna) => {
            const posicion = pagina.posiciones.find((p) => p.banda === banda && p.columna === columna);
            return (
              <div className="hoja-celda" key={columna}>
                {organizando ? (
                  <CeldaOrganizable
                    posicion={posicion}
                    items={items}
                    conDecimales={conDecimales}
                    onCambiar={(item) => onCelda(banda, columna, item)}
                    onQuitar={() => onCelda(banda, columna, null)}
                  />
                ) : (
                  posicion && <CeldaDeItem item={posicion.item} conDecimales={conDecimales} onClick={() => onAbrirItem(posicion.item.id)} />
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="hoja-pie">{pie}</div>
    </div>
  );
}

export function CatalogoPage() {
  const { puedeEscribir } = useAuth();
  const navigate = useNavigate();
  const [versiones, setVersiones] = useState([]);
  const [versionId, setVersionId] = useState(null);
  const [ajustes, setAjustes] = useState(null);
  const [paginas, setPaginas] = useState([]);
  const [indice, setIndice] = useState(0);
  const [items, setItems] = useState([]);
  const [borrador, setBorrador] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  async function cargarVersiones(mantener) {
    const lista = await api.get('/versiones');
    setVersiones(lista);
    if (!mantener) setVersionId(lista[0]?.id ?? null);
    return lista;
  }

  useEffect(() => {
    Promise.all([cargarVersiones(false), api.get('/ajustes')])
      .then(([, a]) => setAjustes(a))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, []);

  async function cargarPaginas(id = versionId) {
    if (!id) return;
    try {
      setPaginas(await api.get(`/paginas?version=${id}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    cargarPaginas(versionId);
    setIndice(0);
  }, [versionId]);

  const version = versiones.find((v) => v.id === versionId);
  const organizando = borrador !== null;
  const origen = organizando ? borrador : paginas;
  const hayPortada = origen.length > 0 && Boolean(origen[0].logo_grande);
  const totalHojas = origen.length + (hayPortada ? 1 : 0);
  const hojaActual = Math.min(indice, Math.max(0, totalHojas - 1));
  const enPortada = hayPortada && hojaActual === 0;
  const indicePagina = hojaActual - (hayPortada ? 1 : 0);
  const pagina = enPortada ? null : origen[indicePagina];

  const logo = ajustes?.logo_imagen ? urlImagen(ajustes.logo_imagen) : null;
  const conDecimales = ajustes ? ajustes.mostrar_decimales : true;
  const pie = ((version?.pie_legal || ajustes?.pie_legal) ?? '').replace('{fecha_vigencia}', fechaLarga(version?.fecha_vigencia));

  async function recalcular() {
    setError('');
    try {
      await api.post(`/versiones/${versionId}/recalcular`);
      await cargarVersiones(true);
      await cargarPaginas();
      setAviso('Versión recalculada con las reglas actuales.');
    } catch (err) {
      setError(err.message);
    }
  }

  // ---- Organizar el catálogo (estructura compartida por todas las versiones)
  async function iniciarOrganizar() {
    setError('');
    setAviso('');
    try {
      setItems(await api.get('/items'));
      setBorrador(JSON.parse(JSON.stringify(paginas)));
    } catch (err) {
      setError(err.message);
    }
  }

  function cambiarBorrador(fn) {
    setBorrador((actual) => {
      const copia = JSON.parse(JSON.stringify(actual));
      fn(copia);
      if (copia.length > 0) copia.forEach((p, i) => (p.logo_grande = i === 0 ? p.logo_grande : 0));
      return copia;
    });
  }

  function ponerEnCelda(banda, columna, item) {
    cambiarBorrador((paginasCopia) => {
      const p = paginasCopia[indicePagina];
      p.posiciones = p.posiciones.filter((x) => !(x.banda === banda && x.columna === columna));
      if (item) {
        // un ítem sólo puede estar una vez: si ya estaba en otra celda, se mueve
        paginasCopia.forEach((otra) => (otra.posiciones = otra.posiciones.filter((x) => x.item.id !== item.id)));
        p.posiciones.push({ banda, columna, item: { id: item.id, codigo: item.codigo, descripcion_catalogo: item.descripcion, descripcion_formato: null, imagen: item.imagen, sae: item.sae, estado_precio: item.estado_precio } });
      }
    });
  }

  function moverPagina(delta) {
    const destino = indicePagina + delta;
    if (destino < 0 || destino >= borrador.length) return;
    cambiarBorrador((c) => c.splice(destino, 0, c.splice(indicePagina, 1)[0]));
    setIndice(hojaActual + delta);
  }

  function agregarPagina() {
    cambiarBorrador((c) => c.push({ id: null, orden: c.length + 1, titulo: 'SAE - NUEVA PÁGINA', logo_grande: 0, posiciones: [] }));
    setIndice(totalHojas);
  }

  function eliminarPagina() {
    if (!confirm(`¿Sacar la página "${pagina.titulo}" del catálogo? Los ítems no se borran, sólo dejan de estar publicados.`)) return;
    cambiarBorrador((c) => c.splice(indicePagina, 1));
    setIndice(Math.max(0, hojaActual - 1));
  }

  async function guardarOrganizacion() {
    setGuardando(true);
    setError('');
    try {
      const cuerpo = {
        paginas: borrador.map((p, i) => ({
          id: p.id,
          titulo: p.titulo,
          logo_grande: i === 0 && Boolean(p.logo_grande),
          posiciones: p.posiciones.map((x) => ({ banda: x.banda, columna: x.columna, item_id: x.item.id })),
        })),
      };
      setPaginas(await api.put('/paginas', cuerpo));
      await cargarPaginas();
      setBorrador(null);
      setAviso('Catálogo guardado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="texto-suave">Cargando…</p>;

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="campo">
              <label htmlFor="version-vista">Versión</label>
              <select id="version-vista" value={versionId ?? ''} disabled={organizando} onChange={(e) => {
                  setAviso('');
                  setVersionId(Number(e.target.value));
                }}>
                {versiones.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre} ({Math.round(v.porcentaje_global * 10000) / 100} %)
                  </option>
                ))}
              </select>
            </div>
            {version && !version.es_general && version.items_desactualizados > 0 && !organizando && (
              <span className="aviso advertencia" style={{ margin: 0 }}>
                {version.items_desactualizados} precios desactualizados respecto de las reglas de hoy{' '}
                {puedeEscribir && <button onClick={recalcular}>Recalcular</button>}
              </span>
            )}
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {puedeEscribir && !organizando && <button onClick={iniciarOrganizar}>Organizar páginas</button>}
            {organizando && (
              <>
                <button className="primario" onClick={guardarOrganizacion} disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar catálogo'}
                </button>
                <button onClick={() => setBorrador(null)} disabled={guardando}>
                  Cancelar
                </button>
              </>
            )}
            {!organizando && versionId && (
              <a className="boton primario" href={`/api/catalogo/versiones/${versionId}/pdf`}>
                Exportar PDF
              </a>
            )}
          </div>
        </div>
      </div>

      {totalHojas === 0 ? (
        <div className="card">
          <p className="texto-suave" style={{ margin: 0 }}>
            El catálogo todavía no tiene páginas. {puedeEscribir ? 'Usá "Organizar páginas" para armarlo, o corré la siembra inicial (ver README).' : ''}
          </p>
        </div>
      ) : (
        <>
          <div className="pager">
            <button onClick={() => setIndice(Math.max(0, hojaActual - 1))} disabled={hojaActual === 0}>
              ‹ Anterior
            </button>
            <select value={hojaActual} onChange={(e) => setIndice(Number(e.target.value))} aria-label="Ir a la página">
              {hayPortada && <option value={0}>Portada</option>}
              {origen.map((p, i) => (
                <option key={p.id ?? `nueva-${i}`} value={i + (hayPortada ? 1 : 0)}>
                  {i + 1}. {p.titulo}
                </option>
              ))}
            </select>
            <button onClick={() => setIndice(Math.min(totalHojas - 1, hojaActual + 1))} disabled={hojaActual >= totalHojas - 1}>
              Siguiente ›
            </button>
          </div>

          {organizando && pagina && (
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <div className="campo" style={{ minWidth: 280 }}>
                  <label htmlFor="titulo-pagina">Título de la página</label>
                  <input id="titulo-pagina" value={pagina.titulo} onChange={(e) => cambiarBorrador((c) => (c[indicePagina].titulo = e.target.value))} />
                </div>
                <button onClick={() => moverPagina(-1)} disabled={indicePagina === 0}>
                  ↑ Subir página
                </button>
                <button onClick={() => moverPagina(1)} disabled={indicePagina >= borrador.length - 1}>
                  ↓ Bajar página
                </button>
                <button onClick={agregarPagina}>+ Página nueva</button>
                <button className="peligro" onClick={eliminarPagina}>
                  Sacar página
                </button>
                {indicePagina === 0 && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={Boolean(pagina.logo_grande)} onChange={(e) => cambiarBorrador((c) => (c[0].logo_grande = e.target.checked ? 1 : 0))} />
                    Con portada (logo grande)
                  </label>
                )}
              </div>
              <p className="texto-suave" style={{ marginBottom: 0 }}>
                Escribí el código de un ítem en una celda para ubicarlo (si ya estaba en otro lado, se mueve). Se guarda todo junto con "Guardar catálogo".
              </p>
            </div>
          )}

          {enPortada ? (
            <div className="hoja-catalogo hoja-portada">{logo ? <img src={logo} alt="Anselmi Industria Publicitaria" /> : <span className="texto-suave">Sin logo cargado</span>}</div>
          ) : (
            pagina && (
              <Hoja
                pagina={pagina}
                logo={logo}
                pie={pie}
                conDecimales={conDecimales}
                organizando={organizando}
                items={items}
                onCelda={ponerEnCelda}
                onAbrirItem={(id) => navigate(`/catalogo/items?abrir=${id}`)}
              />
            )
          )}
          <datalist id="items-catalogo">
            {items.map((i) => (
              <option key={i.id} value={i.codigo}>
                {i.descripcion}
              </option>
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
