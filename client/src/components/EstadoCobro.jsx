import { etiquetaEstadoPresupuesto } from '../constants';

const CLASES = {
  pendiente_facturar: '',
  facturado: 'cobro--facturado',
  pendiente_pago: 'cobro--pago',
  cobrado: 'cobro--cobrado',
  cancelado: 'cobro--cancelado',
};

/** El estado de cobro de un presupuesto confirmado: un punto que se va llenando (vacío, azul, mitad, lleno) y el texto. */
export function EstadoCobro({ estado }) {
  return <span className={`cobro ${CLASES[estado] ?? ''}`.trim()}>{etiquetaEstadoPresupuesto(estado)}</span>;
}
