/**
 * Clientes guardados, con el CUIT como clave. Se completan solos al guardar los datos de un presupuesto
 * de la app y sirven para autocompletar los siguientes. Sólo se guarda un cliente si el CUIT es válido
 * (11 dígitos con dígito verificador correcto); un presupuesto con un CUIT dudoso se guarda igual, pero
 * sin crear cliente.
 */
const { db, transaction } = require('../db/connection');
const { errorHttp } = require('./catalogoCalculoService');

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const CAMPOS = { razon_social: 200, direccion: 240, contacto: 160, mail: 160, telefono: 60 };

const soloDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

/** ¿Los 11 dígitos son un CUIT/CUIL real? (módulo 11 de AFIP) */
function digitosValidos(digitos) {
  if (digitos.length !== 11) return false;
  const suma = PESOS.reduce((total, peso, i) => total + peso * Number(digitos[i]), 0);
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10) return false;
  return verificador === Number(digitos[10]);
}

const formatear = (digitos) => `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;

/** Qué se puede saber de un CUIT escrito de cualquier forma ("30-52830354-0", "30 52830354 0", "30528303540"). */
function interpretarCuit(texto) {
  const digitos = soloDigitos(texto);
  if (digitos === '') return { vacio: true, valido: false, digitos: '', formateado: null };
  const valido = digitosValidos(digitos);
  return { vacio: false, valido, digitos, formateado: valido ? formatear(digitos) : null };
}

function textoOpcional(valor, campo, maximo) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = String(valor).trim();
  if (limpio === '') return null;
  if (limpio.length > maximo) throw errorHttp(400, `"${campo}" es demasiado largo (máximo ${maximo} caracteres)`);
  return limpio;
}

/** Fila de la base → lo que ve el resto de la app (el CUIT con guiones). */
const aPublico = (fila) => (fila ? { ...fila, cuit: formatear(fila.cuit), cuit_digitos: fila.cuit } : null);

/**
 * Guarda (o completa) el cliente de un presupuesto. Un cliente nuevo se crea con lo que haya; a uno que
 * ya existe se le actualiza cada dato que el presupuesto trae con contenido (lo más reciente gana) y lo
 * que viene vacío no borra nada. Devuelve el cliente o null si no hay un CUIT válido.
 */
function guardarDesdePresupuesto(datos, usuario) {
  const cuit = interpretarCuit(datos.cuit);
  if (!cuit.valido) return null;
  const nuevos = {};
  for (const [campo, maximo] of Object.entries(CAMPOS)) nuevos[campo] = textoOpcional(datos[campo], campo, maximo) ?? null;

  const existente = db.prepare('SELECT * FROM clientes WHERE cuit = ?').get(cuit.digitos);
  if (!existente) {
    const info = db
      .prepare('INSERT INTO clientes (cuit, razon_social, direccion, contacto, mail, telefono, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(cuit.digitos, nuevos.razon_social, nuevos.direccion, nuevos.contacto, nuevos.mail, nuevos.telefono, usuario ? usuario.id : null);
    return aPublico(db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid));
  }

  const cambios = Object.keys(CAMPOS).filter((campo) => nuevos[campo] !== null && nuevos[campo] !== existente[campo]);
  if (cambios.length > 0) {
    db.prepare(`UPDATE clientes SET ${cambios.map((c) => `${c} = ?`).join(', ')}, actualizado_en = datetime('now') WHERE id = ?`).run(...cambios.map((c) => nuevos[c]), existente.id);
  }
  return aPublico(db.prepare('SELECT * FROM clientes WHERE id = ?').get(existente.id));
}

const SELECT_CON_USO = `
  SELECT c.*, (SELECT COUNT(*) FROM cotizaciones p WHERE p.cliente_id = c.id) AS presupuestos,
         (SELECT MAX(p.creado_en) FROM cotizaciones p WHERE p.cliente_id = c.id) AS ultimo_presupuesto
  FROM clientes c
