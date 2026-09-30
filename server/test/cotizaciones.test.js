const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-cot-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.SAE_IMPORT_DIR = path.join(carpeta, 'excel-vacio'); // el import automático mira una carpeta vacía
fs.mkdirSync(process.env.SAE_IMPORT_DIR);

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const cot = require('../src/services/cotizacionesService');
const { escanear } = require('../src/services/excelImportService');
const { sembrarCatalogoDePrueba } = require('./helpers/catalogoDePrueba');

let servidor;
let base;
const cookies = {};
let eventoUno;
let eventoDos;
let eventoConDatos;

async function iniciarSesion(usuario) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: usuario, password: 'clave' }) });
  cookies[usuario] = res.headers.get('set-cookie').split(';')[0];
}

/** Llama a cualquier ruta de /api como `usuario` y devuelve { status, cuerpo, res }. */
async function llamar(usuario, metodo, ruta, cuerpo) {
  const res = await fetch(`${base}/api${ruta}`, {
    method: metodo,
    headers: { ...(cookies[usuario] ? { cookie: cookies[usuario] } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, cuerpo: json, res };
}

const api = (usuario, metodo, ruta, cuerpo) => llamar(usuario, metodo, `/cotizaciones${ruta}`, cuerpo);
const idDe = (codigo) => db.prepare('SELECT id FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(codigo).id;

/** Presupuesto con datos completos y listo para confirmar. */
async function nuevaCompleta(extra = {}) {
  const { cuerpo } = await api('oper1', 'POST', '', { evento_id: eventoUno, tipo: 'SAE', lote: '12', nombre_stand: 'STAND NORTE', razon_social: 'ACME SA', ...extra });
  return cuerpo;
}

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

async function pdfDe(usuario, id, consulta = '') {
  const res = await fetch(`${base}/api/cotizaciones/${id}/pdf${consulta}`, { headers: { cookie: cookies[usuario] } });
  return { status: res.status, res, buffer: Buffer.from(await res.arrayBuffer()) };
}

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  const nuevoUsuario = (nombre, rol, soloEstado, completo) =>
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol, solo_estado, nombre_completo) VALUES (?, ?, ?, ?, ?)').run(nombre, hash, rol, soloEstado, completo);
  nuevoUsuario('admin1', 'admin', 0, 'Admin Uno');
  nuevoUsuario('oper1', 'operador', 0, 'Oper Uno');
  nuevoUsuario('estado1', 'operador', 1, null);
  nuevoUsuario('oper2', 'operador', 0, null);
  nuevoUsuario('ana1', 'operador', 0, 'Ana Torres'); // termina en s
  nuevoUsuario('pedro1', 'operador', 0, 'Pedro Gomez'); // termina en z
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;

  const evento = (nombre) => Number(db.prepare("INSERT INTO eventos (nombre, lugar, fecha_inicio, fecha_fin, creado_por) VALUES (?, 'Predio', '2026-10-10', '2026-10-12', ?)").run(nombre, admin).lastInsertRowid);
  eventoUno = evento('CAPPER');
  eventoDos = evento('OTRA EXPO');
  eventoConDatos = evento('FIT');

  // Un presupuesto que viene de Excel, para comprobar que nada de lo nuevo lo toca
  const lote = Number(db.prepare("INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, '5', 'EXPOSITOR VIEJO')").run(eventoConDatos).lastInsertRowid);
  const prod = Number(db.prepare("INSERT INTO productos (codigo, nombre, rubro) VALUES ('CE-100', 'Cenefa 1 m (de Excel)', 'SISTEMA')").run().lastInsertRowid);
  const pres = Number(
    db
      .prepare("INSERT INTO presupuestos (lote_id, numero, fecha, cliente_nombre, monto_total, confirmado, estado, origen, ruta_archivo, archivo_activo) VALUES (?, '1', '2026-09-01', 'CLIENTE EXCEL', 1210, 1, 'pendiente_facturar', 'excel', 'C:/x/a.xlsm', 1)")
      .run(lote).lastInsertRowid
  );
  db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, 1, 1000)').run(pres, prod);

  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const u of ['admin1', 'oper1', 'oper2', 'estado1', 'ana1', 'pedro1']) await iniciarSesion(u);
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------------------------

test('ID de cliente: la misma fórmula del Excel (AE15ST1), en mayúsculas y vacío si falta algún dato', () => {
  assert.equal(cot.generarIdCliente({ evento: 'ATP', tipo: 'SAE', lote: '1', nombre_stand: 'STAND 1', responsable: 'X5' }), 'AE15ST1');
  // C (capper) + O (…PREDIO) + E (…Tigre) + S (…Ayos) + OJ (Ojos…) + 10 (2610)
  assert.equal(cot.generarIdCliente({ evento: 'capper', tipo: 'SAE EN PREDIO', lote: '2610', nombre_stand: 'Ojos del Tigre', responsable: 'Heliana Ayos' }), 'COESOJ10');
  assert.equal(cot.generarIdCliente({ evento: 'ATP', tipo: 'SAE', lote: '', nombre_stand: 'STAND 1', responsable: 'X5' }), null);
  assert.equal(cot.generarIdCliente({ evento: 'ATP', tipo: null, lote: '1', nombre_stand: 'STAND 1', responsable: 'X5' }), null);
  assert.equal(cot.generarIdCliente({ evento: 'ATP', tipo: 'SAE', lote: '1', nombre_stand: '   ', responsable: 'X5' }), null);
  // Los espacios de los bordes no cuentan (el Excel los tomaba como letra)
  assert.equal(cot.generarIdCliente({ evento: ' ATP ', tipo: 'SAE ', lote: ' 1', nombre_stand: 'STAND 1 ', responsable: 'X5 ' }), 'AE15ST1');
  // Acentos y ñ: se cuenta por letra, no por byte
  assert.equal(cot.generarIdCliente({ evento: 'ÑANDÚ', tipo: 'ORGANIZACIÓN', lote: '7', nombre_stand: 'ÁLAMO', responsable: 'Ñ' }), 'ÑNOÑÁL7');
});

test('totales: reproducen el presupuesto real del Excel (subtotal 812.558, IVA 170.637,18, total 983.195,18)', () => {
  const lineas = [
    { cantidad: 6, precio_unitario: 37400 },
    { cantidad: 1, precio_unitario: 92000 },
    { cantidad: 2, precio_unitario: 9179 },
    { cantidad: 2, precio_unitario: 72300 },
    { cantidad: 4, precio_unitario: 83300 },
  ];
  assert.deepEqual(cot.calcularTotales(lineas), {
    subtotal_bruto: 812558,
    descuento_porcentaje: 0,
    descuento: 0,
    subtotal: 812558,
    iva_porcentaje: 0.21,
    iva: 170637.18,
    total: 983195.18,
    lineas_sin_precio: 0,
  });
  assert.deepEqual(cot.calcularTotales([]), {
    subtotal_bruto: 0,
    descuento_porcentaje: 0,
    descuento: 0,
    subtotal: 0,
    iva_porcentaje: 0.21,
    iva: 0,
    total: 0,
    lineas_sin_precio: 0,
  });
  const conFaltante = cot.calcularTotales([{ cantidad: 2, precio_unitario: 100 }, { cantidad: 5, precio_unitario: null }]);
  assert.equal(conFaltante.subtotal, 200);
  assert.equal(conFaltante.lineas_sin_precio, 1, 'una línea sin precio no suma y se cuenta aparte');
  assert.equal(cot.calcularTotales([{ cantidad: 3, precio_unitario: 33.33 }], 0).total, 99.99, 'sin IVA no cambia el neto y redondea a centavos');
});

test('totales: el descuento especial se resta del subtotal ANTES del IVA', () => {
  const lineas = [{ cantidad: 1, precio_unitario: 1000 }];
  const t = cot.calcularTotales(lineas, 0.21, 0.1);
  assert.equal(t.subtotal_bruto, 1000);
  assert.equal(t.descuento_porcentaje, 0.1);
  assert.equal(t.descuento, 100, '10% de descuento sobre 1000');
  assert.equal(t.subtotal, 900, 'el descuento se resta antes del IVA');
  assert.equal(t.iva, 189, '21% de IVA sobre el subtotal YA con descuento (900), no sobre el bruto');
  assert.equal(t.total, 1089);

  assert.equal(cot.calcularTotales(lineas, 0.21, 0).descuento, 0, 'sin descuento, igual que antes');
  assert.equal(cot.calcularTotales(lineas, 0.21).descuento, 0, 'el descuento es opcional (por defecto 0)');
});

test('fechas: vencimiento a 4 días (como el Excel), cruzando mes y año', () => {
  assert.equal(cot.sumarDias('2026-02-03', 4), '2026-02-07');
  assert.equal(cot.sumarDias('2026-01-29', 4), '2026-02-02');
  assert.equal(cot.sumarDias('2026-12-30', 4), '2027-01-03');
  assert.equal(cot.sumarDias('2028-02-27', 4), '2028-03-02', 'año bisiesto');
  assert.match(cot.hoyIso(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------------------------
// Permisos y datos
// ---------------------------------------------------------------------------------------------

test('permisos: sin sesión 401; "solo estado" lee pero no escribe', async () => {
  assert.equal((await api(null, 'GET', '')).status, 401);
  assert.equal((await api('estado1', 'GET', '')).status, 200);
  assert.equal((await api('estado1', 'POST', '', {})).status, 403);
  assert.equal((await api('estado1', 'GET', '/opciones')).status, 200);
});

test('crear un presupuesto vacío: todos los datos son opcionales; el responsable y la fecha se completan solos', async () => {
  const { status, cuerpo } = await api('oper1', 'POST', '', {});
  assert.equal(status, 201);
  assert.equal(cuerpo.estado, 'pendiente');
  assert.equal(cuerpo.responsable, 'Oper Uno', 'nombre completo de quien lo carga');
  assert.equal(cuerpo.fecha_carga, cot.hoyIso());
  assert.equal(cuerpo.fecha_vencimiento, cot.sumarDias(cuerpo.fecha_carga, 4));
  for (const campo of ['evento_id', 'tipo', 'lote', 'nombre_stand', 'contacto', 'mail', 'telefono', 'razon_social', 'cuit', 'direccion', 'id_cliente', 'numero', 'cod_fac', 'notas']) {
    assert.equal(cuerpo[campo], null, campo);
  }
  assert.equal(cuerpo.version_nombre, 'General', 'arranca con la lista General');
  assert.equal(cuerpo.confirmable.ok, false);
  assert.deepEqual(cuerpo.lineas, []);

  // Un usuario sin nombre completo figura con su nombre de usuario
  const sinNombre = (await api('oper2', 'POST', '', {})).cuerpo;
  assert.equal(sinNombre.responsable, 'oper2');
});

test('validaciones: tipo de la lista, evento existente y largos; los textos vacíos quedan en null', async () => {
  assert.equal((await api('oper1', 'POST', '', { tipo: 'INVENTADO' })).status, 400);
  assert.equal((await api('oper1', 'POST', '', { evento_id: 99999 })).status, 400);
  assert.equal((await api('oper1', 'POST', '', { razon_social: 'x'.repeat(201) })).status, 400);
  const ok = (await api('oper1', 'POST', '', { tipo: 'ORGANIZACIÓN', razon_social: '  ACME  ', mail: '   ', cuit: '' })).cuerpo;
  assert.equal(ok.tipo, 'ORGANIZACIÓN');
  assert.equal(ok.razon_social, 'ACME');
  assert.equal(ok.mail, null);
  assert.equal(ok.cuit, null);
  for (const tipo of ['SAE', 'SAE DE ORG', 'SAE EN PREDIO', 'STAND ARTESANAL', 'STAND SISTEMA', 'ORGANIZACIÓN']) {
    assert.equal((await api('oper1', 'POST', '', { tipo })).status, 201, tipo);
  }
});

test('ID de cliente y número: aparecen cuando hay datos, el número es correlativo por cliente y no se mueve al editar otros campos', async () => {
  const a = await nuevaCompleta();
  // C (CAPPER) + E (SAE) + E (STAND NORTE) + O (Oper Uno) + ST (STAND…) + 12 (lote)
  assert.equal(a.id_cliente, 'CEEOST12');
  assert.equal(a.numero, 1);
  assert.equal(a.cod_fac, `${a.id_cliente}-1`);

  const b = await nuevaCompleta();
  assert.equal(b.id_cliente, a.id_cliente, 'mismo cliente → mismo ID');
  assert.equal(b.numero, 2, 'segundo presupuesto de ese cliente');
  assert.equal(b.cod_fac, `${a.id_cliente}-2`);

  const editado = (await api('oper1', 'PUT', `/${b.id}`, { contacto: 'Juan', mail: 'juan@x.com' })).cuerpo;
  assert.equal(editado.numero, 2, 'editar otros datos no cambia el número');

  const otroLote = (await api('oper1', 'PUT', `/${b.id}`, { lote: '99' })).cuerpo;
  assert.notEqual(otroLote.id_cliente, a.id_cliente, 'cambió el lote → otro ID');
  assert.equal(otroLote.numero, 1, 'y arranca su propia numeración');

  const sinLote = (await api('oper1', 'PUT', `/${b.id}`, { lote: null })).cuerpo;
  assert.equal(sinLote.id_cliente, null, 'si falta un dato el ID vuelve a quedar vacío');
  assert.equal(sinLote.numero, null);
});

// ---------------------------------------------------------------------------------------------
// Catálogo e ítems
// ---------------------------------------------------------------------------------------------

test('buscar en el catálogo: por código o descripción, con el precio de la lista; sin precio se avisa', async () => {
  const porCodigo = (await api('oper1', 'GET', '/catalogo/buscar?q=ce-1')).cuerpo;
  assert.deepEqual(porCodigo.map((i) => [i.codigo, i.precio]), [['CE-100', 1400], ['CE-150', 2100]]);
  const porDescripcion = (await api('oper1', 'GET', '/catalogo/buscar?q=desc%20pb')).cuerpo;
  assert.deepEqual(porDescripcion.map((i) => i.codigo), ['PB-1'], 'la descripción de prueba es "Desc PB-1"');
  const sin = (await api('oper1', 'GET', '/catalogo/buscar?q=SIN')).cuerpo.find((i) => i.codigo === 'SIN');
  assert.equal(sin.precio, null);
  assert.ok((await api('oper1', 'GET', '/catalogo/buscar')).cuerpo.length > 0, 'sin texto trae los primeros');
  assert.equal((await api('oper1', 'GET', '/catalogo/buscar?q=%25')).status, 200, 'los comodines no rompen la búsqueda');
});

test('ítems: se copia el precio de la lista, repetir un código suma cantidad, se puede editar el precio y quitar', async () => {
  const p = await nuevaCompleta();
  let r = (await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 3 })).cuerpo;
  assert.equal(r.lineas.length, 1);
  assert.deepEqual([r.lineas[0].codigo, r.lineas[0].cantidad, r.lineas[0].precio_catalogo, r.lineas[0].precio_unitario, r.lineas[0].subtotal], ['CE-100', 3, 1400, 1400, 4200]);
  assert.equal(r.lineas[0].precio_modificado, false);

  r = (await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 2, comentario: 'En blanco' })).cuerpo;
  assert.equal(r.lineas.length, 1, 'el mismo código no duplica la línea');
  assert.equal(r.lineas[0].cantidad, 5);
  assert.equal(r.lineas[0].comentario, 'En blanco');

  r = (await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('PB-1'), cantidad: 1 })).cuerpo;
  assert.deepEqual(r.totales, {
    subtotal_bruto: 9800,
    descuento_porcentaje: 0,
    descuento: 0,
    subtotal: 9800,
    iva_porcentaje: 0.21,
    iva: 2058,
    total: 11858,
    lineas_sin_precio: 0,
  });

  const linea = r.lineas.find((l) => l.codigo === 'CE-100');
  r = (await api('oper1', 'PUT', `/lineas/${linea.id}`, { cantidad: 4, precio_unitario: 1300 })).cuerpo;
  const editada = r.lineas.find((l) => l.codigo === 'CE-100');
  assert.deepEqual([editada.cantidad, editada.precio_unitario, editada.precio_catalogo, editada.precio_modificado], [4, 1300, 1400, true]);
  assert.equal(r.totales.subtotal, 4 * 1300 + 2800);

  r = (await api('oper1', 'DELETE', `/lineas/${linea.id}`)).cuerpo;
  assert.deepEqual(r.lineas.map((l) => l.codigo), ['PB-1']);
});

