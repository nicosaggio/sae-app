const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { DB_DIR } = require('../db/connection');

// Fuera de la base y del backup automático (que sólo copia el .db): hay que respaldarla aparte.
const CARPETA_IMAGENES = process.env.CATALOGO_IMG_DIR || path.join(DB_DIR, 'catalogo-img');
const ANCHO_MAXIMO = 800;
const CALIDAD_JPEG = 80;
const NOMBRE_VALIDO = /^[a-f0-9]{40}\.(jpg|png)$/;

function hashDe(bytes) {
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

/**
 * Guarda una imagen del catálogo en `carpeta`, con nombre {sha1 del original}.{jpg|png}: dos
 * ítems con la misma foto comparten archivo y volver a correr la siembra no repite el trabajo.
 *  - Fotos: JPEG de ancho máximo 800 px (se imprimen a ~1,7" de ancho: sobra resolución y el PDF pesa ~5 MB), aplanadas sobre blanco (un GIF/PNG con transparencia
 *    quedaría negro en JPEG). Un GIF animado se queda con el primer cuadro.
 *  - Logo (`conservarPng`): se guarda tal cual, en PNG, para no perder la transparencia.
 * @returns {Promise<{archivo: string, reutilizada: boolean, bytesOriginal: number, bytesFinal: number}>}
 */
async function guardarImagen(bytes, { conservarPng = false, carpeta = CARPETA_IMAGENES } = {}) {
  fs.mkdirSync(carpeta, { recursive: true });
  const hash = hashDe(bytes);
  const archivo = `${hash}.${conservarPng ? 'png' : 'jpg'}`;
  const destino = path.join(carpeta, archivo);

  if (fs.existsSync(destino)) {
    return { archivo, reutilizada: true, bytesOriginal: bytes.length, bytesFinal: fs.statSync(destino).size };
  }

  let salida = bytes;
  if (!conservarPng) {
    const original = await Jimp.read(Buffer.from(bytes));
    const fondo = new Jimp({ width: original.width, height: original.height, color: 0xffffffff });
    fondo.composite(original, 0, 0);
    if (fondo.width > ANCHO_MAXIMO) fondo.resize({ w: ANCHO_MAXIMO });
    salida = await fondo.getBuffer(JimpMime.jpeg, { quality: CALIDAD_JPEG });
  }
  fs.writeFileSync(destino, salida);
  return { archivo, reutilizada: false, bytesOriginal: bytes.length, bytesFinal: salida.length };
}

/** Ruta absoluta de una imagen guardada, o null si el nombre no tiene la forma esperada (evita salir de la carpeta). */
function rutaDeImagen(archivo, carpeta = CARPETA_IMAGENES) {
  return NOMBRE_VALIDO.test(String(archivo)) ? path.join(carpeta, archivo) : null;
}

module.exports = { guardarImagen, rutaDeImagen, CARPETA_IMAGENES, ANCHO_MAXIMO };
