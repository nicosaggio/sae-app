const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const XLSX = require('xlsx');
const { db, transaction } = require('../db/connection');
const lotesService = require('./lotesService');
const productosService = require('./productosService');
const eventosService = require('./eventosService');

const CARPETA =
  process.env.SAE_IMPORT_DIR ||
  '\\\\ARQ01\\ANSELMI Trabajos\\TRABAJOS 2026\\SAE\\PRESUPUESTOS EXCEL\\CONFIRMADO';

function formatFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Lee un presupuesto de expositor desde un .xlsm real (hojas PRESUPUESTO + PEDIDO). */
function leerArchivo(rutaCompleta) {
  let wb;
  try {
    wb = XLSX.readFile(rutaCompleta, { cellDates: true });
  } catch (err) {
    return { error: `No se pudo abrir: ${err.message}` };
  }

  const ps = wb.Sheets['PRESUPUESTO'];
  const pedido = wb.Sheets['PEDIDO'];
  if (!ps || !pedido) {
    return { error: 'Faltan las hojas PRESUPUESTO o PEDIDO' };
  }

  const val = (addr) => {
    const cell = ps[addr];
    return cell ? cell.v : null;
  };

  const evento_nombre = val('C12') ? String(val('C12')).trim() : null;
  const lote_codigoRaw = val('F13');
  const lote_codigo =
    lote_codigoRaw !== null && lote_codigoRaw !== undefined ? String(lote_codigoRaw).trim() : null;
  const lote_expositor = val('F12') ? String(val('F12')).trim() : null;
  const cliente_nombre = val('C15') ? String(val('C15')).trim() : null;
  const cliente_contacto = [val('C13'), val('C14')].filter(Boolean).map(String).join(' - ') || null;
  const numeroRaw = val('F6');
  const numero = numeroRaw !== null && numeroRaw !== undefined ? String(numeroRaw) : null;
  const fecha = formatFecha(val('F7'));
  const condiciones_pago = val('B48') ? String(val('B48')).trim() : null;
  const notas = val('B47') ? String(val('B47')).trim() : null;

  if (!evento_nombre || !lote_codigo) {
    return { error: 'Faltan datos obligatorios (EXPO o N° STAND) en la hoja PRESUPUESTO' };
  }

  // La tabla de ítems y la fila de TOTAL: no están en celdas fijas — el offset entre
  // filas cambia de archivo a archivo (probablemente por filas ocultas/agrupadas en la
  // plantilla), así que se ubican buscando el texto de encabezado/etiqueta en vez de
  // asumir una fila fija. Confirmado contra archivos reales con 1, 3 y 14 ítems.
  const preciosPorCodigo = new Map();
  let monto_total = null;
  if (ps['!ref']) {
    const rangoPs = XLSX.utils.decode_range(ps['!ref']);
    let headerRow = null;
    for (let r = rangoPs.s.r; r <= rangoPs.e.r && headerRow === null; r++) {
      for (let c = 0; c <= 5; c++) {
        const cell = ps[XLSX.utils.encode_cell({ r, c })];
        if (cell && String(cell.v).trim() === 'DESCRIPCION') {
          headerRow = r;
          break;
        }
      }
    }
    if (headerRow !== null) {
      for (let r = headerRow + 1; r <= rangoPs.e.r; r++) {
        const codigoCell = ps[XLSX.utils.encode_cell({ r, c: 0 })]; // A = código
        // Columna D: CANTIDAD en filas de ítem, etiqueta ("TOTAL:", "SUBTOTAL:"...) en la
        // fila de totales — son filas distintas, así que reusar la columna es seguro.
        const dCell = ps[XLSX.utils.encode_cell({ r, c: 3 })];
        const valorCell = ps[XLSX.utils.encode_cell({ r, c: 4 })]; // E = VALOR UNITARIO
        if (codigoCell && codigoCell.v !== null && codigoCell.v !== undefined && String(codigoCell.v).trim() !== '') {
          const codigo = String(codigoCell.v).trim();
          if (valorCell && typeof valorCell.v === 'number') {
            preciosPorCodigo.set(codigo, valorCell.v);
          }
        } else if (dCell && String(dCell.v).trim() === 'TOTAL:') {
          const totalCell = ps[XLSX.utils.encode_cell({ r, c: 5 })]; // F = valor de la fila TOTAL:
          if (totalCell && typeof totalCell.v === 'number') monto_total = totalCell.v;
        }
      }
    }
  }

  const lineas = [];
  if (pedido['!ref']) {
    const rango = XLSX.utils.decode_range(pedido['!ref']);
    // Fila 3 = encabezados, datos desde la fila 4 (índice 3, 0-based)
    for (let r = 3; r <= rango.e.r; r++) {
      const codCell = pedido[XLSX.utils.encode_cell({ r, c: 9 })]; // J = COD
      const cantCell = pedido[XLSX.utils.encode_cell({ r, c: 8 })]; // I = CANT
      const rubroCell = pedido[XLSX.utils.encode_cell({ r, c: 5 })]; // F = RUBRO
      const productoCell = pedido[XLSX.utils.encode_cell({ r, c: 6 })]; // G = PRODUCTO
      if (!codCell || codCell.v === null || codCell.v === undefined || String(codCell.v).trim() === '') continue;
      const codigo = String(codCell.v).trim();
      const cantidad = Number(cantCell ? cantCell.v : 0) || 0;
      if (cantidad <= 0) continue;
      lineas.push({
        codigo,
        cantidad,
        rubro: rubroCell && rubroCell.v ? String(rubroCell.v).trim() : null,
        nombre: productoCell && productoCell.v ? String(productoCell.v).trim() : codigo,
        precio_unitario: preciosPorCodigo.has(codigo) ? preciosPorCodigo.get(codigo) : null,
      });
    }
  }

  return {
    evento_nombre,
    lote_codigo,
    lote_expositor,
    cliente_nombre,
    cliente_contacto,
    numero,
    fecha,
    monto_total,
    condiciones_pago,
    notas,
    lineas,
  };
}

