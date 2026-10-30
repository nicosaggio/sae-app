import { useEffect, useId, useRef } from 'react';

/**
 * Pregunta antes de una acción que no se deshace del todo (reemplaza al `confirm()` del navegador): dice qué
 * pasa y qué se conserva. Escape o un clic afuera cancelan; el foco arranca en "Cancelar" si la acción es
 * destructiva, para que un Enter apurado no borre nada, y vuelve adonde estaba al cerrar.
 *
 * Props: titulo, children (el texto), textoConfirmar, textoCancelar, peligro, onConfirmar, onCancelar.
 */
export function DialogoConfirmar({ titulo, children, textoConfirmar, textoCancelar = 'Cancelar', peligro = false, onConfirmar, onCancelar }) {
  const idTitulo = useId();
  const cancelarRef = useRef(null);
  const confirmarRef = useRef(null);
  // El efecto de abajo no se repite aunque el padre pase una función nueva en cada render (volvería a mover el foco)
  const alCancelarRef = useRef(onCancelar);
  useEffect(() => {
    alCancelarRef.current = onCancelar;
  });

  useEffect(() => {
    const anterior = document.activeElement;
    (peligro ? cancelarRef : confirmarRef).current?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        alCancelarRef.current();
      }
      // El foco se queda adentro mientras el diálogo está abierto
      if (e.key === 'Tab') {
        const botones = [cancelarRef.current, confirmarRef.current];
        const posicion = botones.indexOf(document.activeElement);
        if (e.shiftKey && posicion <= 0) {
          e.preventDefault();
          botones[1].focus();
        } else if (!e.shiftKey && posicion === 1) {
          e.preventDefault();
          botones[0].focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [peligro]);

  return (
    <div className="dialogo-velo" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <div className="dialogo" role="alertdialog" aria-modal="true" aria-labelledby={idTitulo}>
        <div className="dialogo-cab">
          <h2 id={idTitulo}>{titulo}</h2>
        </div>
        <div className="dialogo-cuerpo">{children}</div>
        <div className="dialogo-pie">
          <button type="button" className="boton" ref={cancelarRef} onClick={onCancelar}>
            {textoCancelar}
          </button>
          <button type="button" className={`boton ${peligro ? 'boton--peligro' : 'boton--primario'}`} ref={confirmarRef} onClick={onConfirmar}>
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
