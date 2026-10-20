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

const formatoUnidades = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** Una cantidad de unidades (hasta 2 decimales, porque hay productos que se piden por metro): 1300.5 → "1.300,5". */
export function formatearUnidades(valor) {
  return formatoUnidades.format(valor);
}

/** Qué parte del total es `parte`: "34,8 %". Devuelve '—' si el total no es positivo. */
export function porcentajeDe(parte, total) {
  return total > 0 ? `${((parte / total) * 100).toFixed(1).replace('.', ',')} %` : '—';
}
