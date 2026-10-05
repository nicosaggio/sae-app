import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useListaTeclado } from '../hooks/useListaTeclado';

/**
 * Campo de razón social con autocompletado: al escribir sugiere clientes ya guardados (por razón social,
 * contacto o CUIT). Al elegir uno, avisa con `onElegir` para que el formulario complete sus datos.
 */
export function BuscadorCliente({ value, onChange, onElegir, disabled = false }) {
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState([]);
  const contenedorRef = useRef(null);

  useEffect(() => {
    function onClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  useEffect(() => {
    if (!abierto || value.trim().length < 2) return undefined;
    const espera = setTimeout(() => {
      api
        .get(`/clientes/buscar?q=${encodeURIComponent(value.trim())}&limite=8`)
        .then(setResultados)
        .catch(() => setResultados([]));
    }, 200);
    return () => clearTimeout(espera);
  }, [value, abierto]);

  const sugerencias = abierto && value.trim().length >= 2 ? resultados : [];

  function elegir(cliente) {
    onElegir(cliente);
    setAbierto(false);
  }

  // Texto libre: acá no se autocompleta sola la primera sugerencia (pisaría los datos de un cliente nuevo
  // con los de otro parecido); sólo se acepta la que se marca con las flechas.
  const lista = useListaTeclado({
    cantidad: sugerencias.length,
    abierto,
    setAbierto,
    elegirEn: (i) => elegir(sugerencias[i]),
    sugerirPrimera: false,
  });

  return (
    <div ref={contenedorRef} className="buscador-producto">
      <input
        value={value}
        disabled={disabled}
        placeholder="Escribí para buscar un cliente guardado…"
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
          lista.reiniciar();
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={lista.onKeyDown}
      />
      {sugerencias.length > 0 && (
        <div className="buscador-dropdown" {...lista.propsLista}>
          {sugerencias.map((c, i) => (
            <div key={c.id} className="buscador-opcion" onMouseDown={() => elegir(c)} {...lista.propsOpcion(i)}>
              <strong>{c.razon_social || 'Sin razón social'}</strong> <span className="texto-suave">({c.cuit})</span>
              {c.contacto && <div className="texto-suave">{c.contacto}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
