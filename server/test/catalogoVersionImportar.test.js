const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-vimp-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');

const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const versionImportService = require('../src/services/catalogoVersionImportService');
const { sembrarCatalogoDePrueba } = require('./helpers/catalogoDePrueba');

let servidor;
let base;
const cookies = {};

const ENCABEZADO = [null, null, 'RUBRO', 'COD', 'DESCRIPCION', 'BASE PARCHE', '$ 0,22', 'SAE CIDEL'];
const filaExcel = (codigo, precio, extra = {}) => [null, null, extra.rubro ?? 'SISTEMA', codigo, extra.descripcion ?? `Desc ${codigo}`, extra.base ?? null, extra.markup ?? null, precio];

// Cubre: precios nuevos (CE-100, PB-1), uno con el mismo valor que ya tiene (CE-150, no varía), un TV con
// su propio valor (no el 22%), un código repetido (CE-100), uno inexistente en el catálogo (ZZ-999), y dos
// ítems del catálogo que no aparecen en el archivo (CE-200 y MC-43: quedan sin precio).
function excelListaCidel({ columnaPrecio = 'SAE CIDEL', filas } = {}) {
  const encabezado = ENCABEZADO.map((h) => (h === 'SAE CIDEL' ? columnaPrecio : h));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], encabezado, ...(filas || [
    filaExcel('CE-100', 1200),
    filaExcel('CE-150', 2100),
    filaExcel('PB-1', 2500),
    filaExcel('TV-43', 300000),
    filaExcel('SIN', 0),
    filaExcel('ce-100', 9999), // duplicado: gana el primero
    filaExcel('ZZ-999', 500, { descripcion: 'No existe en el catálogo' }),
  ])]), 'DATOS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function iniciarSesion(usuario) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: usuario, password: 'clave' }) });
  cookies[usuario] = res.headers.get('set-cookie').split(';')[0];
}

async function json(res) {
  const t = await res.text();
  try {
    return { status: res.status, cuerpo: JSON.parse(t) };
  } catch {
    return { status: res.status, cuerpo: t };
  }
}

const api = async (usuario, metodo, ruta, cuerpo) =>
  json(await fetch(`${base}/api/catalogo${ruta}`, {
    method: metodo,
    headers: { cookie: cookies[usuario], ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  }));

async function subir(usuario, buffer, datos = {}, { nombre = 'CIDEL - SEPTIEMBRE.xlsm', campo = 'archivo' } = {}) {
  const formulario = new FormData();
  if (buffer) formulario.append(campo, new Blob([buffer]), nombre);
  for (const [clave, valor] of Object.entries(datos)) formulario.append(clave, String(valor));
  return json(await fetch(`${base}/api/catalogo/versiones/importar`, { method: 'POST', headers: { cookie: cookies[usuario] }, body: formulario }));
}

const idDe = (codigo) => db.prepare('SELECT id FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(codigo).id;
const precioGuardado = (versionId, codigo) => ({ ...db.prepare('SELECT sae, estado_precio, pase_parche, porcentaje FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(versionId, idDe(codigo)) });

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol] of [['admin1', 'admin'], ['oper1', 'operador']]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES (?, ?, ?)').run(nombre, hash, rol);
  }
  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const u of ['admin1', 'oper1']) await iniciarSesion(u);
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('sólo un admin puede previsualizar o confirmar; sin token no confirma', async () => {
  const r = await subir('oper1', excelListaCidel(), { nombre: 'X' });
  assert.equal(r.status, 403);
  assert.equal((await api('oper1', 'POST', '/versiones/importar/confirmar', { token: 'x' })).status, 403);
  assert.equal((await api('admin1', 'POST', '/versiones/importar/confirmar', {})).status, 400);
  assert.equal((await api('admin1', 'POST', '/versiones/importar/confirmar', { token: 'no-existe' })).status, 410);
});

test('previsualizar: arma el reporte y NO guarda nada', async () => {
  const antes = { versiones: db.prepare('SELECT COUNT(*) n FROM catalogo_versiones').get().n, fotos: db.prepare('SELECT COUNT(*) n FROM catalogo_version_precios').get().n };
  const r = await subir('admin1', excelListaCidel(), { nombre: 'CIDEL' });
  assert.equal(r.status, 200);
  const p = r.cuerpo;
  assert.ok(p.token);
  assert.equal(p.archivo, 'CIDEL - SEPTIEMBRE.xlsm');
  assert.equal(p.columna_precio, 'SAE CIDEL');

  const porCodigo = Object.fromEntries(p.items_con_precio.map((i) => [i.codigo, i]));
  assert.equal(porCodigo['CE-100'].sae_nuevo, 1200);
  assert.equal(porCodigo['CE-100'].sae_general_actual, 1400, 'lo que tiene hoy la General, para comparar');
  assert.equal(porCodigo['CE-100'].variacion_pct, -14.3);
  assert.equal(porCodigo['TV-43'].sae_nuevo, 300000);
  assert.equal(porCodigo['PB-1'].sae_nuevo, 2500);

  const sinPrecio = p.items_sin_precio.map((i) => i.codigo).sort();
  assert.deepEqual(sinPrecio, ['CE-200', 'MC-43', 'SIN', 'TV-50P'], 'CE-200, MC-43 y TV-50P no estaban en el archivo; SIN vino en 0');
  assert.equal(p.resumen.itemsConPrecio, 4);
  assert.equal(p.resumen.itemsSinPrecio, 4);

  assert.deepEqual(p.codigos_desconocidos.map((c) => c.codigo), ['ZZ-999']);
  assert.deepEqual(p.advertencias.codigos_repetidos_en_el_archivo.map((d) => d.codigo), ['CE-100']);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogo_versiones').get().n, antes.versiones, 'no se creó nada todavía');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogo_version_precios').get().n, antes.fotos);
});

