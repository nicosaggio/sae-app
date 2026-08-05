import { useEffect, useRef, useState } from 'react';

/** Input de texto con autocompletado para elegir un producto por nombre o código. */
export function BuscadorProducto({ productos, value, onChange, placeholder = 'Buscar producto…' }) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  const seleccionado = productos.find((p) => p.id === value);

  useEffect(() => {
    function onClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  const texto = seleccionado && !abierto ? seleccionado.nombre : query;

  const coincidencias = query.trim()
    ? productos
        .filter(
          (p) =>
            p.nombre.toLowerCase().includes(query.trim().toLowerCase()) ||
            (p.codigo || '').toLowerCase().includes(query.trim().toLowerCase())
        )
        .slice(0, 30)
    : productos.slice(0, 30);

  function elegir(p) {
    onChange(p.id);
    setQuery('');
    setAbierto(false);
  }

  function onInputChange(e) {
    setQuery(e.target.value);
    setAbierto(true);
    if (value) onChange(null);
  }

  return (
    <div ref={contenedorRef} className="buscador-producto">
      <input placeholder={placeholder} value={texto} onChange={onInputChange} onFocus={() => setAbierto(true)} />
      {abierto && coincidencias.length > 0 && (
        <div className="buscador-dropdown">
          {coincidencias.map((p) => (
            <div key={p.id} className="buscador-opcion" onMouseDown={() => elegir(p)}>
              {p.nombre} <span className="texto-suave">({p.codigo}{p.rubro ? ` — ${p.rubro}` : ''})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