test('ítems: validaciones (cantidad entera desde 1, ítem existente, precio numérico) y un ítem sin precio impide confirmar', async () => {
  const p = await nuevaCompleta();
  const agregar = (cuerpo) => api('oper1', 'POST', `/${p.id}/lineas`, cuerpo);
  assert.equal((await agregar({ catalogo_item_id: idDe('CE-100'), cantidad: 0 })).status, 400);
  assert.equal((await agregar({ catalogo_item_id: idDe('CE-100'), cantidad: 1.5 })).status, 400);
  assert.equal((await agregar({ catalogo_item_id: idDe('CE-100'), cantidad: 'a' })).status, 400);
  assert.equal((await agregar({ catalogo_item_id: 99999, cantidad: 1 })).status, 400);
  assert.equal((await agregar({ cantidad: 1 })).status, 400);

  const conSin = (await agregar({ catalogo_item_id: idDe('SIN'), cantidad: 1 })).cuerpo;
  assert.equal(conSin.lineas[0].precio_unitario, null);
  assert.equal(conSin.lineas[0].subtotal, null);
  assert.equal(conSin.totales.lineas_sin_precio, 1);
  assert.match(conSin.confirmable.motivos.join(' | '), /Faltan precios en: SIN/);

  const linea = conSin.lineas[0];
  assert.equal((await llamar('oper1', 'PUT', `/cotizaciones/lineas/${linea.id}`, { precio_unitario: -5 })).status, 400);
  assert.equal((await llamar('oper1', 'PUT', `/cotizaciones/lineas/${linea.id}`, { precio_unitario: 'abc' })).status, 400);
  const conPrecio = (await llamar('oper1', 'PUT', `/cotizaciones/lineas/${linea.id}`, { precio_unitario: 500 })).cuerpo;
  assert.equal(conPrecio.lineas[0].precio_unitario, 500, 'el precio se puede cargar a mano');
  assert.equal(conPrecio.confirmable.motivos.some((m) => /precios/.test(m)), false);
});

