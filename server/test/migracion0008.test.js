const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// La conexión lee DB_PATH al cargarse: hay que fijarlo antes del require. Cada archivo de test
// corre en su propio proceso, así que esto no toca la base real ni a los otros tests.
const dbTemporal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-test-')), 'test.db');
process.env.DB_PATH = dbTemporal;

const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');

const insertarItem = (codigo, extra = {}) => {
  const columnas = { codigo, ...extra };
  const nombres = Object.keys(columnas);
  const info = db
    .prepare(`INSERT INTO catalogo_items (${nombres.join(',')}) VALUES (${nombres.map(() => '?').join(',')})`)
    .run(...Object.values(columnas));
  return Number(info.lastInsertRowid);
};

test.before(() => {
  migrar();
});

test.after(() => {
  db.close();
  for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(dbTemporal + sufijo, { force: true });
  fs.rmSync(path.dirname(dbTemporal), { recursive: true, force: true });
});

test('la migración crea las tablas del catálogo y no deja claves foráneas huérfanas', () => {
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'catalogo_%' ORDER BY name").all().map((t) => t.name);
  assert.deepEqual(tablas, [
    'catalogo_ajustes',
    'catalogo_base_precios',
    'catalogo_importaciones',
    'catalogo_items',
    'catalogo_paginas',
    'catalogo_posiciones',
    'catalogo_version_precios',
    'catalogo_versiones',
  ]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('correr las migraciones de nuevo no las repite', () => {
  migrar();
  const aplicadas = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE nombre = '0008_catalogo.sql'").get().n;
  assert.equal(aplicadas, 1);
});

test('siempre existe la versión General al 40%, y es la única', () => {
  const general = db.prepare('SELECT * FROM catalogo_versiones WHERE es_general = 1').all();
  assert.equal(general.length, 1);
  assert.equal(general[0].nombre, 'General');
  assert.equal(general[0].porcentaje_global, 0.4);
  assert.equal(general[0].aplicar_a_todos, 0);
  assert.equal(general[0].fecha_vigencia, '2026-09-15');

  assert.throws(
    () => db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global, es_general) VALUES ('Otra general', 0.5, 1)").run(),
    /UNIQUE/
  );
  assert.throws(
    () => db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global) VALUES ('general', 0.5)").run(),
    /UNIQUE/,
    'los nombres de versión no se repiten aunque cambien las mayúsculas'
  );
  assert.throws(
    () => db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global) VALUES ('Negativa', -0.1)").run(),
    /CHECK/
  );
});

test('los ajustes arrancan con los valores actuales del catálogo', () => {
  const ajustes = Object.fromEntries(db.prepare('SELECT clave, valor FROM catalogo_ajustes').all().map((a) => [a.clave, a.valor]));
  assert.equal(ajustes.porcentaje_defecto, '0.4');
  assert.equal(ajustes.multiplo_redondeo, '100');
  assert.equal(ajustes.adicional_pie_tv, '8900');
  assert.equal(ajustes.fecha_vigencia, '2026-09-15');
  assert.equal(ajustes.mostrar_decimales, '1');
  const lineas = ajustes.pie_legal.split('\n');
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^TODOS LOS PRECIOS NO INCLUYEN EL IVA \(21 %\) Y ESTÁN EXPRESADOS EN PESOS ARGENTINOS\.$/);
  assert.match(lineas[1], /\{fecha_vigencia\}/);
  assert.match(lineas[2], /disponibilidad en el momento de la reserva\.$/);
});

test('catalogo_items: código único sin distinguir mayúsculas, y checks de regla, porcentaje y flags', () => {
  insertarItem('PB-250', { rubro: 'SISTEMA', regla_tipo: 'base', regla_codigo_base: 'PB-250' });
  assert.throws(() => insertarItem('pb-250'), /UNIQUE/);
  assert.throws(() => insertarItem('X-1', { regla_tipo: 'inventada' }), /CHECK/);
  assert.throws(() => insertarItem('X-2', { porcentaje: -0.5 }), /CHECK/);
  assert.throws(() => insertarItem('X-3', { publicado: 2 }), /CHECK/);
  assert.throws(() => insertarItem('X-4', { estado_precio: 'raro' }), /CHECK/);

  const nuevo = db.prepare("SELECT * FROM catalogo_items WHERE codigo = 'PB-250'").get();
  assert.equal(nuevo.regla_tipo, 'base');
  assert.equal(nuevo.porcentaje, null, 'NULL = sigue al porcentaje global');
  assert.equal(nuevo.publicado, 0);
  assert.equal(nuevo.activo, 1);
  assert.equal(nuevo.estado_precio, 'sin_calcular');
  assert.equal(nuevo.suma_adicional_pie, 0);
});

