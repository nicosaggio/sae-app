import { Icono } from './Icono';

const SELLOS = {
  pendiente: { clase: 'sello--pendiente', icono: 'clock', texto: 'Pendiente de confirmación' },
  confirmada: { clase: 'sello--confirmado', icono: 'check', texto: 'Confirmado' },
  rechazada: { clase: 'sello--rechazado', icono: 'x', texto: 'Rechazado' },
};

/** El estado de confirmación de un presupuesto (pendiente, confirmado o rechazado). Se lee por el texto y el ícono, no sólo por el color. */
export function Sello({ estado }) {
  const sello = SELLOS[estado];
  if (!sello) return null;
  return (
    <span className={`sello ${sello.clase}`}>
      <Icono nombre={sello.icono} />
      {sello.texto}
    </span>
  );
}