test('lista de precios: al cambiarla se recalculan los ítems con la lista elegida y se pisa lo editado a mano', async () => {
  const feria = (await llamar('admin1', 'POST', '/catalogo/versiones', { nombre: 'Feria 55', porcentaje_global: 0.55 })).cuerpo;
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 2 });
  const linea = (await api('oper1', 'GET', `/${p.id}`)).cuerpo.lineas[0];
  await llamar('oper1', 'PUT', `/cotizaciones/lineas/${linea.id}`, { precio_unitario: 1 });

  const r = (await api('oper1', 'POST', `/${p.id}/lista`, { version_id: feria.id })).cuerpo;
  assert.equal(r.catalogo_version_id, feria.id);
  assert.equal(r.version_nombre, 'Feria 55');
  assert.equal(r.lineas[0].precio_unitario, 1600, '1000 × 1,55 redondeado a 100');
  assert.equal(r.lineas[0].precio_catalogo, 1600);

  // Un ítem agregado después toma el precio de la lista elegida
  const r2 = (await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('PB-1'), cantidad: 1 })).cuerpo;
  assert.equal(r2.lineas.find((l) => l.codigo === 'PB-1').precio_unitario, 3100, '2000 × 1,55 = 3100');
  assert.equal((await api('oper1', 'GET', `/catalogo/buscar?q=CE-100&version=${feria.id}`)).cuerpo[0].precio, 1600);
  assert.equal((await api('oper1', 'POST', `/${p.id}/lista`, { version_id: 99999 })).status, 400);
});

