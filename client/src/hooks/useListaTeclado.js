import { useEffect, useRef, useState } from 'react';

/**
 * Teclado para la lista desplegable de un buscador con autocompletado.
 *
 * - Flecha abajo / arriba: marca la opción siguiente / anterior (con la lista cerrada, la abre).
 * - Enter o Tab: aceptan la opción marcada. El Enter además pasa al campo siguiente (enterComoTab.js).
 * - Escape: cierra la lista.
 *
 * `sugerirPrimera` es el autocompletado: mientras se escribe, la primera opción queda marcada y
 * Enter/Tab la aceptan sin tocar las flechas. Se usa cuando el campo obliga a elegir de la lista; en un
 * campo de texto libre (ej. razón social) va en false, para no pisar lo escrito con un cliente que no es.
 *
 * Uso: `onKeyDown` en el input, `reiniciar()` al escribir, `propsLista` en el contenedor de opciones y
 * `propsOpcion(i)` en cada opción.
 */
export function useListaTeclado({ cantidad, abierto, setAbierto, elegirEn, sugerirPrimera }) {
  const [marcada, setMarcada] = useState(-1);
  const listaRef = useRef(null);

  const hayLista = abierto && cantidad > 0;
  const activa = !hayLista ? -1 : marcada >= 0 && marcada < cantidad ? marcada : sugerirPrimera ? 0 : -1;

  // La opción marcada tiene que quedar a la vista aunque la lista tenga scroll.
  useEffect(() => {
    const lista = listaRef.current;
    const opcion = lista && activa >= 0 ? lista.children[activa] : null;
    if (!opcion) return;
    if (opcion.offsetTop < lista.scrollTop) lista.scrollTop = opcion.offsetTop;
    else if (opcion.offsetTop + opcion.offsetHeight > lista.scrollTop + lista.clientHeight) {
      lista.scrollTop = opcion.offsetTop + opcion.offsetHeight - lista.clientHeight;
    }
  }, [activa]);

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (cantidad === 0) return;
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      setMarcada(activa < 0 ? (paso > 0 ? 0 : cantidad - 1) : (activa + paso + cantidad) % cantidad);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (activa >= 0) elegirEn(activa);
      setMarcada(-1);
      setAbierto(false); // para que la lista no quede tapando el campo siguiente
    } else if (e.key === 'Escape' && abierto) {
      e.stopPropagation(); // cierra la lista, no la ventana que la contiene
      setAbierto(false);
    }
  }

  return {
    onKeyDown,
    reiniciar: () => setMarcada(-1),
    propsLista: { ref: listaRef, role: 'listbox' },
    propsOpcion: (i) => ({
      role: 'option',
      'aria-selected': i === activa,
      'data-activa': i === activa ? '' : undefined,
      onMouseMove: () => i !== activa && setMarcada(i),
    }),
  };
}
