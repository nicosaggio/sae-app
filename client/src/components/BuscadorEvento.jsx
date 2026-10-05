import { useEffect, useRef, useState } from 'react';
import { useListaTeclado } from '../hooks/useListaTeclado';

/** Input de texto con autocompletado para elegir un evento por nombre. */
export function BuscadorEvento({ eventos, value, onChange, placeholder = 'Buscar evento…' }) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  const seleccionado = eventos.find((e) => e.id === value);

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
    ? eventos.filter((e) => e.nombre.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
    : eventos.slice(0, 30);

  function elegir(ev) {
    onChange(ev.id);
    setQuery('');
    setAbierto(false);
  }

  const lista = useListaTeclado({
    cantidad: coincidencias.length,
    abierto,
    setAbierto,
    elegirEn: (i) => elegir(coincidencias[i]),
    sugerirPrimera: query.trim() !== '',
  });

  function onInputChange(e) {
    setQuery(e.target.value);
    setAbierto(true);
    lista.reiniciar();
    if (value) onChange(null);
  }

  return (
    <div ref={contenedorRef} className="buscador-producto">
      <input placeholder={placeholder} value={texto} onChange={onInputChange} onFocus={() => setAbierto(true)} onKeyDown={lista.onKeyDown} />
      {abierto && coincidencias.length > 0 && (
        <div className="buscador-dropdown" {...lista.propsLista}>
          {coincidencias.map((ev, i) => (
            <div key={ev.id} className="buscador-opcion" onMouseDown={() => elegir(ev)} {...lista.propsOpcion(i)}>
              {ev.nombre} <span className="texto-suave">({ev.fecha_inicio || 'sin fecha'})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