test('un presupuesto nuevo puede pasar a usar una lista del historial de la General antes de cargar ítems', async () => {
  const general = (await llamar('admin1', 'GET', '/catalogo/versiones')).cuerpo.find((v) => v.es_general === 1);
  const historial = (await llamar('admin1', 'POST', `/catalogo/versiones/${general.id}/duplicar`, { nombre: 'Lista guardada para el test' })).cuerpo;
  assert.equal(historial.es_historial, 1);

  const p = await nuevaCompleta();
  assert.equal(p.catalogo_version_id, general.id, 'un presupuesto arranca en la General');

  const r = (await api('oper1', 'POST', `/${p.id}/lista`, { version_id: historial.id })).cuerpo;
  assert.equal(r.catalogo_version_id, historial.id);
  assert.equal(r.version_nombre, 'Lista guardada para el test');
  assert.deepEqual(r.lineas, [], 'todavía no tenía ítems: sólo se fija la lista');

  // Un ítem agregado después de elegir la lista toma el precio de esa lista (la del historial), no el de la General
  const esperado = (await api('oper1', 'GET', `/catalogo/buscar?q=CE-100&version=${historial.id}`)).cuerpo[0].precio;
  const r2 = (await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 })).cuerpo;
  assert.equal(r2.lineas[0].precio_unitario, esperado);
  assert.equal(r2.lineas[0].precio_catalogo, esperado);
});

// ---------------------------------------------------------------------------------------------
// Aislamiento: lo pendiente no existe para el resto de la app
// ---------------------------------------------------------------------------------------------

test('mientras están pendientes, los presupuestos nuevos no cambian nada de lo que ya existe', async () => {
  const rutas = ['/eventos', `/eventos/${eventoConDatos}`, `/eventos/${eventoConDatos}/totales`, `/eventos/${eventoConDatos}/facturacion`, `/eventos/${eventoUno}`, `/eventos/${eventoUno}/facturacion`, '/presupuestos', '/presupuestos?confirmado=0', '/presupuestos/alertas', '/productos', '/importaciones/estado', '/importaciones/pendientes'];
  const foto = async () => Object.fromEntries(await Promise.all(rutas.map(async (r) => [r, JSON.stringify((await llamar('admin1', 'GET', r)).cuerpo)])));
  const antes = await foto();
  const contadores = () => ({ ...db.prepare('SELECT (SELECT COUNT(*) FROM presupuestos) p, (SELECT COUNT(*) FROM lotes) l, (SELECT COUNT(*) FROM productos) pr, (SELECT COUNT(*) FROM presupuesto_lineas) pl').get() });
  const filasAntes = contadores();

  for (const evento of [eventoUno, eventoConDatos, eventoDos]) {
    const p = await nuevaCompleta({ evento_id: evento, lote: '5' });
    await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-150'), cantidad: 7 });
  }

  assert.deepEqual(await foto(), antes, 'ninguna pantalla existente cambió');
  assert.deepEqual(contadores(), filasAntes, 'ni lotes, ni presupuestos, ni productos, ni líneas');
});

// ---------------------------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------------------------

test('confirmar: pide lote e ítems con precio, y dice qué falta', async () => {
  const vacio = (await api('oper1', 'POST', '', {})).cuerpo;
  let r = await api('oper1', 'POST', `/${vacio.id}/confirmar`);
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /Falta elegir el evento/);
  assert.match(r.cuerpo.error, /Falta el número de stand/);
  assert.match(r.cuerpo.error, /no tiene ítems/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM presupuestos WHERE origen = ?').get('app').n, 0, 'no se creó nada');

  assert.equal((await api('estado1', 'POST', `/${vacio.id}/confirmar`)).status, 403);
});

