const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-imp-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');

const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const baseService = require('../src/services/catalogoBaseService');
const { sembrarCatalogoDePrueba } = require('./helpers/catalogoDePrueba');

let servidor;
let base;
const cookies = {};

const ENCABEZADO = [null, 'GRUPO', 'CODIGO', 'DESCRIPCION', 'UNIDAD', '$ ORIGINAL', '$ ACT.', '$ CLIENTE'];
const fila = (codigo, cliente, descripcion = `Desc ${codigo}`) => [null, 'SISTEMA', codigo, descripcion, 'c/u', 1, 2, cliente];

function excelDeBase(filas, { hoja = 'BDatos', encabezado = ENCABEZADO } = {}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], encabezado, ...filas]), hoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Base nueva: CE-100 sube a 2000 (+100 %), PB-1 desaparece, hay códigos nuevos, un texto, un duplicado y una fila sin código.
const BASE_NUEVA = () =>
  excelDeBase([
    fila('CE-100', 2000),
    fila('NUEVO-1', 5000, 'Un código nuevo'),
    fila('NUEVO-2', 'S / P'),
    fila('ce-100 ', 9999),
    [null, 'X', null, 'sin código', 'c/u', 1, 2, 777],
  ]);

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

async function subir(usuario, buffer, nombre = 'base.xlsx', campo = 'archivo') {
  const formulario = new FormData();
  if (buffer) formulario.append(campo, new Blob([buffer]), nombre);
  return json(await fetch(`${base}/api/catalogo/importar`, { method: 'POST', headers: { cookie: cookies[usuario] }, body: formulario }));
}

const sae = (codigo) => db.prepare('SELECT sae, estado_precio FROM catalogo_items WHERE codigo = ?').get(codigo);
const contar = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;
const archivosDeBackup = () => (fs.existsSync(process.env.BACKUPS_DIR) ? fs.readdirSync(process.env.BACKUPS_DIR).filter((f) => f.endsWith('.db')) : []);

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol] of [['admin1', 'admin'], ['admin2', 'admin'], ['oper1', 'operador']]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES (?, ?, ?)').run(nombre, hash, rol);
  }
  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const u of ['admin1', 'admin2', 'oper1']) await iniciarSesion(u);
  // Una versión de evento que también se va a ver afectada
  await api('admin1', 'POST', '/versiones', { nombre: 'Feria', porcentaje_global: 0.55 });
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('archivos inválidos: cada problema tiene su mensaje claro en español', async () => {
  const esperar = async (respuesta, patron) => {
    assert.equal(respuesta.status, 400);
    assert.match(respuesta.cuerpo.error, patron);
  };
  await esperar(await subir('admin1', null), /Falta el archivo/);
  await esperar(await subir('admin1', Buffer.from('a;b\n1;2'), 'base.csv'), /planilla de Excel/);
  await esperar(await subir('admin1', excelDeBase([fila('A', 1)], { hoja: 'Otra' })), /no tiene una hoja "BDatos".*Otra/);
  await esperar(await subir('admin1', excelDeBase([fila('A', 1)], { encabezado: [null, 'GRUPO', 'CÓDIGO', 'DESCRIPCION', 'UNIDAD', 'x', 'y', 'PRECIO'] })), /"CODIGO" y "\$ CLIENTE"/);
  await esperar(await subir('admin1', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64, 7)])), /No se pudo leer el archivo|hoja "BDatos"/);
  assert.equal((await subir('oper1', BASE_NUEVA())).status, 403, 'sólo admin');
  assert.equal(baseService._pendientes.size, 0, 'ninguno de los rechazados dejó una previsualización pendiente');
});

