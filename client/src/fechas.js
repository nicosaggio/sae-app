// Fechas como texto ISO "aaaa-mm-dd", sin horas ni zonas: se suman y restan días con Date.UTC para que el cambio
// de horario (o estar en otra zona) nunca corra un día.

/** El día de hoy en la hora de esta PC (no en UTC: pasadas las 21 h en Argentina, UTC ya es mañana). */
export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const aUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Es una fecha ISO completa (un campo de fecha a medio escribir devuelve ''). */
export const esFechaIso = (texto) => /^\d{4}-\d{2}-\d{2}$/.test(texto || '');

/** Cuántos días hay de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde, hasta) {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86400000);
}

/** La fecha `n` días después de `iso` (o antes, si n es negativo). */
export function sumarDias(iso, n) {
  return new Date(aUtc(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Dónde está un evento respecto de hoy, para decirlo con palabras: "Empieza en 12 días", "En curso", "Terminó hace 3 días". */
export function cuandoEs(inicio, fin, hoy = hoyIso()) {
  if (!esFechaIso(inicio) || !esFechaIso(fin)) return '';
  const faltan = diasEntre(hoy, inicio);
  if (faltan > 0) return faltan === 1 ? 'Empieza mañana' : `Empieza en ${faltan} días`;
  const desdeFin = diasEntre(fin, hoy);
  if (desdeFin <= 0) return 'En curso';
  return desdeFin === 1 ? 'Terminó ayer' : `Terminó hace ${desdeFin} días`;
}