test('no se puede borrar un ítem del que dependen otros precios', () => {
  const origen = insertarItem('CE-100');
  const derivado = insertarItem('CE-150', { regla_tipo: 'derivado', regla_item_ref_id: origen, regla_factor: 1.5 });
  const razon = insertarItem('MVN-01', { regla_tipo: 'razon', regla_item_ref_id: origen, regla_item_ref2_id: origen, regla_item_ref3_id: origen });

  assert.throws(() => db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(origen), /FOREIGN KEY/);
  db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(razon);
  db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(derivado);
  db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(origen);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_items WHERE codigo = ?').get('CE-100').n, 0);
});

test('un ítem puede enlazarse a productos; si el producto se borra, el enlace queda en NULL', () => {
  const usuario = Number(db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ('t', 'x')").run().lastInsertRowid);
  assert.ok(usuario);
  const producto = Number(db.prepare("INSERT INTO productos (codigo, nombre) VALUES ('PROD-1', 'Producto uno')").run().lastInsertRowid);
  const itemId = insertarItem('PROD-1', { producto_id: producto });
  assert.equal(db.prepare('SELECT producto_id FROM catalogo_items WHERE id = ?').get(itemId).producto_id, producto);

  db.prepare('DELETE FROM productos WHERE id = ?').run(producto);
  assert.equal(db.prepare('SELECT producto_id FROM catalogo_items WHERE id = ?').get(itemId).producto_id, null);

  assert.throws(() => insertarItem('PROD-2', { producto_id: 999999 }), /FOREIGN KEY/);
});

test('páginas y posiciones: 3 columnas x 2 bandas, sin celdas repetidas, y borrar la página borra sus posiciones', () => {
  const item = insertarItem('POS-1');
  const otro = insertarItem('POS-2');
  const pagina = Number(db.prepare("INSERT INTO catalogo_paginas (orden, titulo) VALUES (1, 'SAE - MOBILIARIO')").run().lastInsertRowid);
  const poner = (banda, columna, itemId) =>
    db.prepare('INSERT INTO catalogo_posiciones (pagina_id, banda, columna, item_id) VALUES (?, ?, ?, ?)').run(pagina, banda, columna, itemId);

  poner(1, 1, item);
  poner(2, 3, otro);
  assert.throws(() => poner(1, 1, otro), /UNIQUE|PRIMARY/);
  assert.throws(() => poner(3, 1, otro), /CHECK/);
  assert.throws(() => poner(1, 4, otro), /CHECK/);
  assert.throws(() => db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(item), /FOREIGN KEY/, 'no se borra un ítem que está en una página');

  db.prepare('DELETE FROM catalogo_paginas WHERE id = ?').run(pagina);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_posiciones WHERE pagina_id = ?').get(pagina).n, 0);
});

test('precios por versión: borrar la versión borra su foto de precios, pero no se borra un ítem con precios guardados', () => {
  const item = insertarItem('VER-1');
  const version = Number(db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global) VALUES ('Expo Test', 0.55)").run().lastInsertRowid);
  const guardar = (estado) =>
    db.prepare('INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) VALUES (?, ?, 1000, 0.55, 1600, ?)').run(version, item, estado);

  guardar('ok');
  assert.throws(() => guardar('ok'), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(item), /FOREIGN KEY/);

  db.prepare('DELETE FROM catalogo_versiones WHERE id = ?').run(version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(version).n, 0);
  db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(item);
});

test('importaciones: guardan usuario opcional (la siembra por línea de comandos no tiene usuario)', () => {
  db.prepare("INSERT INTO catalogo_importaciones (archivo, items_afectados, resumen_json) VALUES ('siembra', 259, '{}')").run();
  const fila = db.prepare("SELECT * FROM catalogo_importaciones WHERE archivo = 'siembra'").get();
  assert.equal(fila.usuario_id, null);
  assert.equal(fila.items_afectados, 259);
  assert.ok(fila.fecha);
});