/**
 * Crea el producto si el código todavía no existe. Si ya existe, NO le pisa nombre/rubro
 * — el mismo código a veces se describe distinto según el evento (ej. un panel PB-250
 * cargado como "TRASTIENDA 1m" solo en los presupuestos de BADA), y el catálogo
 * compartido no puede ir cambiando de nombre según cuál archivo se escaneó último.
 * Correcciones al nombre/rubro del catálogo se hacen a mano en Productos.
 */
function upsertProducto({ codigo, nombre, rubro }) {
  const existente = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(codigo);
  if (existente) return existente.id;
  return productosService.crear({ codigo, nombre, rubro }).id;
}

function encontrarOCrearLote(eventoId, codigo, expositor) {
  const existente = db
    .prepare('SELECT * FROM lotes WHERE evento_id = ? AND codigo = ? AND expositor IS ?')
    .get(eventoId, codigo, expositor);
  if (existente) return existente;
  return lotesService.crear({ eventoId, codigo, expositor, contacto: null });
}

/** Si el mismo código aparece en más de una fila del PEDIDO (pasa en archivos reales), suma las cantidades. */
function agruparLineasPorCodigo(lineas) {
  const mapa = new Map();
  for (const linea of lineas) {
    const existente = mapa.get(linea.codigo);
    if (existente) {
      existente.cantidad += linea.cantidad;
      if (existente.precio_unitario === null) existente.precio_unitario = linea.precio_unitario;
    } else {
      mapa.set(linea.codigo, { ...linea });
    }
  }
  return Array.from(mapa.values());
}

function guardarLineas(presupuestoId, lineas) {
  for (const linea of agruparLineasPorCodigo(lineas)) {
    const productoId = upsertProducto({ codigo: linea.codigo, nombre: linea.nombre, rubro: linea.rubro });
    db.prepare(
      'INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)'
    ).run(presupuestoId, productoId, linea.cantidad, linea.precio_unitario ?? null);
  }
}

