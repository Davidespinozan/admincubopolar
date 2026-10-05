// Aplica cada archivo SQL dos veces dentro de UNA transacción que siempre termina
// en ROLLBACK, contra la base LOCAL de pruebas. Sirve para comprobar que una
// migración aplica y es re-ejecutable antes de integrarla al runner.
// Requiere el Postgres local encendido (ver SKILL.md) y el módulo `pg` en NODE_PATH.
// Uso: NODE_PATH=$WORK/node_modules node aplica-dos-veces.cjs supabase/NNN_a.sql [supabase/NNN_b.sql]
const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: Number(process.env.PGPORT || 5499), user: 'tester', database: 'cubopolar_test' });
  await c.connect();
  try {
    await c.query('BEGIN');
    for (const f of process.argv.slice(2)) {
      const sql = fs.readFileSync(f, 'utf8');
      await c.query(sql);
      await c.query(sql);
    }
    console.log('APLICA x2 OK');
  } catch (e) {
    console.log('ERROR', e.message, e.position || '', e.where || '');
    process.exitCode = 1;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
})();