test('previsualizar: calcula todo y NO guarda nada', async () => {
  const antes = { general: sae('CE-100'), importaciones: contar('catalogo_importaciones'), base: contar('catalogo_base_precios'), fotos: contar('catalogo_version_precios') };
  const r = await subir('admin1', BASE_NUEVA(), 'BASE PARCHE nueva.xlsx');
  assert.equal(r.status, 200);
  const p = r.cuerpo;

  assert.ok(p.token);
  assert.equal(p.archivo, 'BASE PARCHE nueva.xlsx');
  assert.ok(new Date(p.vence_en) > new Date());

  // Qué cambió, con variación %, ordenado por lo que más se movió
  const ce100 = p.cambios.find((c) => c.codigo === 'CE-100');
  assert.deepEqual([ce100.pase_anterior, ce100.pase_nuevo, ce100.sae_anterior, ce100.sae_nuevo, ce100.variacion_pct, ce100.destacado], [1000, 2000, 1400, 2800, 100, true]);
  for (const derivado of ['CE-150', 'CE-200', 'MC-43']) assert.ok(p.cambios.some((c) => c.codigo === derivado), `${derivado} depende de CE-100 y también cambia`);
  assert.equal(p.cambios.find((c) => c.codigo === 'CE-150').sae_nuevo, 4200);
  assert.equal(p.cambios.find((c) => c.codigo === 'MC-43').sae_nuevo, 5000);
  assert.ok(!p.cambios.some((c) => c.codigo === 'TV-43'), 'los precios manuales no se tocan al reimportar');
  assert.equal(p.umbral_variacion_pct, 50);

  // Códigos del catálogo que ya no están en la base (alerta, no error mudo)
  assert.deepEqual(p.codigos_desaparecidos.map((d) => d.codigo), ['PB-1']);
  const pb1 = p.cambios.find((c) => c.codigo === 'PB-1');
  assert.equal(pb1.estado_nuevo, 'error');
  assert.equal(pb1.motivo_nuevo, 'codigo_base_inexistente');

  // Ítems que quedaron sin precio (los que ya estaban sin precio también figuran, marcados)
  const sinPrecio = Object.fromEntries(p.items_sin_precio.map((s) => [s.codigo, s]));
  assert.equal(sinPrecio['PB-1'].tenia_precio, true);
  assert.match(sinPrecio['PB-1'].motivo_texto, /no existe en la base parche/);
  assert.equal(sinPrecio.SIN.tenia_precio, false);
  assert.equal(p.resumen.itemsQuePerdieronPrecio, 1);

  // Informativo: códigos nuevos en la base que no están en el catálogo
  assert.deepEqual(p.codigos_nuevos_en_base.map((n) => n.codigo), ['NUEVO-1', 'NUEVO-2']);
  assert.equal(p.codigos_nuevos_en_base[0].cliente, 5000);
  assert.equal(p.codigos_nuevos_en_base[1].cliente, 'S / P');

  // Versiones que quedan afectadas
  const versiones = Object.fromEntries(p.versiones_afectadas.map((v) => [v.nombre, v]));
  assert.ok(versiones.General.items_afectados >= 5);
  assert.ok(versiones.Feria.items_afectados >= 5);
  assert.equal(p.resumen.versionesAfectadas, 2);

  // Advertencias del archivo
  assert.deepEqual(p.advertencias.codigos_repetidos_en_el_archivo, [{ codigo: 'CE-100', filas: [3, 6] }]);
  assert.equal(p.advertencias.filas_con_precio_y_sin_codigo, 1);
  assert.equal(p.advertencias.valores_de_la_base.textos, 1);

  assert.equal(p.resumen.itemsEvaluados, 8);
  assert.equal(p.resumen.itemsConCambios + p.resumen.itemsSinCambios, 8);
  assert.equal(p.resumen.variacionesGrandes, p.cambios.filter((c) => c.destacado).length);

  // No se escribió nada
  assert.deepEqual(sae('CE-100'), antes.general);
  assert.equal(contar('catalogo_importaciones'), antes.importaciones);
  assert.equal(contar('catalogo_base_precios'), antes.base);
  assert.equal(contar('catalogo_version_precios'), antes.fotos);
  assert.equal(archivosDeBackup().length, 0, 'todavía no hay backup: no se escribió nada');
});

test('confirmar: exige token vigente y del mismo usuario', async () => {
  assert.equal((await api('admin1', 'POST', '/importar/confirmar', {})).status, 400);
  const inexistente = await api('admin1', 'POST', '/importar/confirmar', { token: 'no-existe' });
  assert.equal(inexistente.status, 410);
  assert.match(inexistente.cuerpo.error, /venció o no existe/);

  const [token] = [...baseService._pendientes.keys()];
  const ajeno = await api('admin2', 'POST', '/importar/confirmar', { token });
  assert.equal(ajeno.status, 403);
  assert.match(ajeno.cuerpo.error, /la hizo otro usuario/);
  assert.equal(archivosDeBackup().length, 0);

  // Subir otra previsualización invalida la anterior del mismo usuario
  const otra = (await subir('admin1', BASE_NUEVA())).cuerpo;
  assert.notEqual(otra.token, token);
  assert.equal((await api('admin1', 'POST', '/importar/confirmar', { token })).status, 410);

  // Y una vencida (más de 30 minutos) no se puede confirmar
  baseService._pendientes.get(otra.token).creadoEn = Date.now() - baseService.VIGENCIA_MS - 1000;
  assert.equal((await api('admin1', 'POST', '/importar/confirmar', { token: otra.token })).status, 410);
  assert.equal(contar('catalogo_importaciones'), 1);
});

