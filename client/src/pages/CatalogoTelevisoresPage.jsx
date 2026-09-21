import { useEffect, useState } from 'react';
import { catalogoApi } from '../api/catalogoApi';
import { useAuth } from '../context/AuthContext';
import { pesos, porcentaje } from '../catalogoFormat';

const aTexto = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const aNumero = (t) => Number(String(t).trim().replace(',', '.'));

export function CatalogoTelevisoresPage() {
  const { puedeEscribir } = useAuth();
  const [datos, setDatos] = useState(null);
  const [adicional, setAdicional] = useState('');
  const [precios, setPrecios] = useState({});
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  function aplicar(respuesta) {
    setDatos(respuesta);
    setAdicional(aTexto(respuesta.adicional_pie));
    setPrecios(Object.fromEntries(respuesta.items.map((t) => [t.id, aTexto(t.precio_lista)])));
  }

  useEffect(() => {
    catalogoApi
      .get('/televisores')
      .then(aplicar)
      .catch((err) => setError(err.message));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    const cuerpo = {
      adicional_pie: aNumero(adicional),
      precios: datos.items.map((t) => ({ id: t.id, precio_lista: aNumero(precios[t.id]) })),
    };
    setGuardando(true);
    try {
      aplicar(await catalogoApi.put('/televisores', cuerpo));
      setAviso('Guardado: los precios de los televisores y de los ítems que dependen de ellos ya están recalculados.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!datos) return error ? <div className="aviso error">{error}</div> : <p className="texto-suave">Cargando…</p>;

  const adicionalNumero = aNumero(adicional);

  return (
    <div>
      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      <form onSubmit={guardar}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pie de los televisores</h3>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            El precio de lista de cada televisor no sale de la base parche: se carga acá a mano. Al precio de lista se le suma un adicional único por el pie o soporte, igual para todos.
          </p>
          <div className="campo" style={{ maxWidth: 240 }}>
            <label htmlFor="adicional-pie">Adicional del pie ($)</label>
            <div className="input-moneda">
              <input id="adicional-pie" value={adicional} disabled={!puedeEscribir} onChange={(e) => setAdicional(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th className="num">Precio de lista</th>
                  <th className="num">+ pie</th>
                  <th className="num">%</th>
                  <th className="num">SAE actual</th>
                  <th>También cambian</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((t) => {
                  const lista = aNumero(precios[t.id]);
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.codigo}</strong>
                      </td>
                      <td>{t.descripcion}</td>
                      <td className="num">
                        <div className="input-moneda" style={{ display: 'inline-block', width: 140 }}>
                          <input value={precios[t.id]} disabled={!puedeEscribir} onChange={(e) => setPrecios({ ...precios, [t.id]: e.target.value })} style={{ textAlign: 'right' }} />
                        </div>
                      </td>
                      <td className="num">{Number.isFinite(lista) && Number.isFinite(adicionalNumero) ? pesos(lista + adicionalNumero, false) : '—'}</td>
                      <td className="num">{t.porcentaje === null ? 'general' : porcentaje(t.porcentaje)}</td>
                      <td className="num">{t.sae === null ? 'S / P' : pesos(t.sae)}</td>
                      <td className="texto-suave">{t.derivados.length === 0 ? '—' : t.derivados.map((d) => `${d.codigo} (${pesos(d.sae)})`).join(', ')}</td>
                    </tr>
                  );
                })}
                {datos.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="texto-suave">
                      Ningún ítem suma el pie todavía. En la ficha de un ítem, con regla "Precio fijo", tildá "Suma el adicional del pie".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="texto-suave" style={{ marginBottom: 0 }}>
            La columna "+ pie" muestra lo que va a quedar como pase parche. El SAE se recalcula al guardar; los televisores mantienen su porcentaje propio (100 %) en todas las versiones.
          </p>
        </div>

        {puedeEscribir && (
          <button type="submit" className="primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar precios de televisores'}
          </button>
        )}
      </form>
    </div>
  );
}
