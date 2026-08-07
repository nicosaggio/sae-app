const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');

const SELECT_USUARIO = 'SELECT id, nombre_usuario, nombre_completo, rol, activo, solo_estado, creado_en FROM usuarios';
const ROLES = ['admin', 'operador'];

function listar() {
  return db.prepare(`${SELECT_USUARIO} ORDER BY id DESC`).all();
}

function crear({ nombre_usuario, password, nombre_completo, rol, solo_estado }) {
  const existente = db.prepare('SELECT id FROM usuarios WHERE nombre_usuario = ?').get(nombre_usuario);
  if (existente) {
    const err = new Error('Ya existe un usuario con ese nombre');
    err.status = 400;
    throw err;
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO usuarios (nombre_usuario, password_hash, nombre_completo, rol, solo_estado) VALUES (?, ?, ?, ?, ?)')
    .run(nombre_usuario, hash, nombre_completo || null, ROLES.includes(rol) ? rol : 'operador', solo_estado ? 1 : 0);
  return db.prepare(`${SELECT_USUARIO} WHERE id = ?`).get(info.lastInsertRowid);
}

function actualizar(id, { nombre_completo, rol, activo, solo_estado }) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) {
    const err = new Error('Usuario no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare('UPDATE usuarios SET nombre_completo = ?, rol = ?, activo = ?, solo_estado = ? WHERE id = ?').run(
    nombre_completo === undefined ? usuario.nombre_completo : nombre_completo,
    ROLES.includes(rol) ? rol : usuario.rol,
    activo === undefined ? usuario.activo : activo ? 1 : 0,
    solo_estado === undefined ? usuario.solo_estado : solo_estado ? 1 : 0,
    id
  );
  return db.prepare(`${SELECT_USUARIO} WHERE id = ?`).get(id);
}

function cambiarPassword(id, password) {
  const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(id);
  if (!usuario) {
    const err = new Error('Usuario no encontrado');
    err.status = 404;
    throw err;
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, id);
}

module.exports = { listar, crear, actualizar, cambiarPassword };