test('previsualizar valida el nombre antes de aceptar el archivo (no hace falta subirlo dos veces si ya está usado)', async () => {
  assert.match((await subir('admin1', excelListaCidel(), { nombre: '' })).cuerpo.error, /nombre de la versión es obligatorio/);
  assert.match((await subir('admin1', excelListaCidel(), { nombre: 'General' })).cuerpo.error, /Ya existe una versión llamada/);
  assert.match((await subir('admin1', null, { nombre: 'CIDEL' })).cuerpo.error, /Falta el archivo/);
});

test('confirmar: crea una versión fija con los precios del archivo tal cual (no recalculados), y queda registrado el archivo de origen', async () => {
  const previa = (await subir('admin1', excelListaCidel(), {
    nombre: 'CIDEL',
    aplicar_a_todos: 'false',
    fecha_vigencia: '2026-10-15',
    pie_legal: 'Válido para el evento CIDEL.',
  })).cuerpo;

  const r = await api('admin1', 'POST', '/versiones/importar/confirmar', { token: previa.token });
  assert.equal(r.status, 201);
  const v = r.cuerpo;
  assert.equal(v.nombre, 'CIDEL');
  assert.equal(v.es_historial, 1, 'queda fija, como el historial: no se recalcula sola');
  assert.equal(v.es_general, 0);
  assert.equal(v.origen_archivo, 'CIDEL - SEPTIEMBRE.xlsm');
  assert.equal(v.fecha_vigencia, '2026-10-15');
  assert.equal(v.pie_legal, 'Válido para el evento CIDEL.');
  assert.equal(v.aplicar_a_todos, 0);
  assert.equal(v.items_con_precio, 4);
  assert.equal(v.items_sin_precio, 4, 'CE-200, MC-43, SIN y TV-50P (no estaba en el archivo)');

  assert.deepEqual(precioGuardado(v.id, 'CE-100'), { sae: 1200, estado_precio: 'ok', pase_parche: null, porcentaje: null });
  assert.equal(precioGuardado(v.id, 'PB-1').sae, 2500);
  assert.equal(precioGuardado(v.id, 'TV-43').sae, 300000, 'se usa el valor del archivo tal cual, no el 100% de siempre');
  assert.deepEqual(precioGuardado(v.id, 'CE-200'), { sae: null, estado_precio: 'sin_precio', pase_parche: null, porcentaje: null });
  assert.equal(precioGuardado(v.id, 'SIN').estado_precio, 'sin_precio', 'vino en 0: no se inventa un precio');

  // El token no se puede reutilizar, y una previsualización de otro admin no se mezcla
  assert.equal((await api('admin1', 'POST', '/versiones/importar/confirmar', { token: previa.token })).status, 410);

  // Aparece en el listado general de versiones como cualquier otra, y se puede exportar a PDF
  assert.ok((await api('admin1', 'GET', '/versiones')).cuerpo.some((x) => x.id === v.id && x.nombre === 'CIDEL'));
  const pdf = await fetch(`${base}/api/catalogo/versiones/${v.id}/pdf`, { headers: { cookie: cookies.admin1 } });
  assert.equal(pdf.status, 200);
});

test('una versión importada es de sólo lectura: no se le puede cambiar el porcentaje ni recalcular, pero sí el nombre y la vigencia', async () => {
  const previa = (await subir('admin1', excelListaCidel(), { nombre: 'CIDEL 2' })).cuerpo;
  const v = (await api('admin1', 'POST', '/versiones/importar/confirmar', { token: previa.token })).cuerpo;

  const r1 = await api('admin1', 'PUT', `/versiones/${v.id}`, { porcentaje_global: 0.5 });
  assert.equal(r1.status, 400);
  assert.match(r1.cuerpo.error, /importada de "CIDEL - SEPTIEMBRE\.xlsm"/);

  const r2 = await api('admin1', 'POST', `/versiones/${v.id}/recalcular`);
  assert.equal(r2.status, 400);
  assert.match(r2.cuerpo.error, /importada de "CIDEL - SEPTIEMBRE\.xlsm"/);

  const renombrada = await api('admin1', 'PUT', `/versiones/${v.id}`, { nombre: 'CIDEL Septiembre' });
  assert.equal(renombrada.status, 200);
  assert.equal(renombrada.cuerpo.nombre, 'CIDEL Septiembre');

  // La vigencia sí se puede corregir después: no cambia ningún precio, es sólo el texto del PDF
  const conVigencia = await api('admin1', 'PUT', `/versiones/${v.id}`, { fecha_vigencia: '2026-10-16' });
  assert.equal(conVigencia.status, 200);
  assert.equal(conVigencia.cuerpo.fecha_vigencia, '2026-10-16');
});

test('el nombre de la columna de precio puede ser cualquiera que empiece con "SAE" (por ejemplo de otro evento)', async () => {
  const previa = (await subir('admin1', excelListaCidel({ columnaPrecio: 'SAE OTRO EVENTO' }), { nombre: 'Otro evento' })).cuerpo;
  assert.equal(previa.columna_precio, 'SAE OTRO EVENTO');
});
