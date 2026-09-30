/**
 * Adjuntos de un presupuesto (croquis, planos): imágenes JPG/PNG y PDF. Se guardan como archivos en
 * una carpeta aparte, con nombre aleatorio, y salen como anexos al final del PDF del presupuesto.
 *
 * El tipo se decide por el CONTENIDO del archivo, no por su extensión ni por lo que diga el navegador.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { PDFDocument } = require('pdf-lib');
const { db, DB_DIR } = require('../db/connection');
const { errorHttp } = require('./catalogoCalculoService');

// Fuera de la base y del backup automático (que sólo copia el .db): hay que respaldarla aparte.
const CARPETA_ADJUNTOS = path.resolve(process.env.COTIZACIONES_ADJ_DIR || path.join(DB_DIR, 'cotizaciones-adjuntos'));
const TAMANO_MAXIMO = 25 * 1024 * 1024;
const MAXIMO_POR_PRESUPUESTO = 10;
const MAXIMO_PAGINAS_PDF = 50;
const LADO_MAXIMO = 2400; // px: alcanza para que un plano se lea impreso en A4 y el PDF no pese de más
const CALIDAD_JPEG = 85;
const NOMBRE_VALIDO = /^[a-f0-9-]{36}\.(jpg|png|pdf)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

/** 'jpg' | 'png' | 'pdf' según los primeros bytes, o null si no es ninguno. */
function detectarFormato(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';
  return null;
}

/** Baja la imagen a LADO_MAXIMO si es más grande y la vuelve a guardar (esto también aplica la orientación de las fotos de celular). */
async function procesarImagen(bytes, formato) {
  let imagen;
  try {
    imagen = await Jimp.read(bytes);
  } catch {
    throw errorHttp(400, 'La imagen está dañada o no se puede leer');
  }
  if (Math.max(imagen.width, imagen.height) > LADO_MAXIMO) {
    if (imagen.width >= imagen.height) imagen.resize({ w: LADO_MAXIMO });
    else imagen.resize({ h: LADO_MAXIMO });
  }
  const salida = formato === 'png' ? await imagen.getBuffer(JimpMime.png) : await imagen.getBuffer(JimpMime.jpeg, { quality: CALIDAD_JPEG });
  return { bytes: Buffer.from(salida), paginas: 1 };
}

async function procesarPdf(bytes) {
  let paginas;
  try {
    // Un PDF trucho o cortado puede cargar "bien" y recién fallar al contar las páginas: van juntos.
    paginas = (await PDFDocument.load(bytes)).getPageCount();
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) throw errorHttp(400, 'El PDF tiene contraseña o está protegido: sacale la protección y volvé a subirlo');
    throw errorHttp(400, 'El PDF está dañado o no se puede leer');
  }
  if (paginas < 1) throw errorHttp(400, 'El PDF no tiene páginas');
  if (paginas > MAXIMO_PAGINAS_PDF) throw errorHttp(400, `El PDF tiene ${paginas} páginas: el máximo es ${MAXIMO_PAGINAS_PDF}`);
  return { bytes, paginas };
}

/** Nombre del archivo tal como lo mandó el usuario, sin carpetas ni caracteres de control. */
function nombreLimpio(nombre) {
  const sinControl = Array.from(String(nombre || '').split(String.fromCharCode(92)).join('/'))
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('');
  const base = path.basename(sinControl).trim();
  return (base || 'archivo').slice(0, 120);
}

function textoOpcional(valor, maximo) {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  if (limpio.length > maximo) throw errorHttp(400, `El título es demasiado largo (máximo ${maximo} caracteres)`);
  return limpio === '' ? null : limpio;
}

const aPublico = (f) => ({
  id: f.id,
  titulo: f.titulo,
  nombre_original: f.nombre_original,
  tipo: f.tipo,
  tamano: f.tamano,
  paginas: f.paginas,
  incluir_en_pdf: Boolean(f.incluir_en_pdf),
  creado_en: f.creado_en,
});

function listar(cotizacionId) {
  return db.prepare('SELECT * FROM cotizacion_adjuntos WHERE cotizacion_id = ? ORDER BY id').all(cotizacionId).map(aPublico);
}

/** Los que salen en el PDF, con la ruta del archivo (uso interno del armado del PDF). */
function paraElPdf(cotizacionId) {
  return db
    .prepare('SELECT * FROM cotizacion_adjuntos WHERE cotizacion_id = ? AND incluir_en_pdf = 1 ORDER BY id')
    .all(cotizacionId)
    .map((f) => ({ ...aPublico(f), ruta: rutaSegura(f.archivo) }));
}

function rutaSegura(archivo) {
  return NOMBRE_VALIDO.test(String(archivo)) ? path.join(CARPETA_ADJUNTOS, archivo) : null;
}

/** Cuántas páginas suman estos adjuntos en el PDF (una imagen ocupa una página). */
function paginasQueOcupan(adjuntos) {
  return adjuntos.reduce((suma, a) => suma + (a.tipo === 'imagen' ? 1 : a.paginas), 0);
}

