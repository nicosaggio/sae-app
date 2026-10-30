import { diasEntre, esFechaIso, hoyIso, sumarDias } from '../fechas';
import { fechaCorta } from '../catalogoFormat';

const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * La regla de fases de un evento: una barra con un tramo por cada fase (armado rayado, evento sólido, desarme
 * punteado) y la marca de "Hoy", sobre una regla con un número por día. Se arma sólo con las fechas del evento.
 * Si el evento está cerca de hoy (o terminó hace poco) la regla se estira para que "Hoy" entre y se vea cuánto
 * falta. `mini` es la versión baja, sin regla ni etiqueta, para usar dentro de una tarjeta.
 *
 * Con fechas incompletas (un campo a medio escribir) o un fin anterior al inicio no dibuja nada.
 */
export function ReglaFases({ armado, inicio, fin, desarme, hoy = hoyIso(), mini = false }) {
  if (!esFechaIso(inicio) || !esFechaIso(fin) || fin < inicio) return null;
  const armadoOk = esFechaIso(armado) && armado < inicio ? armado : null;
  const desarmeOk = esFechaIso(desarme) && desarme > fin ? desarme : null;
  const desarmeElUltimoDia = esFechaIso(desarme) && desarme === fin;

  const primero = armadoOk || inicio;
  const ultimo = desarmeOk || fin;
  let a = sumarDias(primero, mini ? -1 : -2);
  let b = sumarDias(ultimo, mini ? 2 : 3);
  const cerca = mini ? 14 : 21;
  if (hoy < a && diasEntre(hoy, a) <= cerca) a = hoy;
  else if (hoy > b && diasEntre(b, hoy) <= cerca) b = hoy;

  const total = diasEntre(a, b) + 1;
  const pos = (iso) => (diasEntre(a, iso) / total) * 100;
  const ancho = (desde, hasta) => ((diasEntre(desde, hasta) + 1) / total) * 100;
  const enRango = hoy >= a && hoy <= b;

  // Una marca y un número por cada día (como una regla de taller); con rangos largos, uno cada tantos
  const paso = Math.max(1, Math.ceil(total / 26));
  const rotulos = [];
  for (let i = 0; i < total; i += paso) {
    const dia = sumarDias(a, i);
    const n = Number(dia.slice(8, 10));
    const texto = i === 0 || n === 1 ? `${n} ${MES3[Number(dia.slice(5, 7)) - 1]}` : String(n);
    rotulos.push(
      <span key={dia} className={dia === hoy ? 'es-hoy' : undefined} style={{ left: `${((i + 0.5) / total) * 100}%` }}>
        {texto}
      </span>
    );
  }

  const descripcion =
    `${armadoOk ? `Armado desde ${fechaCorta(armadoOk)}. ` : ''}Evento del ${fechaCorta(inicio)} al ${fechaCorta(fin)}.` +
    `${desarmeOk ? ` Desarme hasta ${fechaCorta(desarmeOk)}.` : ''}${enRango ? ` Hoy: ${fechaCorta(hoy)}.` : ''}`;

  return (
    <div className={`fases${mini ? ' fases--mini' : ''}`} role="img" aria-label={descripcion}>
      <div className="fases-pista">
        {armadoOk && <span className="fase fase--armado" style={{ left: `${pos(armadoOk)}%`, width: `${ancho(armadoOk, sumarDias(inicio, -1))}%` }} />}
        <span className={`fase fase--evento${desarmeElUltimoDia && !mini ? ' con-desarme' : ''}`} style={{ left: `${pos(inicio)}%`, width: `${ancho(inicio, fin)}%` }} />
        {desarmeOk && <span className="fase fase--desarme" style={{ left: `${pos(sumarDias(fin, 1))}%`, width: `${ancho(sumarDias(fin, 1), desarmeOk)}%` }} />}
        {enRango && <span className="fases-hoy" style={{ left: `calc(${pos(hoy) + 100 / total / 2}% - 1px)` }} data-etiqueta="Hoy" />}
      </div>
      {!mini && (
        <div className="fases-regla" style={{ '--paso': `${100 / total}%` }}>
          {rotulos}
        </div>
      )}
    </div>
  );
}
