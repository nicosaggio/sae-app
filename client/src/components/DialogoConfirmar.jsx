import { useEffect, useId, useRef } from 'react';

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Pregunta antes de una acción que no se deshace del todo (reemplaza al `confirm()` del navegador): dice qué
 * pasa y qué se conserva. También sirve de ventana con un formulario corto (`formulario`). Escape o un clic
 * afuera cancelan; el foco se queda adentro y vuelve adonde estaba al cerrar.
 *
 * El foco arranca en "Cancelar" si la acción es destructiva (para que un Enter apurado no borre nada), en el
 * botón de confirmar si no, y en el primer campo si se pide `foco="primero"`.
 *
 * Props: titulo, subtitulo (opcional), children (el cuerpo), textoConfirmar, textoCancelar, peligro, ancho (px),
 * foco ('cancelar' | 'confirmar' | 'primero'), confirmarDeshabilitado, formulario (el cuerpo es un <form>: Enter en
 * el último campo lleva al botón y un segundo Enter confirma), pieIzquierda (una acción aparte, a la izquierda del
 * pie: por ejemplo "Borrar"), soloCerrar (ventana de sólo lectura: un único botón para cerrar), onConfirmar, onCancelar.
 */
export function DialogoConfirmar({
  titulo,
  subtitulo,
  children,
  textoConfirmar,
  textoCancelar = 'Cancelar',
  peligro = false,
  ancho = 520,
  foco,
  confirmarDeshabilitado = false,
  formulario = false,
  pieIzquierda,
  soloCerrar = false,
  onConfirmar,
  onCancelar,
}) {
  const idTitulo = useId();
  const dialogoRef = useRef(null);
  const cancelarRef = useRef(null);
  const confirmarRef = useRef(null);
  // El efecto de abajo no se repite aunque el padre pase una función nueva en cada render (volvería a mover el foco)
  const alCancelarRef = useRef(onCancelar);
  useEffect(() => {
    alCancelarRef.current = onCancelar;
  });
  const focoInicial = soloCerrar ? 'cancelar' : foco || (peligro ? 'cancelar' : 'confirmar');

  useEffect(() => {
    const anterior = document.activeElement;
    const dialogo = dialogoRef.current;
    if (focoInicial === 'primero') {
      const primero = [...dialogo.querySelectorAll('.dialogo-cuerpo input, .dialogo-cuerpo select, .dialogo-cuerpo textarea')].find((el) => !el.disabled);
      (primero || confirmarRef.current)?.focus();
    } else {
      (focoInicial === 'cancelar' ? cancelarRef : confirmarRef).current?.focus();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        alCancelarRef.current();
        return;
      }
      // El foco se queda adentro mientras el diálogo está abierto
      if (e.key === 'Tab') {
        const items = [...dialogo.querySelectorAll(ENFOCABLES)].filter((el) => el.getClientRects().length > 0);
        if (items.length === 0) return;
        const posicion = items.indexOf(document.activeElement);
        if (e.shiftKey && posicion <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && posicion === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [focoInicial]);

  const Raiz = formulario ? 'form' : 'div';
  const propsRaiz = formulario
    ? {
        onSubmit: (e) => {
          e.preventDefault();
          if (!confirmarDeshabilitado) onConfirmar();
        },
        noValidate: true,
      }
    : {};

  return (
    <div className="dialogo-velo" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <Raiz className="dialogo" ref={dialogoRef} role={formulario ? 'dialog' : 'alertdialog'} aria-modal="true" aria-labelledby={idTitulo} style={{ width: `min(${ancho}px, 100%)` }} {...propsRaiz}>
        <div className="dialogo-cab">
          <h2 id={idTitulo}>{titulo}</h2>
          {subtitulo && <p className="sub">{subtitulo}</p>}
        </div>
        <div className="dialogo-cuerpo">{children}</div>
        <div className="dialogo-pie">
          {pieIzquierda && <div style={{ marginRight: 'auto' }}>{pieIzquierda}</div>}
          <button type="button" className={`boton${soloCerrar ? ' boton--primario' : ''}`} ref={cancelarRef} onClick={onCancelar}>
            {soloCerrar ? 'Cerrar' : textoCancelar}
          </button>
          {!soloCerrar && (
            <button
              type={formulario ? 'submit' : 'button'}
              className={`boton ${peligro ? 'boton--peligro' : 'boton--primario'}`}
              ref={confirmarRef}
              disabled={confirmarDeshabilitado}
              onClick={formulario ? undefined : onConfirmar}
            >
              {textoConfirmar}
            </button>
          )}
        </div>
      </Raiz>
    </div>
  );
}
