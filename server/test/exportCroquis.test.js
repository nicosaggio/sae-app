// Cubre lo que agrega el croquis al PDF de totales del evento (dónde se imprime, los comentarios y
// las cotas), no el resto de exportService.js (que no tenía tests antes de esto).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-exportcr-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const { cajaDelCroquis, geometriaCota } = require('../src/services/exportService');

let servidor;
let base;
let cookie;
let eventoId;
let itemPanelId;

async function textoPorPagina(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const paginas = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const contenido = await (await documento.getPage(i)).getTextContent();
    paginas.push(contenido.items.map((t) => t.str).join(' '));
  }
  return paginas;
}

async function pdfDelEvento(id, query = '') {
  const res = await fetch(`${base}/api/eventos/${id}/export/pdf${query}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  return textoPorPagina(Buffer.from(await res.arrayBuffer()));
}

const ocurrencias = (texto, regex) => (texto.match(regex) || []).length;
const guardarCroquis = (loteId, cuerpo) =>
  fetch(`${base}/api/lotes/${loteId}/croquis`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(cuerpo) });

function crearLote(codigo, expositor, cantidadProductos) {
  const loteId = Number(db.prepare('INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, ?, ?)').run(eventoId, codigo, expositor).lastInsertRowid);
  if (cantidadProductos > 0) {
    const presId = Number(
      db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-10-01', 1, 'pendiente_facturar', 'manual')").run(loteId).lastInsertRowid
    );
    for (let i = 0; i < cantidadProductos; i++) {
      const productoId = Number(db.prepare("INSERT INTO productos (codigo, nombre, rubro) VALUES (?, ?, 'SISTEMA')").run(`P${eventoId}-${codigo}-${i}`, `Producto ${codigo}-${i}`).lastInsertRowid);
      db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, 1, 100)').run(presId, productoId);
    }
  }
  return loteId;
}

test.before(async () => {
  migrar();
  const hash = bcrypt.hashSync('clave', 4);
  db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES (?, ?, ?)').run('admin1', hash, 'admin');
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO PRUEBA', '2026-11-01', '2026-11-03', ?)").run(admin).lastInsertRowid);
  // Un ítem de catálogo con símbolo real en la biblioteca (ver server/src/data/croquisSimbolos.json).
  itemPanelId = Number(
    db.prepare("INSERT INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES ('PB-250', 'SISTEMA', 'Panel syma blanco', 'manual', 1)").run().lastInsertRowid
  );

  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const resLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: 'admin1', password: 'clave' }) });
  cookie = resLogin.headers.get('set-cookie').split(';')[0];

  const dibujo = {
    paredes: [{ x1: 0, y1: 0, x2: 3, y2: 0 }],
    materiales: [{ catalogo_item_id: itemPanelId, x: 0.5, y: 0.2, rotacion: 90 }],
  };
  crearLote('1', 'ALFA', 2); // sin croquis
  const beta = crearLote('2', 'BETA', 2); // con croquis, cota y comentarios
  await guardarCroquis(beta, { ...dibujo, cotas: [{ x1: 0, y1: 0, x2: 3, y2: 0, offset: -0.45 }], comentarios: 'Pared del fondo con gráfica del cliente.' });
  const gamma = crearLote('3', 'GAMMA', 0); // con croquis pero sin pedidos cargados, sin comentarios
  await guardarCroquis(gamma, dibujo);
  const delta = crearLote('4', 'DELTA', 32); // detalle muy largo: el croquis ya no entra en su hoja
  await guardarCroquis(delta, dibujo);
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('el croquis se imprime justo debajo del detalle de su lote (no al final), sólo para los lotes que tienen uno dibujado', async () => {
  const todo = (await pdfDelEvento(eventoId)).join(' ');

  const posicion = (regex) => {
    const m = todo.match(regex);
    assert.ok(m, `no aparece ${regex}`);
    return m.index;
  };
  const alfa = posicion(/Expositor: ALFA/);
  const beta = posicion(/Expositor: BETA/);
  const gamma = posicion(/Expositor: GAMMA/);
  const croquisBeta = posicion(/CROQUIS/);

  assert.ok(alfa < beta && beta < croquisBeta && croquisBeta < gamma, 'ALFA (sin croquis), BETA y su croquis, y recién después GAMMA');
  assert.ok(!/CROQUIS/.test(todo.slice(alfa, beta)), 'el lote sin croquis dibujado no lleva croquis');

  const totales = posicion(/TOTALES DEL EVENTO/);
  assert.equal(ocurrencias(todo.slice(totales), /CROQUIS/g), 0, 'ya no hay croquis después de los totales');
  assert.equal(ocurrencias(todo, /CROQUIS/g), 3, 'BETA, GAMMA y DELTA tienen croquis dibujado; ALFA no');
});

test('los comentarios salen en un cuadro junto al croquis y las cotas con su medida; sin comentarios no hay cuadro', async () => {
  const todo = (await pdfDelEvento(eventoId)).join(' ');
  assert.equal(ocurrencias(todo, /COMENTARIOS/g), 1, 'sólo BETA tiene comentarios');
  assert.match(todo, /Pared del fondo con gráfica del\s+cliente\./, 'el texto se parte en renglones dentro del cuadro');
  assert.match(todo, /3,00 m/, 'la cota de 3 metros');
  // El cuadro va a la derecha del croquis, o sea después del rótulo CROQUIS y antes del siguiente lote.
  assert.match(todo, /CROQUIS[\s\S]*COMENTARIOS[\s\S]*Pared del fondo[\s\S]*Expositor: GAMMA/);
});

test('un lote con croquis pero sin pedidos cargados igual lo imprime, con su propio título', async () => {
  const paginas = await pdfDelEvento(eventoId);
  const paginaGamma = paginas.find((p) => /Expositor: GAMMA/.test(p));
  assert.ok(paginaGamma);
  assert.match(paginaGamma, /Lote: 3[\s\S]*Expositor: GAMMA[\s\S]*CROQUIS/);
});

test('si el croquis no entra debajo de un lote largo pasa a la hoja siguiente, repitiendo el título del lote', async () => {
  // Según cuántos productos tenga el lote, el final de su detalle cae en distintos lugares de la hoja;
  // hay cantidades para las que no queda lugar para el croquis. Se prueba con varias hasta dar con una.
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const dibujo = { paredes: [{ x1: 0, y1: 0, x2: 3, y2: 0 }], materiales: [{ catalogo_item_id: itemPanelId, x: 0.5, y: 0.2, rotacion: 90 }] };
  let probadas = 0;
  let conSalto = null;
  const eventoOriginal = eventoId;
  try {
    for (let n = 14; n <= 40 && !conSalto; n++) {
      eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, '2027-01-01', '2027-01-03', ?)").run(`EXPO LARGA ${n}`, admin).lastInsertRowid);
      const loteId = crearLote('9', 'OMEGA', n);
      await guardarCroquis(loteId, dibujo);
      const paginas = await pdfDelEvento(eventoId);
      probadas++;
      const hoja = paginas.findIndex((p) => /CROQUIS/.test(p));
      assert.ok(hoja >= 0, `con ${n} productos el croquis tiene que salir`);
      if (!/Producto 9-/.test(paginas[hoja]) && hoja > 0) conSalto = { n, hoja, paginas };
    }
  } finally {
    eventoId = eventoOriginal;
  }
  assert.ok(conSalto, `ninguna de las ${probadas} cantidades probadas forzó el salto de hoja`);
  assert.match(conSalto.paginas[conSalto.hoja], /Lote: 9[\s\S]*Expositor: OMEGA[\s\S]*CROQUIS/, 'la hoja nueva repite a qué lote pertenece');
  assert.ok(conSalto.paginas.slice(0, conSalto.hoja).some((p) => /Producto 9-0/.test(p)), 'el detalle del lote quedó en las hojas anteriores');
});

test('filtrando por rubros sólo salen los croquis de los lotes que aparecen en el listado', async () => {
  const todo = (await pdfDelEvento(eventoId, '?rubros=SISTEMA')).join(' ');
  assert.ok(!/Expositor: GAMMA/.test(todo), 'GAMMA no tiene productos: queda afuera del listado y de los croquis');
  assert.equal(ocurrencias(todo, /CROQUIS/g), 2, 'BETA y DELTA');
});

test('un evento sin ningún croquis dibujado no agrega nada', async () => {
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const otroEventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO SIN DIBUJOS', '2026-12-01', '2026-12-03', ?)").run(admin).lastInsertRowid);
  const paginas = await pdfDelEvento(otroEventoId);
  assert.ok(!paginas.join(' ').includes('CROQUIS'));
});

test('un croquis hecho sólo de columnas (bloque auxiliar, sin ítem de catálogo) se exporta bien', async () => {
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const id = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO COLUMNAS', '2027-02-01', '2027-02-03', ?)").run(admin).lastInsertRowid);
  const anterior = eventoId;
  eventoId = id;
  try {
    const loteId = crearLote('1', 'SOLO COLUMNAS', 0);
    const res = await guardarCroquis(loteId, { paredes: [], materiales: [{ bloque: 'COLUMNA', x: 1.05, y: 1.05, rotacion: 0 }, { bloque: 'COLUMNA', x: 2.05, y: 1.05, rotacion: 0 }] });
    assert.equal(res.status, 200);
    const paginas = await pdfDelEvento(id);
    assert.equal(ocurrencias(paginas.join(' '), /CROQUIS/g), 1);
  } finally {
    eventoId = anterior;
  }
});

test('encuadre del croquis: caja exacta (sin aire de más) que incluye paredes, materiales rotados y cotas', () => {
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  // Sólo paredes: de punta a punta, más el margen de las líneas.
  const soloParedes = cajaDelCroquis({ paredes: [{ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 4, y1: 0, x2: 4, y2: 3 }], materiales: [] });
  casi(soloParedes.x, -0.05);
  casi(soloParedes.y, -0.05);
  casi(soloParedes.w, 4.1);
  casi(soloParedes.h, 3.1);

  // Un material de 1.5 x 0.04 rotado 90° ocupa 0.04 de ancho y 1.5 de alto, alrededor de su centro.
  const rotado = cajaDelCroquis({ paredes: [], materiales: [{ x: 1, y: 1, ancho: 1.5, profundidad: 0.04, rotacion: 90 }] });
  casi(rotado.w, 0.04 + 0.1);
  casi(rotado.h, 1.5 + 0.1);
  casi(rotado.x, 1 + 0.75 - 0.02 - 0.05);
  casi(rotado.y, 1 + 0.02 - 0.75 - 0.05);

  // Una cota afuera del dibujo agranda la caja (con el margen del texto), para que no se corte.
  const conCota = cajaDelCroquis({ paredes: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], materiales: [], cotas: [{ x1: 0, y1: 0, x2: 4, y2: 0, offset: -0.5 }] });
  casi(conCota.y, -0.8); // la línea de cota está en y = -0.5, con 0.25 de margen y 0.05 de grosor
  casi(conCota.h, 1.1);
  casi(conCota.x, -0.3);
  casi(conCota.w, 4.6);
});

test('geometría de una cota: largo, sentido y línea de cota desplazada en perpendicular', () => {
  const g = geometriaCota({ x1: 0, y1: 0, x2: 3, y2: 0, offset: 0.5 });
  assert.equal(g.largo, 3);
  assert.deepEqual([g.ax, g.ay, g.bx, g.by], [0, 0.5, 3, 0.5]);
  assert.equal(g.lado, 1);
  const invertida = geometriaCota({ x1: 3, y1: 0, x2: 0, y2: 0, offset: 0.5 });
  assert.deepEqual([invertida.ay, invertida.by], [-0.5, -0.5], 'al invertir el sentido el mismo offset cae del otro lado');
  assert.equal(geometriaCota({ x1: 1, y1: 1, x2: 1, y2: 1, offset: 1 }).largo, 0, 'una cota de largo cero no revienta');
});
