import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

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

  return (
    <div ref={contenedorRef} className="buscador-producto">
      <input
        value={value}
        disabled={disabled}
        placeholder="Escribí para buscar un cliente guardado…"
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
      />
      {sugerencias.length > 0 && (
        <div className="buscador-dropdown">
          {sugerencias.map((c) => (
            <div
              key={c.id}
              className="buscador-opcion"
              onMouseDown={() => {
                onElegir(c);
                setAbierto(false);
              }}
            >
              <strong>{c.razon_social || 'Sin razón social'}</strong> <span className="texto-suave">({c.cuit})</span>
              {c.contacto && <div className="texto-suave">{c.contacto}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