test('confirmar: pasa a ser un presupuesto normal del evento, con todo lo que ya funcionaba', async () => {
  const p = await nuevaCompleta({ contacto: 'Ana', mail: 'ana@acme.com', notas: 'Entrega el viernes' });
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 3 });
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-150'), cantidad: 2, comentario: 'Negra' });
  const listo = (await api('oper1', 'GET', `/${p.id}`)).cuerpo;
  assert.equal(listo.confirmable.ok, true);
  assert.deepEqual([listo.totales.subtotal, listo.totales.iva, listo.totales.total], [8400, 1764, 10164]);

  assert.deepEqual((await llamar('admin1', 'GET', `/eventos/${eventoUno}/facturacion`)).cuerpo, [], 'antes de confirmar el evento no factura nada');
  const r = await api('oper1', 'POST', `/${p.id}/confirmar`);
  assert.equal(r.status, 200);
  const c = r.cuerpo;
  assert.equal(c.estado, 'confirmada');
  assert.ok(c.presupuesto_id);
  assert.equal(c.presupuesto.id, c.presupuesto_id);
  assert.deepEqual((await api('oper1', 'GET', `?presupuestoId=${c.presupuesto_id}`)).cuerpo.map((x) => x.id), [c.id], 'desde el presupuesto del evento se llega al presupuesto original');
  assert.deepEqual((await api('oper1', 'GET', '?presupuestoId=99999')).cuerpo, []);

  const pres = db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(c.presupuesto_id);
  assert.equal(pres.origen, 'app');
  assert.equal(pres.confirmado, 1);
  assert.equal(pres.estado, 'pendiente_facturar');
  assert.equal(pres.numero, String(c.numero));
  assert.equal(pres.fecha, c.fecha_carga);
  assert.equal(pres.cliente_nombre, 'ACME SA');
  assert.equal(pres.cliente_contacto, 'Ana - ana@acme.com');
  assert.equal(pres.monto_total, c.totales.total, 'el monto es el TOTAL con IVA, como el del Excel');
  assert.equal(pres.ruta_archivo, null);
  assert.match(pres.notas, /Entrega el viernes/);

  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(pres.lote_id);
  assert.deepEqual([lote.evento_id, lote.codigo, lote.expositor], [eventoUno, '12', 'STAND NORTE']);

  const lineas = db.prepare('SELECT pl.cantidad, pl.precio_unitario, pl.comentario, prod.codigo, prod.nombre FROM presupuesto_lineas pl JOIN productos prod ON prod.id = pl.producto_id WHERE pl.presupuesto_id = ? ORDER BY prod.codigo').all(pres.id);
  assert.deepEqual(lineas.map((l) => [l.codigo, l.cantidad, l.precio_unitario, l.comentario]), [['CE-100', 3, 1400, null], ['CE-150', 2, 2100, 'Negra']]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM productos WHERE LOWER(codigo) = 'ce-100'").get().n, 1, 'se reutiliza el producto que ya existía');
  assert.equal(lineas[1].nombre, 'Desc CE-150', 'el producto que no existía se crea con la descripción del catálogo');

  // Ahora sí lo ven el resto de las pantallas
  const listado = (await llamar('admin1', 'GET', '/presupuestos')).cuerpo.filter((x) => x.origen === 'app');
  assert.equal(listado.length, 1);
  assert.equal(listado[0].evento_nombre, 'CAPPER');
  const facturacion = (await llamar('admin1', 'GET', `/eventos/${eventoUno}/facturacion`)).cuerpo;
  assert.deepEqual(facturacion.map((r) => [r.rubro, r.subtotal]), [['SISTEMA', 8400]], 'la facturación del evento ya lo cuenta: 3×1.400 + 2×2.100, sin IVA');
  const detalle = (await llamar('admin1', 'GET', `/eventos/${eventoUno}`)).cuerpo;
  assert.equal(detalle.lotes.length, 1);
  assert.equal(detalle.lotes[0].presupuestos[0].lineas.length, 2);
});

test('un presupuesto confirmado queda cerrado (se cambia dentro del evento) y no se puede confirmar dos veces', async () => {
  const p = await nuevaCompleta({ lote: '77' });
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('PB-1'), cantidad: 1 });
  const antes = db.prepare('SELECT COUNT(*) n FROM presupuestos').get().n;
  const c = (await api('oper1', 'POST', `/${p.id}/confirmar`)).cuerpo;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM presupuestos').get().n, antes + 1);

  assert.equal((await api('oper1', 'POST', `/${p.id}/confirmar`)).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM presupuestos').get().n, antes + 1, 'la segunda vez no duplica');
  assert.equal((await api('oper1', 'PUT', `/${p.id}`, { contacto: 'X' })).status, 409);
  assert.equal((await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 })).status, 409);
  assert.equal((await api('oper1', 'POST', `/${p.id}/lista`, { version_id: 1 })).status, 409);
  assert.equal((await api('oper1', 'DELETE', `/${p.id}`)).status, 409);
  assert.equal((await llamar('oper1', 'PUT', `/cotizaciones/lineas/${c.lineas[0].id}`, { cantidad: 9 })).status, 409);
  assert.equal((await llamar('oper1', 'DELETE', `/cotizaciones/lineas/${c.lineas[0].id}`)).status, 409);
  assert.equal((await api('oper1', 'GET', `/${p.id}`)).cuerpo.estado, 'confirmada');
});

test('dos presupuestos del mismo stand van al mismo lote del evento (no se duplica el lote)', async () => {
  const uno = await nuevaCompleta({ lote: '31', nombre_stand: 'MISMO STAND' });
  const dos = await nuevaCompleta({ lote: '31', nombre_stand: 'MISMO STAND' });
  for (const p of [uno, dos]) await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-200'), cantidad: 1 });
  const lotesAntes = db.prepare('SELECT COUNT(*) n FROM lotes').get().n;
  const a = (await api('oper1', 'POST', `/${uno.id}/confirmar`)).cuerpo;
  const b = (await api('oper1', 'POST', `/${dos.id}/confirmar`)).cuerpo;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lotes').get().n, lotesAntes + 1);
  assert.equal(db.prepare('SELECT lote_id FROM presupuestos WHERE id = ?').get(a.presupuesto_id).lote_id, db.prepare('SELECT lote_id FROM presupuestos WHERE id = ?').get(b.presupuesto_id).lote_id);
});