`;

function condicionDeBusqueda(q) {
  const texto = String(q || '').trim();
  if (texto === '') return { sql: '', params: [] };
  const digitos = soloDigitos(texto);
  const sinSeparadores = texto.replace(/[\s.-]/g, '');
  const esNumero = digitos.length >= 3 && digitos.length === sinSeparadores.length;
  const patron = `%${texto.replace(/[%_]/g, '')}%`;
  if (esNumero) return { sql: ' WHERE c.cuit LIKE ?', params: [`%${digitos}%`] };
  return { sql: ' WHERE c.razon_social LIKE ? OR c.contacto LIKE ?', params: [patron, patron] };
}

/** Para el autocompletado del formulario: pocos resultados, por razón social o por CUIT. */
function buscar(q, limite = 8) {
  const { sql, params } = condicionDeBusqueda(q);
  return db
    .prepare(`SELECT c.* FROM clientes c${sql} ORDER BY c.razon_social COLLATE NOCASE, c.cuit LIMIT ?`)
    .all(...params, Math.min(Math.max(Number(limite) || 8, 1), 50))
    .map((f) => aPublico({ ...f }));
}

function listar({ q } = {}) {
  const { sql, params } = condicionDeBusqueda(q);
  return db
    .prepare(`${SELECT_CON_USO}${sql} ORDER BY c.razon_social COLLATE NOCASE, c.cuit LIMIT 500`)
    .all(...params)
    .map((f) => aPublico({ ...f }));
}

/** ¿Qué es este CUIT y, si es válido, ya tenemos al cliente? */
function porCuit(texto) {
  const cuit = interpretarCuit(texto);
  const fila = cuit.valido ? db.prepare('SELECT * FROM clientes WHERE cuit = ?').get(cuit.digitos) : null;
  return { vacio: cuit.vacio, valido: cuit.valido, cuit_formateado: cuit.formateado, cliente: fila ? aPublico({ ...fila }) : null };
}

function leer(id) {
  const fila = db.prepare(`${SELECT_CON_USO} WHERE c.id = ?`).get(id);
  if (!fila) throw errorHttp(404, 'Cliente no encontrado');
  return { ...fila };
}

function actualizar(id, datos = {}) {
  const actual = leer(id);
  const cambios = {};
  for (const [campo, maximo] of Object.entries(CAMPOS)) {
    const valor = textoOpcional(datos[campo], campo, maximo);
    if (valor !== undefined) cambios[campo] = valor;
  }
  if (datos.cuit !== undefined) {
    const cuit = interpretarCuit(datos.cuit);
    if (!cuit.valido) throw errorHttp(400, 'El CUIT no es válido: tiene que tener 11 dígitos y el dígito verificador correcto');
    if (cuit.digitos !== actual.cuit) {
      const otro = db.prepare('SELECT id, razon_social FROM clientes WHERE cuit = ? AND id != ?').get(cuit.digitos, id);
      if (otro) throw errorHttp(409, `Ya hay otro cliente con ese CUIT${otro.razon_social ? ` (${otro.razon_social})` : ''}`);
      cambios.cuit = cuit.digitos;
    }
  }
  const claves = Object.keys(cambios);
  if (claves.length > 0) {
    db.prepare(`UPDATE clientes SET ${claves.map((c) => `${c} = ?`).join(', ')}, actualizado_en = datetime('now') WHERE id = ?`).run(...Object.values(cambios), id);
  }
  return aPublico(leer(id));
}

function eliminar(id) {
  leer(id);
  db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
}

/**
 * Guarda como clientes a los de los presupuestos que ya estaban cargados antes de que existiera esta
 * tabla. Se corre al arrancar el servidor y no hace nada si no hay nada para completar.
 */
function completarDesdePresupuestos() {
  const pendientes = db.prepare('SELECT * FROM cotizaciones WHERE cliente_id IS NULL AND cuit IS NOT NULL ORDER BY id').all();
  let guardados = 0;
  transaction(() => {
    for (const p of pendientes) {
      const cliente = guardarDesdePresupuesto(p, null);
      if (cliente) {
        db.prepare('UPDATE cotizaciones SET cliente_id = ? WHERE id = ?').run(cliente.id, p.id);
        guardados += 1;
      }
    }
  });
  return { revisados: pendientes.length, guardados };
}

module.exports = {
  interpretarCuit,
  guardarDesdePresupuesto,
  buscar,
  listar,
  porCuit,
  actualizar,
  eliminar,
  completarDesdePresupuestos,
};