test('confirmar: backup ANTES de escribir, base nueva guardada, General y versiones recalculadas, y todo registrado', async () => {
  const previa = (await subir('admin1', BASE_NUEVA(), 'BASE PARCHE nueva.xlsx')).cuerpo;
  const antesFeria = db.prepare("SELECT vp.sae FROM catalogo_version_precios vp JOIN catalogo_versiones v ON v.id = vp.version_id JOIN catalogo_items i ON i.id = vp.item_id WHERE v.nombre = 'Feria' AND i.codigo = 'CE-100'").get().sae;
  assert.equal(antesFeria, 1600);

  const r = await api('admin1', 'POST', '/importar/confirmar', { token: previa.token });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.resumen.itemsConCambios, previa.resumen.itemsConCambios);

  // El backup es previo: tiene los precios VIEJOS
  const respaldos = archivosDeBackup();
  assert.equal(respaldos.length, 1);
  const respaldo = new DatabaseSync(path.join(process.env.BACKUPS_DIR, respaldos[0]), { readOnly: true });
  assert.equal(respaldo.prepare("SELECT sae FROM catalogo_items WHERE codigo = 'CE-100'").get().sae, 1400);
  respaldo.close();

  // Precios nuevos en la General y en los ítems que dependen
  assert.deepEqual({ ...sae('CE-100') }, { sae: 2800, estado_precio: 'ok' });
  assert.equal(sae('CE-150').sae, 4200);
  assert.equal(sae('MC-43').sae, 5000);
  assert.equal(sae('TV-43').sae, 355800, 'los manuales no cambian');
  assert.deepEqual({ ...sae('PB-1') }, { sae: null, estado_precio: 'error' }, 'el código que desapareció no queda en $ 0');

  // La foto de la versión de evento también se recalculó (con su 55 %)
  const feria = db.prepare("SELECT vp.sae FROM catalogo_version_precios vp JOIN catalogo_versiones v ON v.id = vp.version_id JOIN catalogo_items i ON i.id = vp.item_id WHERE v.nombre = 'Feria' AND i.codigo = 'CE-100'").get().sae;
  assert.equal(feria, 3100, '2.000 × 1,55');

  // La base nueva quedó guardada (la primera aparición gana) y sirve para recalcular después
  assert.equal(contar('catalogo_base_precios'), 3);
  assert.equal(db.prepare("SELECT cliente_numero FROM catalogo_base_precios WHERE codigo = 'CE-100'").get().cliente_numero, 2000);
  assert.equal(db.prepare("SELECT cliente_texto FROM catalogo_base_precios WHERE codigo = 'NUEVO-2'").get().cliente_texto, 'S / P');

  // Registro con usuario, archivo y reporte
  const historial = (await api('admin1', 'GET', '/importaciones')).cuerpo;
  assert.equal(historial.length, 2);
  assert.equal(historial[0].archivo, 'BASE PARCHE nueva.xlsx');
  assert.equal(historial[0].usuario, 'admin1');
  assert.equal(historial[0].items_afectados, previa.resumen.itemsConCambios);
  const detalle = (await api('admin1', 'GET', `/importaciones/${historial[0].id}`)).cuerpo;
  assert.ok(detalle.resumen.cambios.some((c) => c.codigo === 'CE-100'));

  // El token no se puede reutilizar
  assert.equal((await api('admin1', 'POST', '/importar/confirmar', { token: previa.token })).status, 410);
});

test('después de confirmar, subir la misma base otra vez no encuentra cambios', async () => {
  const p = (await subir('admin1', BASE_NUEVA())).cuerpo;
  assert.equal(p.resumen.itemsConCambios, 0);
  assert.equal(p.resumen.versionesAfectadas, 0);
  assert.deepEqual(p.codigos_desaparecidos.map((d) => d.codigo), ['PB-1'], 'PB-1 sigue sin estar en la base');
});

test('los ítems recalculan con la base guardada: un ítem nuevo con regla base toma su precio de la última importación', async () => {
  const r = await api('admin1', 'POST', '/items', { codigo: 'NUEVO-1', regla: { tipo: 'base' } });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.sae, 7000, '5.000 × 1,4');
  const conTexto = await api('admin1', 'POST', '/items', { codigo: 'NUEVO-2', regla: { tipo: 'base' } });
  assert.equal(conTexto.cuerpo.estado_precio, 'sin_precio');
  assert.equal(conTexto.cuerpo.motivo_precio, 'precio_texto', '"S / P" no se convierte en $ 0');
});

// De acá en adelante, para no perder ítems del catálogo que ya dependen de "base" (NUEVO-1, NUEVO-2), las
// bases de prueba siempre incluyen esos códigos además de CE-100 con un valor nuevo.
const baseConCE100 = (valorCE100) => excelDeBase([fila('CE-100', valorCE100), fila('NUEVO-1', 5000, 'Un código nuevo'), fila('NUEVO-2', 'S / P')]);

