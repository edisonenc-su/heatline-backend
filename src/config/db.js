const mariadb = require('mariadb');
const env = require('./env');

const pool = mariadb.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  connectionLimit: env.db.connectionLimit,
  bigIntAsNumber: true,
  insertIdAsNumber: true,
  rowsAsArray: false
});

async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(sql, params);
  } finally {
    if (conn) conn.release();
  }
}

async function getConnection() {
  return pool.getConnection();
}

async function ping() {
  await query('SELECT 1 AS ok');
}

module.exports = {
  pool,
  query,
  getConnection,
  ping
};
