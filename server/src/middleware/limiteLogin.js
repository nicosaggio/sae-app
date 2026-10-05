/**
 * Límite de intentos fallidos de login por IP, para que nadie pueda probar claves a lo loco cuando
 * la app se usa desde Internet. Está en memoria: se reinicia con el servidor, que alcanza para frenar
 * un ataque de fuerza bruta. Un login correcto borra los fallos de esa IP.
 */
const VENTANA_MS = 15 * 60 * 1000;
const MAX_FALLOS = 10;

const fallos = new Map(); // ip -> { cuenta, desde }

function vigente(ip, ahora) {
  const registro = fallos.get(ip);
  if (!registro) return null;
  if (ahora - registro.desde >= VENTANA_MS) {
    fallos.delete(ip);
    return null;
  }
  return registro;
}

/** Segundos que faltan para poder volver a intentar, o 0 si esa IP no está bloqueada. */
function segundosDeEspera(ip, ahora = Date.now()) {
  const registro = vigente(ip, ahora);
  if (!registro || registro.cuenta < MAX_FALLOS) return 0;
  return Math.ceil((registro.desde + VENTANA_MS - ahora) / 1000);
}

function registrarFallo(ip, ahora = Date.now()) {
  const registro = vigente(ip, ahora);
  if (registro) registro.cuenta += 1;
  else fallos.set(ip, { cuenta: 1, desde: ahora });
}

function limpiar(ip) {
  fallos.delete(ip);
}

/** Sólo para los tests. */
function reiniciarTodo() {
  fallos.clear();
}

module.exports = { segundosDeEspera, registrarFallo, limpiar, reiniciarTodo, MAX_FALLOS, VENTANA_MS };
