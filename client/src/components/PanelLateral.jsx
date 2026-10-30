import { useEffect, useRef } from 'react';
import { Icono } from './Icono';

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Panel que se desliza desde la derecha (para ver y editar algo sin perder de vista la lista de atrás).
 * Escape, la X o un clic en lo oscuro lo cierran. Mientras está abierto la página de atrás no se desplaza, el
 * foco se queda adentro, y al cerrarlo vuelve a lo que lo abrió.
 *
 * Props: titulo (el nombre del panel para los lectores de pantalla), cabecera (lo que va a la izquierda del
 * encabezado), children (el cuerpo, con scroll), pie (opcional), ancho (px, opcional), onSubmit (opcional: el panel
 * entero es un formulario, así Enter en el último campo lleva al botón del pie), onClose. Las preguntas (DialogoConfirmar) pueden abrirse adentro: ellas atienden primero su Escape y su Tab.
 */
export function PanelLateral({ titulo, cabecera, children, pie, ancho, onSubmit, onClose }) {
  const panelRef = useRef(null);
  const alCerrarRef = useRef(onClose);
  useEffect(() => {
    alCerrarRef.current = onClose;
  });

  useEffect(() => {
    const anterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Si algo de adentro ya pidió el foco (un campo con autoFocus) se respeta
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') alCerrarRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflowAnterior;
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, []);

  function onKeyDownPanel(e) {
    if (e.key !== 'Tab' || e.target.closest('.dialogo')) return;
    const items = [...panelRef.current.querySelectorAll(ENFOCABLES)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) return;
    const primero = items[0];
    const ultimo = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === panelRef.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  const Raiz = onSubmit ? 'form' : 'aside';

  return (
    <div className="panel-velo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Raiz className="panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} style={ancho ? { width: `min(${ancho}px, 100vw)` } : undefined} onKeyDown={onKeyDownPanel} {...(onSubmit ? { onSubmit, noValidate: true } : {})}>
        <div className="panel-cab">
          <div style={{ minWidth: 0 }}>{cabecera}</div>
          <button type="button" className="boton boton--icono boton--suave" onClick={onClose} aria-label="Cerrar">
            <Icono nombre="x" />
          </button>
        </div>
        <div className="panel-cuerpo">{children}</div>
        {pie && <div className="panel-pie">{pie}</div>}
      </Raiz>
    </div>
  );
}