// "DD/MM/AAAA" de hoy, calculado acá independiente del código real, sólo para armar el nombre esperado en los tests.
function hoyCortoDeTest() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(hoy.getDate())}/${dos(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

test('confirmar con cambios reales guarda sola una versión del historial con los precios de ANTES, y no la toca al recalcular', async () => {
  // Una versión del historial guardada a mano, para comprobar que confirmar una base nueva tampoco la toca a ella.
  const general = (await api('admin1', 'GET', '/versiones')).cuerpo.find((v) => v.es_general === 1);
  const idCE100 = db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'CE-100'").get().id;
  const manual = (await api('admin1', 'POST', `/versiones/${general.id}/duplicar`, { nombre: 'Guardada a mano antes del test' })).cuerpo;
  const precioManualAntes = db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(manual.id, idCE100).sae;

  const antes = { sae: sae('CE-100').sae, versiones: contar('catalogo_versiones') };
  const previa = (await subir('admin1', baseConCE100(3000), 'BASE con más cambios.xlsx')).cuerpo;
  assert.ok(previa.resumen.itemsConCambios > 0);
  // La versión guardada a mano no cuenta como afectada: es una foto fija, no se va a recalcular.
  assert.equal(previa.versiones_afectadas.some((v) => v.id === manual.id), false);

  const r = await api('admin1', 'POST', '/importar/confirmar', { token: previa.token });
  assert.equal(r.status, 200);

  // Se guardó sola una foto de cómo estaba la General ANTES de este cambio
  assert.ok(r.cuerpo.historial_version, 'la respuesta de confirmar dice qué versión se guardó');
  assert.match(r.cuerpo.historial_version.nombre, new RegExp(`^General ${hoyCortoDeTest().replace(/\//g, '\\/')}`));
  assert.equal(contar('catalogo_versiones'), antes.versiones + 1, 'una versión nueva: el historial automático (la guardada a mano ya estaba contada)');

  const autoGuardada = db.prepare('SELECT * FROM catalogo_versiones WHERE id = ?').get(r.cuerpo.historial_version.id);
  assert.equal(autoGuardada.es_historial, 1);
  const precioAutoGuardado = db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(autoGuardada.id, idCE100).sae;
  assert.equal(precioAutoGuardado, antes.sae, 'el historial quedó con el precio de ANTES de este cambio, no con el nuevo');
  assert.notEqual(sae('CE-100').sae, antes.sae, 'mientras que la General sí cambió');

  // La guardada a mano tampoco se tocó
  assert.equal(db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(manual.id, idCE100).sae, precioManualAntes);

  // El historial de importaciones enlaza a la versión que se guardó
  const historialImportaciones = (await api('admin1', 'GET', '/importaciones')).cuerpo;
  assert.equal(historialImportaciones[0].historial_version_id, autoGuardada.id);
  assert.equal(historialImportaciones[0].historial_version_nombre, autoGuardada.nombre);

  // Y se puede exportar / renombrar / usar como cualquier otra versión
  assert.equal((await api('admin1', 'PUT', `/versiones/${autoGuardada.id}`, { nombre: 'Lista antes del cambio grande' })).status, 200);
});

test('confirmar sin cambios reales no guarda un historial nuevo (no tiene sentido una foto igual a la que ya había)', async () => {
  const antes = contar('catalogo_versiones');
  const valorActual = db.prepare("SELECT cliente_numero FROM catalogo_base_precios WHERE codigo = 'CE-100'").get().cliente_numero;
  const previa = (await subir('admin1', baseConCE100(valorActual))).cuerpo;
  assert.equal(previa.resumen.itemsConCambios, 0, 'es la misma base que ya está guardada');

  const r = await api('admin1', 'POST', '/importar/confirmar', { token: previa.token });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.historial_version, null);
  assert.equal(contar('catalogo_versiones'), antes);
  assert.equal((await api('admin1', 'GET', '/importaciones')).cuerpo[0].historial_version_id, null);
});

test('si ya existe una versión con el nombre automático de hoy, el historial se guarda con "(2)" y no pisa a la que ya había', async () => {
  const nombreDeHoy = `General ${hoyCortoDeTest()}`;
  const general = (await api('admin1', 'GET', '/versiones')).cuerpo.find((v) => v.es_general === 1);
  // Si ya existe (por el test anterior, con otro nombre) esto la crea igual, con otro nombre exacto.
  await api('admin1', 'POST', `/versiones/${general.id}/duplicar`, { nombre: nombreDeHoy });

  const previa = (await subir('admin1', baseConCE100(3500))).cuerpo;
  assert.ok(previa.resumen.itemsConCambios > 0);
  const r = await api('admin1', 'POST', '/importar/confirmar', { token: previa.token });

  assert.notEqual(r.cuerpo.historial_version.nombre, nombreDeHoy, 'no puede repetir el nombre que ya existía');
  assert.match(r.cuerpo.historial_version.nombre, /\(2\)$/);
});