test('el import automático de Excel no toca los presupuestos de la app (y sí borra los de Excel cuyo archivo ya no está en la carpeta)', () => {
  const cuenta = (origen) => db.prepare('SELECT COUNT(*) n FROM presupuestos WHERE origen = ?').get(origen).n;
  const deLaApp = cuenta('app');
  assert.ok(deLaApp >= 3, 'hay presupuestos de la app confirmados');
  assert.equal(cuenta('excel'), 1, 'y el de Excel del que se partió');

  const { resumen } = escanear(); // la carpeta de Excel está vacía
  assert.equal(resumen.huerfanos, 1);
  assert.equal(resumen.borrados, 1, 'el de Excel, sin archivo, se borra: así funciona el import');
  assert.equal(cuenta('excel'), 0);
  assert.equal(cuenta('app'), deLaApp, 'los de la app siguen todos');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM presupuestos WHERE origen = 'app' AND archivo_activo = 0").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM presupuesto_lineas pl JOIN presupuestos p ON p.id = pl.presupuesto_id WHERE p.origen = 'app'").get().n >= 4, true, 'con sus líneas');
});

// ---------------------------------------------------------------------------------------------
// Duplicar y eliminar
// ---------------------------------------------------------------------------------------------

test('duplicar copia los datos y los ítems como un presupuesto nuevo, con el mismo responsable que el original', async () => {
  const origen = await nuevaCompleta({ contacto: 'Ana' });
  await api('oper1', 'POST', `/${origen.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 2, comentario: 'Gris' });
  const linea = (await api('oper1', 'GET', `/${origen.id}`)).cuerpo.lineas[0];
  await llamar('oper1', 'PUT', `/cotizaciones/lineas/${linea.id}`, { precio_unitario: 1200 });

  const copia = (await api('admin1', 'POST', `/${origen.id}/duplicar`)).cuerpo;
  assert.notEqual(copia.id, origen.id);
  assert.equal(copia.estado, 'pendiente');
  assert.equal(copia.responsable, 'Oper Uno', 'el responsable es el del original (forma parte del ID de cliente)');
  assert.equal(db.prepare('SELECT creado_por FROM cotizaciones WHERE id = ?').get(copia.id).creado_por, db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id, 'y queda registrado quién lo duplicó');
  assert.equal(copia.contacto, 'Ana');
  assert.equal(copia.razon_social, 'ACME SA');
  assert.deepEqual(copia.lineas.map((l) => [l.codigo, l.cantidad, l.precio_unitario, l.comentario]), [['CE-100', 2, 1200, 'Gris']]);
  assert.equal(copia.id_cliente, origen.id_cliente, 'mismos datos → mismo ID de cliente');
  assert.ok(copia.numero > origen.numero, 'y el siguiente número de ese cliente');
  assert.equal((await api('oper1', 'GET', `/${origen.id}`)).cuerpo.lineas.length, 1, 'el original queda igual');

  const confirmadaId = db.prepare("SELECT id FROM cotizaciones WHERE estado = 'confirmada' LIMIT 1").get().id;
  const deConfirmada = (await api('oper1', 'POST', `/${confirmadaId}/duplicar`)).cuerpo;
  assert.equal(deConfirmada.estado, 'pendiente', 'se puede partir de uno confirmado');
});

test('duplicar siempre pasa al siguiente número de presupuesto, aunque lo duplique otra persona', async () => {
  const datos = { evento_id: eventoUno, tipo: 'SAE', lote: '88', nombre_stand: 'STAND DUP', razon_social: 'DUPLICADOS SA' };
  const original = (await api('ana1', 'POST', '', datos)).cuerpo;
  assert.equal(original.numero, 1);

  // Lo duplica otra persona, cuyo nombre termina en otra letra: el ID de cliente (que usa la última letra
  // del responsable) no debe cambiar, o la numeración volvería a empezar en 1.
  const copia = (await api('pedro1', 'POST', `/${original.id}/duplicar`)).cuerpo;
  assert.equal(copia.id_cliente, original.id_cliente, 'mismo ID de cliente');
  assert.equal(copia.numero, 2, 'el siguiente número');
  assert.equal(copia.cod_fac, `${original.id_cliente}-2`);
  assert.equal(copia.responsable, 'Ana Torres', 'sigue a nombre del responsable original, que es parte del ID de cliente');
  assert.equal(db.prepare('SELECT creado_por FROM cotizaciones WHERE id = ?').get(copia.id).creado_por, db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'pedro1'").get().id, 'pero queda registrado quién lo duplicó');

  // Duplicar el duplicado (lo hace un tercero) sigue la cadena
  const tercera = (await api('oper1', 'POST', `/${copia.id}/duplicar`)).cuerpo;
  assert.deepEqual([tercera.id_cliente, tercera.numero], [original.id_cliente, 3]);

  // Y si se duplica uno ya confirmado, también
  db.prepare("UPDATE cotizaciones SET estado = 'confirmada' WHERE id = ?").run(original.id);
  assert.equal((await api('pedro1', 'POST', `/${original.id}/duplicar`)).cuerpo.numero, 4);
});

test('eliminar: un pendiente se borra con sus ítems; uno confirmado no', async () => {
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 });
  assert.equal((await api('oper1', 'DELETE', `/${p.id}`)).status, 200);
  assert.equal((await api('oper1', 'GET', `/${p.id}`)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizacion_lineas WHERE cotizacion_id = ?').get(p.id).n, 0);
  assert.equal((await api('estado1', 'DELETE', `/${p.id}`)).status, 403);
});

test('rechazar: lo marca de sólo lectura sin borrarlo; reabrir lo vuelve a pendiente y editable', async () => {
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 });

  assert.equal((await api('estado1', 'POST', `/${p.id}/rechazar`)).status, 403);
  const r = await api('oper1', 'POST', `/${p.id}/rechazar`);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.estado, 'rechazada');
  assert.ok(r.cuerpo.rechazada_en);
  const fila = db.prepare('SELECT estado, rechazada_por, rechazada_en FROM cotizaciones WHERE id = ?').get(p.id);
  assert.equal(fila.estado, 'rechazada');
  assert.ok(fila.rechazada_por, 'queda registrado quién lo rechazó');

  // Sigue existiendo (no se borró) y aparece al listar por ese estado, pero de sólo lectura
  assert.equal((await api('oper1', 'GET', `/${p.id}`)).status, 200);
  assert.deepEqual((await api('oper1', 'GET', '?estado=rechazada')).cuerpo.map((c) => c.id), [p.id]);
  let e = await api('oper1', 'PUT', `/${p.id}`, { notas: 'no debería guardar' });
  assert.equal(e.status, 409);
  assert.match(e.cuerpo.error, /rechazado/);
  e = await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-150'), cantidad: 1 });
  assert.equal(e.status, 409);
  e = await api('oper1', 'POST', `/${p.id}/confirmar`);
  assert.equal(e.status, 409);

  // Se puede borrar desde rechazado (no hace falta reabrirlo primero)
  const otro = await nuevaCompleta({ lote: '13' });
  await api('oper1', 'POST', `/${otro.id}/rechazar`);
  assert.equal((await api('oper1', 'DELETE', `/${otro.id}`)).status, 200);

  // Reabrir: sólo tiene sentido sobre uno rechazado
  assert.equal((await api('estado1', 'POST', `/${p.id}/reabrir`)).status, 403);
  const ab = await api('oper1', 'POST', `/${p.id}/reabrir`);
  assert.equal(ab.status, 200);
  assert.equal(ab.cuerpo.estado, 'pendiente');
  assert.equal(ab.cuerpo.rechazada_por, null);
  assert.equal(ab.cuerpo.rechazada_en, null);
  assert.equal((await api('oper1', 'PUT', `/${p.id}`, { notas: 'ahora sí' })).status, 200);
  assert.equal((await api('oper1', 'POST', `/${p.id}/reabrir`)).status, 409, 'ya no está rechazado');

  const confirmadaId = (await api('oper1', 'GET', '?estado=confirmada')).cuerpo[0].id;
  assert.equal((await api('oper1', 'POST', `/${confirmadaId}/rechazar`)).status, 409, 'un confirmado no se rechaza');
});

test('descuento: se resta del subtotal antes del IVA, valida el rango, y sólo se puede tocar mientras está pendiente', async () => {
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 }); // $1.400

  assert.equal((await api('estado1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0.1 })).status, 403);
  let r = await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0.1 });
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.cuerpo.totales.subtotal_bruto, r.cuerpo.totales.descuento, r.cuerpo.totales.subtotal, r.cuerpo.totales.iva, r.cuerpo.totales.total],
    [1400, 140, 1260, 264.6, 1524.6]
  );
  assert.equal(db.prepare('SELECT descuento_porcentaje FROM cotizaciones WHERE id = ?').get(p.id).descuento_porcentaje, 0.1);
  // Se lista también con el descuento aplicado
  assert.equal((await api('oper1', 'GET', '?estado=pendiente')).cuerpo.find((c) => c.id === p.id).total, 1524.6);

  assert.equal((await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: -0.1 })).status, 400);
  assert.equal((await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 1.5 })).status, 400);
  assert.equal((await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 'x' })).status, 400);

  r = await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0 });
  assert.equal(r.cuerpo.totales.descuento, 0, 'se puede sacar el descuento volviendo a 0');

  await api('oper1', 'POST', `/${p.id}/rechazar`);
  assert.equal((await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0.2 })).status, 409, 'no se toca un presupuesto rechazado');
  await api('oper1', 'POST', `/${p.id}/reabrir`);

  const confirmadaId = (await api('oper1', 'GET', '?estado=confirmada')).cuerpo[0].id;
  assert.equal((await api('oper1', 'POST', `/${confirmadaId}/descuento`, { descuento_porcentaje: 0.2 })).status, 409, 'ni uno confirmado');
});

test('duplicar conserva el descuento especial del original', async () => {
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0.15 });
  const copia = (await api('oper1', 'POST', `/${p.id}/duplicar`)).cuerpo;
  assert.equal(copia.descuento_porcentaje, 0.15);
});

test('listar: filtra por confirmados / no confirmados, evento y texto, con el total de cada uno', async () => {
  const pendientes = (await api('oper1', 'GET', '?estado=pendiente')).cuerpo;
  const confirmadas = (await api('oper1', 'GET', '?estado=confirmada')).cuerpo;
  const todas = (await api('oper1', 'GET', '')).cuerpo;
  assert.ok(pendientes.length > 0 && confirmadas.length > 0);
  assert.equal(todas.length, pendientes.length + confirmadas.length);
  assert.ok(pendientes.every((c) => c.estado === 'pendiente') && confirmadas.every((c) => c.estado === 'confirmada'));

  const delEventoUno = (await api('oper1', 'GET', `?eventoId=${eventoUno}`)).cuerpo;
  assert.ok(delEventoUno.every((c) => c.evento_nombre === 'CAPPER'));
  assert.ok((await api('oper1', 'GET', '?q=ACME')).cuerpo.length > 0);
  assert.equal((await api('oper1', 'GET', '?q=NADA-QUE-COINCIDA')).cuerpo.length, 0);

  const conItems = confirmadas.find((c) => c.cantidad_lineas > 0);
  const detalle = (await api('oper1', 'GET', `/${conItems.id}`)).cuerpo;
  assert.equal(conItems.total, detalle.totales.total, 'el total del listado es el del detalle');
});

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

test('PDF: A4, con el número, los datos del cliente y del stand, los ítems, subtotal, IVA, total y las condiciones', async () => {
  const p = await nuevaCompleta({ contacto: 'Ana Pérez', mail: 'ana@acme.com', telefono: '11-5555-0000', cuit: '30-12345678-9', direccion: 'Av. Siempreviva 742', notas: 'Incluye flete' });
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 3, comentario: 'Color a definir' });
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('PB-1'), cantidad: 2 });
  const c = (await api('oper1', 'GET', `/${p.id}`)).cuerpo;

  const { status, res, buffer } = await pdfDe('oper1', p.id);
  assert.equal(status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="Presupuesto /);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);

  const [pagina] = await textoPorPagina(buffer);
  for (const esperado of ['PRESUPUESTO', c.cod_fac, 'ACME SA', '30-12345678-9', 'Av. Siempreviva 742', 'Ana Pérez', 'ana@acme.com', '11-5555-0000', 'CAPPER', 'SAE', 'STAND NORTE', 'Oper Uno', 'CÓDIGO', 'DESCRIPCIÓN', 'CE-100', 'Desc CE-100', 'Color a definir', 'PB-1', '$ 1.400,00', '$ 4.200,00', '$ 2.800,00', '$ 5.600,00', 'Subtotal', '$ 9.800,00', 'IVA 21 %', '$ 2.058,00', 'TOTAL', '$ 11.858,00', 'CONDICIONES', 'Este presupuesto tiene validez hasta el', 'Incluye flete', 'Departamento de SAE', 'Página 1 de 1']) {
    assert.ok(pagina.includes(esperado), `falta "${esperado}" en el PDF`);
  }
  assert.ok(pagina.includes(String(c.numero)) && pagina.includes(`${String(c.fecha_vencimiento).slice(8, 10)}/${String(c.fecha_vencimiento).slice(5, 7)}/${String(c.fecha_vencimiento).slice(0, 4)}`), 'número y vencimiento en el encabezado');

  const enLinea = await pdfDe('oper1', p.id, '?ver=1');
  assert.match(enLinea.res.headers.get('content-disposition'), /^inline; /);
  assert.equal((await pdfDe(null, p.id)).status, 401);
  assert.equal((await pdfDe('oper1', 99999)).status, 404);
  assert.equal((await pdfDe('estado1', p.id)).status, 200, 'quien sólo mira también puede bajarlo');
});

test('PDF con descuento especial: muestra el desglose (subtotal, descuento, subtotal con descuento, IVA, total)', async () => {
  const p = await nuevaCompleta();
  await api('oper1', 'POST', `/${p.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 }); // $1.400
  await api('oper1', 'POST', `/${p.id}/descuento`, { descuento_porcentaje: 0.1 });

  const [pagina] = await textoPorPagina((await pdfDe('oper1', p.id)).buffer);
  for (const esperado of ['Subtotal', '$ 1.400,00', 'Descuento 10 %', '-$ 140,00', 'Subtotal con descuento', '$ 1.260,00', 'IVA 21 %', '$ 264,60', 'TOTAL', '$ 1.524,60']) {
    assert.ok(pagina.includes(esperado), `falta "${esperado}" en el PDF con descuento`);
  }

  // Sin descuento no aparece nada de esto (como hoy)
  const sinDescuento = await nuevaCompleta();
  await api('oper1', 'POST', `/${sinDescuento.id}/lineas`, { catalogo_item_id: idDe('CE-100'), cantidad: 1 });
  const [pagina2] = await textoPorPagina((await pdfDe('oper1', sinDescuento.id)).buffer);
  assert.ok(!pagina2.includes('Descuento'));
  assert.ok(!pagina2.includes('Subtotal con descuento'));
});

