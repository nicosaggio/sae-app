import { Icono } from './Icono';

const SELLOS = {
  pendiente: { clase: 'sello--pendiente', icono: 'clock', texto: 'Pendiente de confirmación', corto: 'Pendiente' },
  confirmada: { clase: 'sello--confirmado', icono: 'check', texto: 'Confirmado', corto: 'Confirmado' },
  rechazada: { clase: 'sello--rechazado', icono: 'x', texto: 'Rechazado', corto: 'Rechazado' },
};

/**
 * El estado de confirmación de un presupuesto (pendiente, confirmado o rechazado). Se lee por el texto y el
 * ícono, no sólo por el color. `corto` usa la palabra sola ("Pendiente") para las listas.
 */
export function Sello({ estado, corto = false }) {
  const sello = SELLOS[estado];
  if (!sello) return null;
  return (
    <span className={`sello ${sello.clase}`}>
      <Icono nombre={sello.icono} />
      {corto ? sello.corto : sello.texto}
    </span>
  );
}
