import { diasEntre, sumarDias } from './fechas';

/**
 * Las semanas (de lunes a domingo) que hay que dibujar para un mes: cada una es una lista de 7 fechas ISO, e
 * incluye los días de los meses vecinos que completan la primera y la última semana.
 */
export function semanasDelMes(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes, 1));
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0));
  const desfaseInicio = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const desfaseFin = 6 - ((ultimo.getUTCDay() + 6) % 7);
  const inicio = sumarDias(primero.toISOString().slice(0, 10), -desfaseInicio);
  const total = desfaseInicio + ultimo.getUTCDate() + desfaseFin;
  const semanas = [];
  for (let i = 0; i < total; i += 7) semanas.push(Array.from({ length: 7 }, (_, d) => sumarDias(inicio, i + d)));
  return semanas;
}

/** Cada evento se parte en tramos: el armado (antes de empezar), el evento y el desarme (después de terminar). */
export function tramosDe(evento) {
  const tramos = [];
  if (evento.fecha_armado && evento.fecha_armado < evento.fecha_inicio) tramos.push({ tipo: 'armado', desde: evento.fecha_armado, hasta: sumarDias(evento.fecha_inicio, -1), evento });
  tramos.push({ tipo: 'evento', desde: evento.fecha_inicio, hasta: evento.fecha_fin, evento });
  if (evento.fecha_desarme && evento.fecha_desarme > evento.fecha_fin) tramos.push({ tipo: 'desarme', desde: sumarDias(evento.fecha_fin, 1), hasta: evento.fecha_desarme, evento });
  return tramos;
}

/**
 * Las barras de una semana: los tramos que la tocan, recortados a sus bordes (con `cortaIzq` / `cortaDer` si siguen
 * de otra semana), cada uno con su columna inicial y final (0 a 6) y el carril (la fila de barras) donde cae, de modo
 * que dos tramos que se pisan en algún día no queden en el mismo carril.
 */
export function barrasDeSemana(semana, tramos) {
  const primero = semana[0];
  const ultimo = semana[6];
  const visibles = tramos
    .filter((t) => t.desde <= ultimo && t.hasta >= primero)
    .map((t) => ({
      ...t,
      col1: Math.max(0, diasEntre(primero, t.desde)),
      col2: Math.min(6, diasEntre(primero, t.hasta)),
      cortaIzq: t.desde < primero,
      cortaDer: t.hasta > ultimo,
    }))
    .sort((a, b) => a.col1 - b.col1 || b.col2 - b.col1 - (a.col2 - a.col1) || (a.tipo === 'evento' ? -1 : 1) - (b.tipo === 'evento' ? -1 : 1));
  const finDeCarril = [];
  for (const barra of visibles) {
    let carril = 0;
    while (finDeCarril[carril] !== undefined && finDeCarril[carril] >= barra.col1) carril++;
    finDeCarril[carril] = barra.col2;
    barra.carril = carril;
  }
  return { barras: visibles, carriles: finDeCarril.length };
}
