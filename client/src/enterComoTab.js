/**
 * Enter se comporta como Tab: pasa al siguiente campo en vez de enviar el formulario.
 *
 * Se instala una sola vez para toda la app. Reglas:
 * - Aplica a los <input> donde se escribe (texto, número, fecha, buscadores...) y a los desplegables
 *   (select). Los botones y los textarea (Enter = renglón nuevo) siguen con su comportamiento normal.
 * - Shift+Enter vuelve al campo anterior.
 * - En el último campo de un formulario, Enter deja el foco en su botón de enviar (no lo aprieta):
 *   hace falta un segundo Enter, a propósito, para guardar o crear.
 * - Un formulario con `data-enter-envia` conserva el envío con Enter en su último campo (el login).
 * - Si un campo maneja Enter por su cuenta y llama a preventDefault(), se respeta.
 */

const SIN_ENTER = new Set(['button', 'submit', 'reset', 'image', 'file']);

function esEnfocable(el) {
  if (el.disabled || el.tabIndex < 0) return false;
  if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Dentro de qué conjunto de campos se camina: el formulario del campo, o su ventana, o la página. */
function ambitoDe(el) {
  return el.closest('form') || el.closest('.modal-contenido') || el.closest('main') || document.body;
}

function botonDeEnviar(ambito) {
  if (ambito.tagName !== 'FORM') return null;
  return [...ambito.querySelectorAll('button:not([type]), button[type="submit"], input[type="submit"]')].find(esEnfocable) || null;
}

function enEnter(e) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const campo = e.target;
  const esInput = campo instanceof HTMLInputElement && !SIN_ENTER.has(campo.type);
  if (!esInput && !(campo instanceof HTMLSelectElement)) return;

  const ambito = ambitoDe(campo);
  const campos = [...ambito.querySelectorAll('input, select, textarea')].filter((c) => c === campo || esEnfocable(c));
  const siguiente = campos[campos.indexOf(campo) + (e.shiftKey ? -1 : 1)];
  // En el último campo de un formulario que envía con Enter (el login) se deja el comportamiento normal.
  if (!siguiente && !e.shiftKey && ambito.matches('form[data-enter-envia]')) return;

  e.preventDefault(); // sin esto el navegador envía el formulario
  if (e.repeat) return; // mantener Enter apretado no debe recorrer todos los campos

  const destino = siguiente || (e.shiftKey ? null : botonDeEnviar(ambito));
  if (!destino) return;

  destino.focus();
  if (destino instanceof HTMLInputElement && !destino.readOnly) {
    try {
      destino.select(); // como al llegar con Tab: queda seleccionado lo que había
    } catch {
      /* algunos tipos de input no admiten seleccionar */
    }
  }
}

let instalado = false;

export function instalarEnterComoTab() {
  if (instalado) return;
  instalado = true;
  document.addEventListener('keydown', enEnter);
}
