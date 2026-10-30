import { useEffect, useId, useRef, useState } from 'react';
import { Icono } from './Icono';

/**
 * Botón "⋯" con un menú de acciones. Cada acción: { texto, icono, onSelect, peligro, separadorAntes }.
 * Con el teclado: flechas para moverse, Enter para elegir, Escape para cerrar (y el foco vuelve al botón).
 */
export function MenuMas({ acciones, etiqueta = 'Más acciones' }) {
  const [abierto, setAbierto] = useState(false);
  const raizRef = useRef(null);
  const botonRef = useRef(null);
  const idMenu = useId();

  useEffect(() => {
    if (!abierto) return undefined;
    function onMouseDown(e) {
      if (raizRef.current && !raizRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [abierto]);

  // Al abrir, el foco pasa a la primera acción
  useEffect(() => {
    if (abierto) raizRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [abierto]);

  function cerrar(devolverFoco) {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...raizRef.current.querySelectorAll('[role="menuitem"]')];
    const actual = items.indexOf(document.activeElement);
    const siguiente = e.key === 'ArrowDown' ? (actual + 1) % items.length : (actual - 1 + items.length) % items.length;
    items[siguiente]?.focus();
  }

  if (acciones.length === 0) return null;

  return (
    <div className="menu-mas" ref={raizRef} onKeyDown={onKeyDown}>
      <button
        ref={botonRef}
        type="button"
        className="boton boton--icono"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => setAbierto((v) => !v)}
      >
        <Icono nombre="more" />
      </button>
      {abierto && (
        <div className="menu-flotante" role="menu" id={idMenu}>
          {acciones.map((a) => (
            <div key={a.texto}>
              {a.separadorAntes && <hr />}
              <button
                type="button"
                role="menuitem"
                className={a.peligro ? 'peligro' : ''}
                onClick={() => {
                  cerrar(false);
                  a.onSelect();
                }}
              >
                <Icono nombre={a.icono} />
                {a.texto}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
