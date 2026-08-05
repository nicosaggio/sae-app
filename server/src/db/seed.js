const bcrypt = require('bcryptjs');
const { db } = require('./connection');

function run() {
  const existentes = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (existentes > 0) {
    console.log('Ya existen usuarios, no se crea el admin por defecto.');
    return;
  }

  const nombreUsuario = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(
    `INSERT INTO usuarios (nombre_usuario, password_hash, nombre_completo, rol)
     VALUES (?, ?, ?, 'admin')`
  ).run(nombreUsuario, hash, 'Administrador');

  console.log(`Usuario admin creado: "${nombreUsuario}" / "${password}"`);
  console.log('Por seguridad, cambiá esta contraseña después del primer login.');
}

if (require.main === module) {
  run();
}

module.exports = { run };
