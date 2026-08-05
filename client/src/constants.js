export const ESTADOS_PRESUPUESTO = [
  { value: 'pendiente_facturar', label: 'Pendiente de facturar' },
  { value: 'facturado', label: 'Facturado' },
  { value: 'pendiente_pago', label: 'Pendiente de pago' },
  { value: 'cobrado', label: 'Cobrado' },
];

export function etiquetaEstadoPresupuesto(estado) {
  return ESTADOS_PRESUPUESTO.find((e) => e.value === estado)?.label || estado;
}
