const formatoMonedaBase = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

/** Formatea un monto con el signo $ (formato es-AR). Devuelve '—' si no hay valor cargado. */
export function formatearMonto(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return formatoMonedaBase.format(valor);
}