function crearPresupuestoDesdeArchivo(loteId, datos, rutaArchivo, stat) {
  return transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO presupuestos
          (lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas,
           confirmado, estado, origen, ruta_archivo, archivo_activo, archivo_mtime, archivo_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pendiente_facturar', 'excel', ?, 1, ?, ?)`
      )
      .run(
        loteId,
        datos.numero,
        datos.fecha,
        datos.cliente_nombre,
        datos.cliente_contacto,
        datos.condiciones_pago,
        datos.monto_total,
        datos.notas,
        rutaArchivo,
        stat.mtime.toISOString(),
        stat.size
      );
    const presupuestoId = info.lastInsertRowid;
    guardarLineas(presupuestoId, datos.lineas);
    return presupuestoId;
  });
}

/** Re-sincroniza un presupuesto ya importado cuando su archivo cambió. Nunca toca `estado`. */
function actualizarPresupuestoDesdeArchivo(presupuestoExistente, datos, stat) {
  transaction(() => {
    db.prepare(
      `UPDATE presupuestos SET numero=?, fecha=?, cliente_nombre=?, cliente_contacto=?, condiciones_pago=?,
         monto_total=?, notas=?, archivo_mtime=?, archivo_size=?, archivo_activo=1, actualizado_en=datetime('now')
       WHERE id=?`
    ).run(
      datos.numero,
      datos.fecha,
      datos.cliente_nombre,
      datos.cliente_contacto,
      datos.condiciones_pago,
      datos.monto_total,
      datos.notas,
      stat.mtime.toISOString(),
      stat.size,
      presupuestoExistente.id
    );
    // El comentario es una anotación manual del usuario, no viene del Excel — un
    // re-sync (cron, o el archivo cambió) no debe borrarlo. Se preserva por código de
    // producto antes del DELETE+INSERT.
    const comentariosPrevios = new Map(
      db
        .prepare(
          `SELECT prod.codigo AS codigo, pl.comentario AS comentario
           FROM presupuesto_lineas pl JOIN productos prod ON prod.id = pl.producto_id
           WHERE pl.presupuesto_id = ? AND pl.comentario IS NOT NULL AND pl.comentario != ''`
        )
        .all(presupuestoExistente.id)
        .map((r) => [r.codigo, r.comentario])
    );
    db.prepare('DELETE FROM presupuesto_lineas WHERE presupuesto_id = ?').run(presupuestoExistente.id);
    guardarLineas(
      presupuestoExistente.id,
      datos.lineas.map((l) => ({ ...l, comentario: comentariosPrevios.get(l.codigo) || null }))
    );
  });
}

function registrarPendienteEventoAmbiguo(rutaArchivo, datos) {
  const yaPendiente = db
    .prepare("SELECT id FROM import_pendientes WHERE tipo = 'evento_ambiguo' AND ruta_archivo = ? AND resuelto = 0")
    .get(rutaArchivo);
  if (yaPendiente) return;
  db.prepare("INSERT INTO import_pendientes (tipo, ruta_archivo, datos_json) VALUES ('evento_ambiguo', ?, ?)").run(
    rutaArchivo,
    JSON.stringify(datos)
  );
}

let adminIdCache = null;
function obtenerAdminId() {
  if (adminIdCache) return adminIdCache;
  const admin = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1").get();
  adminIdCache = admin ? admin.id : null;
  return adminIdCache;
}

function registrarPendientePosibleReemplazo(rutaArchivo, loteId, huerfanoId, nuevoId) {
  const yaPendiente = db
    .prepare("SELECT id FROM import_pendientes WHERE tipo = 'posible_reemplazo' AND presupuesto_huerfano_id = ? AND resuelto = 0")
    .get(huerfanoId);
  if (yaPendiente) return;
  db.prepare(
    `INSERT INTO import_pendientes (tipo, ruta_archivo, lote_id, presupuesto_huerfano_id, presupuesto_nuevo_id)
     VALUES ('posible_reemplazo', ?, ?, ?, ?)`
  ).run(rutaArchivo, loteId, huerfanoId, nuevoId);
}

