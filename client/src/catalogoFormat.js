/** Formato argentino del catálogo: miles con "." y decimales con ",". El catálogo muestra dos decimales (a diferencia de format.js). */
export function formatearImporte(valor, conDecimales = true) {
  const n = Math.abs(valor);
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const texto = conDecimales ? `${miles},${String(centavos).padStart(2, '0')}` : miles;
  return valor < 0 ? `-${texto}` : texto;
}

/** "$ 40.200,00", o "—" si no hay valor. */
export function pesos(valor, conDecimales = true) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return `$ ${formatearImporte(valor, conDecimales)}`;
}

/** 0.55 → "55" (el porcentaje se escribe y se muestra en %, pero viaja como fracción). */
export function fraccionATexto(fraccion) {
  if (fraccion === null || fraccion === undefined) return '';
  return String(Math.round(fraccion * 10000) / 100).replace('.', ',');
}

/** "55" o "55,5" → 0.55. Vacío → null. Si no es un número devuelve NaN. */
export function textoAFraccion(texto) {
  if (texto === null || texto === undefined || String(texto).trim() === '') return null;
  const n = Number(String(texto).trim().replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 10000 : NaN;
}

/** 0.4 → "40 %" */
export function porcentaje(fraccion) {
  if (fraccion === null || fraccion === undefined) return '—';
  return `${fraccionATexto(fraccion)} %`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-09-15" → "15 de septiembre de 2026" */
export function fechaLarga(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : '—';
}

/** "2026-09-15 13:42:41" → "15/09/2026" */
export function fechaCorta(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export const ETIQUETA_TIPO_REGLA = {
  base: 'Base (precio de la base parche)',
  derivado: 'Derivado (depende de otro ítem)',
  manual: 'Precio fijo',
  proporcional: 'Proporcional al SAE de otro ítem',
  razon: 'Razón (A × B / C)',
  sin_precio: 'Sin precio',
};

export const urlImagen = (archivo) => (archivo ? `/api/catalogo/imagenes/${archivo}` : null);