test('PDF de un presupuesto vacío: no falla, avisa que no hay datos ni ítems, y un ítem sin precio se marca', async () => {
  const vacio = (await api('oper1', 'POST', '', {})).cuerpo;
  const { status, buffer } = await pdfDe('oper1', vacio.id);
  assert.equal(status, 200);
  const [pagina] = await textoPorPagina(buffer);
  assert.ok(pagina.includes('Sin datos cargados.'));
  assert.ok(pagina.includes('Todavía no se cargaron ítems.'));
  assert.ok(pagina.includes('$ 0,00'));

  const sinPrecio = await nuevaCompleta();
  await api('oper1', 'POST', `/${sinPrecio.id}/lineas`, { catalogo_item_id: idDe('SIN'), cantidad: 1 });
  const [pagina2] = await textoPorPagina((await pdfDe('oper1', sinPrecio.id)).buffer);
  assert.ok(pagina2.includes('Sin precio'));
  assert.ok(pagina2.includes('sin precio no están incluidos en el total'));
});

test('PDF con muchos ítems: pasa a más páginas, repite el encabezado de la tabla y numera "Página x de y"; los totales quedan al final', async () => {
  const p = await nuevaCompleta();
  const insertar = db.prepare('INSERT INTO cotizacion_lineas (cotizacion_id, codigo, descripcion, rubro, cantidad, precio_catalogo, precio_unitario, comentario) VALUES (?, ?, ?, ?, ?, 1000, 1000, ?)');
  for (let i = 1; i <= 70; i++) insertar.run(p.id, `ITEM-${String(i).padStart(3, '0')}`, `Descripción del ítem número ${i} que es bastante larga para ocupar más de un renglón en la columna`, 'SISTEMA', 1, i % 10 === 0 ? 'nota del ítem' : null);

  const { buffer } = await pdfDe('oper1', p.id);
  const paginas = await textoPorPagina(buffer);
  assert.ok(paginas.length >= 3, `se esperaban varias páginas y hubo ${paginas.length}`);
  paginas.forEach((texto, i) => {
    assert.ok(texto.includes(`Página ${i + 1} de ${paginas.length}`), `numeración de la página ${i + 1}`);
    assert.ok(i === 0 || texto.includes('PRESUPUESTO'), 'encabezado compacto en las siguientes');
    assert.ok(texto.includes('CÓDIGO') && texto.includes('VALOR UNIT.'), `encabezado de la tabla en la página ${i + 1}`);
  });
  const todo = paginas.join(' ');
  for (let i = 1; i <= 70; i++) assert.equal(todo.split(`ITEM-${String(i).padStart(3, '0')} `).length - 1, 1, `ITEM-${i} aparece una sola vez`);
  assert.ok(paginas[paginas.length - 1].includes('TOTAL') && paginas[paginas.length - 1].includes('$ 84.700,00'), '70 × 1.000 + IVA en la última página');
  assert.equal(paginas.slice(0, -1).some((t) => t.includes('CONDICIONES')), false, 'las condiciones van después de la tabla');
});