function escanear() {
  let archivos;
  try {
    archivos = fs
      .readdirSync(CARPETA)
      .filter((f) => /\.xlsm?$/i.test(f))
      .map((f) => path.join(CARPETA, f));
  } catch (err) {
    console.error(`[excelImportService] No se pudo leer la carpeta "${CARPETA}": ${err.message}`);
    return { ok: false, error: err.message };
  }

  const rutasEscaneadas = new Set(archivos);
  const resumen = {
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0,
    eventosCreadosSinFecha: 0,
    pendientesEvento: 0,
    huerfanos: 0,
    borrados: 0,
    errores: 0,
  };

  // 1) Marcar huérfanos ANTES de crear presupuestos nuevos, para poder emparejarlos
  //    con un reemplazo que aparezca en este mismo escaneo.
  const activos = db.prepare("SELECT * FROM presupuestos WHERE origen = 'excel' AND archivo_activo = 1").all();
  for (const p of activos) {
    if (!rutasEscaneadas.has(p.ruta_archivo)) {
      db.prepare("UPDATE presupuestos SET archivo_activo = 0, actualizado_en = datetime('now') WHERE id = ?").run(p.id);
      resumen.huerfanos++;
    }
  }

  // 1.5) Limpiar pendientes 'evento_ambiguo' obsoletos: si el archivo ya tiene un
  //      presupuesto (creado en este escaneo, en uno anterior, o vinculado a mano), el
  //      pendiente ya no aplica, sin importar cuándo se haya resuelto la ambigüedad.
  db.prepare(
    `UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now')
     WHERE tipo = 'evento_ambiguo' AND resuelto = 0
       AND ruta_archivo IN (SELECT ruta_archivo FROM presupuestos WHERE ruta_archivo IS NOT NULL)`
  ).run();

  for (const rutaArchivo of archivos) {
    let stat;
    try {
      stat = fs.statSync(rutaArchivo);
    } catch {
      continue;
    }

    const existente = db.prepare('SELECT * FROM presupuestos WHERE ruta_archivo = ?').get(rutaArchivo);

    if (existente) {
      const mtimeIso = stat.mtime.toISOString();
      if (existente.archivo_mtime === mtimeIso && existente.archivo_size === stat.size && existente.archivo_activo) {
        resumen.sinCambios++;
        continue;
      }
      const datos = leerArchivo(rutaArchivo);
      if (datos.error) {
        console.error(`[excelImportService] ${rutaArchivo}: ${datos.error}`);
        resumen.errores++;
        continue;
      }
      actualizarPresupuestoDesdeArchivo(existente, datos, stat);
      resumen.actualizados++;
      continue;
    }

    const datos = leerArchivo(rutaArchivo);
    if (datos.error) {
      console.error(`[excelImportService] ${rutaArchivo}: ${datos.error}`);
      resumen.errores++;
      continue;
    }

    let eventosCoincidentes = db.prepare('SELECT * FROM eventos WHERE nombre = ? COLLATE NOCASE').all(datos.evento_nombre);
    if (eventosCoincidentes.length === 0) {
      // Nombre no matchea directo: puede ser un evento que ya se unificó con otro bajo un
      // nombre distinto (ver eventosService.fusionar) — el alias lo redirige sin volver a
      // crear el duplicado.
      const porAlias = db
        .prepare(
          `SELECT e.* FROM eventos_alias a JOIN eventos e ON e.id = a.evento_id
           WHERE a.nombre = ? COLLATE NOCASE`
        )
        .get(datos.evento_nombre);
      if (porAlias) eventosCoincidentes = [porAlias];
    }

    let evento;
    if (eventosCoincidentes.length === 1) {
      evento = eventosCoincidentes[0];
    } else if (eventosCoincidentes.length > 1) {
      // Ambiguo: el nombre matchea más de un evento (ej. una expo que se repite en el
      // año) — no adivinamos cuál, queda pendiente de que un humano elija.
      registrarPendienteEventoAmbiguo(rutaArchivo, datos);
      resumen.pendientesEvento++;
      continue;
    } else {
      // No existe ningún evento con ese nombre: se crea igual (ya no mantenemos un
      // calendario aparte para completar fechas de antemano), con fecha pendiente —
      // '' en vez de NULL porque la columna es NOT NULL; el resto de la app (calendario,
      // alertas) ya trata una fecha vacía como "sin definir" sin romperse.
      evento = eventosService.crear({
        nombre: datos.evento_nombre,
        lugar: null,
        fecha_inicio: '',
        fecha_fin: '',
        notas: null,
        creadoPor: obtenerAdminId(),
      });
      resumen.eventosCreadosSinFecha++;
    }

    const lote = encontrarOCrearLote(evento.id, datos.lote_codigo, datos.lote_expositor);
    const presupuestoId = crearPresupuestoDesdeArchivo(lote.id, datos, rutaArchivo, stat);
    resumen.nuevos++;

    // Si este archivo tenía un pendiente 'evento_ambiguo' de un escaneo anterior (por
    // ejemplo, la ambigüedad se resolvió renombrando un evento), queda obsoleto.
    db.prepare(
      "UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE tipo = 'evento_ambiguo' AND ruta_archivo = ? AND resuelto = 0"
    ).run(rutaArchivo);

    const huerfano = db
      .prepare('SELECT * FROM presupuestos WHERE lote_id = ? AND archivo_activo = 0 AND id != ? ORDER BY id DESC LIMIT 1')
      .get(lote.id, presupuestoId);
    if (huerfano) {
      registrarPendientePosibleReemplazo(rutaArchivo, lote.id, huerfano.id, presupuestoId);
    }
  }

  // 3) Si un presupuesto quedó huérfano (su archivo ya no está en CONFIRMADO) y nunca se
  //    emparejó con un posible reemplazo — ni en este escaneo ni en uno anterior, resuelto
  //    o no — es que el archivo simplemente se borró de la carpeta sin que apareciera nada
  //    nuevo para ese lote: se borra también de la app. Si SÍ quedó emparejado, su destino
  //    ya lo maneja el flujo de 'posible_reemplazo' (se borra al resolver "es un reemplazo",
  //    o se conserva a propósito si un humano eligió "son distintos") y no se toca acá.
  const huerfanosSinEmparejar = db
    .prepare(
      `SELECT id FROM presupuestos
       WHERE origen = 'excel' AND archivo_activo = 0
         AND id NOT IN (
           SELECT presupuesto_huerfano_id FROM import_pendientes
           WHERE tipo = 'posible_reemplazo' AND presupuesto_huerfano_id IS NOT NULL
         )`
    )
    .all();
  for (const p of huerfanosSinEmparejar) {
    db.prepare('DELETE FROM presupuestos WHERE id = ?').run(p.id);
    resumen.borrados++;
  }

  console.log('[excelImportService] Escaneo completo:', resumen);
  return { ok: true, resumen };
}