async function agregar(cotizacionId, { bytes, nombre, titulo }, usuario) {
  if (!db.prepare('SELECT 1 FROM cotizaciones WHERE id = ?').get(cotizacionId)) throw errorHttp(404, 'Presupuesto no encontrado');
  if (!bytes || bytes.length === 0) throw errorHttp(400, 'El archivo está vacío');
  if (bytes.length > TAMANO_MAXIMO) throw errorHttp(400, `El archivo pesa más de ${TAMANO_MAXIMO / 1024 / 1024} MB`);
  const cantidad = db.prepare('SELECT COUNT(*) AS n FROM cotizacion_adjuntos WHERE cotizacion_id = ?').get(cotizacionId).n;
  if (cantidad >= MAXIMO_POR_PRESUPUESTO) throw errorHttp(400, `Un presupuesto admite hasta ${MAXIMO_POR_PRESUPUESTO} adjuntos`);

  const formato = detectarFormato(bytes);
  if (!formato) throw errorHttp(400, 'Solo se pueden adjuntar imágenes JPG o PNG y archivos PDF');
  const tituloFinal = textoOpcional(titulo, 120);
  const procesado = formato === 'pdf' ? await procesarPdf(bytes) : await procesarImagen(bytes, formato);

  fs.mkdirSync(CARPETA_ADJUNTOS, { recursive: true });
  const archivo = `${crypto.randomUUID()}.${formato}`;
  fs.writeFileSync(path.join(CARPETA_ADJUNTOS, archivo), procesado.bytes);
  try {
    db.prepare(
      `INSERT INTO cotizacion_adjuntos (cotizacion_id, titulo, nombre_original, archivo, tipo, tamano, paginas, subido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cotizacionId, tituloFinal, nombreLimpio(nombre), archivo, formato === 'pdf' ? 'pdf' : 'imagen', procesado.bytes.length, procesado.paginas, usuario ? usuario.id : null);
  } catch (err) {
    fs.rmSync(path.join(CARPETA_ADJUNTOS, archivo), { force: true });
    throw err;
  }
}

function leerFila(adjuntoId) {
  const fila = db.prepare('SELECT * FROM cotizacion_adjuntos WHERE id = ?').get(adjuntoId);
  if (!fila) throw errorHttp(404, 'Adjunto no encontrado');
  return fila;
}

/** Cambia el título o si sale en el PDF. Devuelve el id del presupuesto. */
function actualizar(adjuntoId, { titulo, incluir_en_pdf } = {}) {
  const fila = leerFila(adjuntoId);
  const nuevoTitulo = titulo === undefined ? fila.titulo : textoOpcional(titulo, 120);
  const incluir = incluir_en_pdf === undefined ? fila.incluir_en_pdf : incluir_en_pdf ? 1 : 0;
  db.prepare('UPDATE cotizacion_adjuntos SET titulo = ?, incluir_en_pdf = ? WHERE id = ?').run(nuevoTitulo, incluir, adjuntoId);
  return fila.cotizacion_id;
}

/** Borra el registro y el archivo. Devuelve el id del presupuesto. */
function quitar(adjuntoId) {
  const fila = leerFila(adjuntoId);
  db.prepare('DELETE FROM cotizacion_adjuntos WHERE id = ?').run(adjuntoId);
  const ruta = rutaSegura(fila.archivo);
  if (ruta) fs.rmSync(ruta, { force: true });
  return fila.cotizacion_id;
}

/** Para servir el archivo: ruta en disco, tipo de contenido y nombre. */
function archivoDe(adjuntoId) {
  const fila = leerFila(adjuntoId);
  const ruta = rutaSegura(fila.archivo);
  if (!ruta || !fs.existsSync(ruta)) throw errorHttp(404, 'El archivo ya no está en el servidor');
  return { ruta, mime: MIME[path.extname(fila.archivo).slice(1)], nombre: fila.nombre_original };
}

/** Borra del disco los archivos de un presupuesto (se llama antes de borrar el presupuesto). */
function borrarArchivosDe(cotizacionId) {
  for (const fila of db.prepare('SELECT archivo FROM cotizacion_adjuntos WHERE cotizacion_id = ?').all(cotizacionId)) {
    const ruta = rutaSegura(fila.archivo);
    if (ruta) fs.rmSync(ruta, { force: true });
  }
}

/** Copia los adjuntos (registro y archivo) de un presupuesto a otro. */
function copiar(origenId, destinoId, usuario) {
  const insertar = db.prepare(
    `INSERT INTO cotizacion_adjuntos (cotizacion_id, titulo, nombre_original, archivo, tipo, tamano, paginas, incluir_en_pdf, subido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of db.prepare('SELECT * FROM cotizacion_adjuntos WHERE cotizacion_id = ? ORDER BY id').all(origenId)) {
    const ruta = rutaSegura(f.archivo);
    if (!ruta || !fs.existsSync(ruta)) continue;
    const nuevo = `${crypto.randomUUID()}${path.extname(f.archivo)}`;
    fs.copyFileSync(ruta, path.join(CARPETA_ADJUNTOS, nuevo));
    insertar.run(destinoId, f.titulo, f.nombre_original, nuevo, f.tipo, f.tamano, f.paginas, f.incluir_en_pdf, usuario ? usuario.id : null);
  }
}

module.exports = {
  CARPETA_ADJUNTOS,
  TAMANO_MAXIMO,
  MAXIMO_POR_PRESUPUESTO,
  detectarFormato,
  listar,
  paraElPdf,
  paginasQueOcupan,
  agregar,
  actualizar,
  quitar,
  archivoDe,
  borrarArchivosDe,
  copiar,
};