/** Materializa un pendiente de tipo 'evento_ambiguo' contra el evento que el humano eligió. */
function materializarPendiente(pendienteId, eventoId) {
  const pendiente = db.prepare('SELECT * FROM import_pendientes WHERE id = ?').get(pendienteId);
  if (!pendiente) {
    const err = new Error('Pendiente no encontrado');
    err.status = 404;
    throw err;
  }
  if (pendiente.tipo !== 'evento_ambiguo') {
    const err = new Error('Este pendiente no es de tipo evento_ambiguo');
    err.status = 400;
    throw err;
  }

  const datos = JSON.parse(pendiente.datos_json);
  let stat;
  try {
    stat = fs.statSync(pendiente.ruta_archivo);
  } catch {
    const err = new Error('El archivo ya no existe en la carpeta, no se puede vincular');
    err.status = 400;
    throw err;
  }

  const lote = encontrarOCrearLote(eventoId, datos.lote_codigo, datos.lote_expositor);
  const presupuestoId = crearPresupuestoDesdeArchivo(lote.id, datos, pendiente.ruta_archivo, stat);
  db.prepare("UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE id = ?").run(pendienteId);
  return presupuestoId;
}

function iniciarProgramacion() {
  try {
    escanear();
  } catch (err) {
    console.error('[excelImportService] Error en el escaneo inicial:', err);
  }
  cron.schedule('*/10 * * * *', () => {
    try {
      escanear();
    } catch (err) {
      console.error('[excelImportService] Error en escaneo programado:', err);
    }
  });
}

module.exports = { escanear, iniciarProgramacion, leerArchivo, materializarPendiente, CARPETA };
