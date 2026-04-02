const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');
require('dotenv').config();

const env = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'heatline',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};

function normalizeSql(sql) {
  return sql.replace(/\uFEFF/g, '').trim();
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';

  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    const next2 = sql[i + 2];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-' && (next2 === ' ' || next2 === '\t' || next2 === '\n' || next2 === '\r')) {
        inLineComment = true;
        i += 1;
        continue;
      }

      if (ch === '#') {
        inLineComment = true;
        continue;
      }

      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    if (!inDouble && !inBacktick && ch === '\'') {
      if (inSingle && next === '\'') {
        current += ch + next;
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (!inSingle && !inBacktick && ch === '"') {
      if (inDouble && next === '"') {
        current += ch + next;
        i += 1;
        continue;
      }
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick && ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}

function shouldSkipStatement(stmt) {
  const normalized = stmt
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  return (
    normalized.startsWith('CREATE DATABASE ') ||
    normalized.startsWith('USE ')
  );
}

function preview(stmt) {
  return stmt.replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_name = ?
    `,
    [env.database, tableName]
  );
  return Number(rows[0].cnt) > 0;
}

async function main() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.sql 파일을 찾을 수 없습니다: ${schemaPath}`);
  }

  const rawSql = normalizeSql(fs.readFileSync(schemaPath, 'utf8'));
  const allStatements = splitSqlStatements(rawSql);
  const statements = allStatements.filter((stmt) => !shouldSkipStatement(stmt));

  if (statements.length === 0) {
    throw new Error('실행할 schema SQL 문을 찾지 못했습니다.');
  }

  console.log('[db:init] target');
  console.log(`- host: ${env.host}`);
  console.log(`- port: ${env.port}`);
  console.log(`- database: ${env.database}`);
  console.log(`- user: ${env.user}`);
  console.log(`- statements: ${statements.length}`);

  const conn = await mariadb.createConnection({
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    multipleStatements: false
  });

  try {
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      console.log(`[db:init] (${i + 1}/${statements.length}) ${preview(stmt)}`);
      await conn.query(stmt);
    }

    const tablesToCheck = [
      'customers',
      'users',
      'controllers',
      'event_logs',
      'control_logs',
      'commands'
    ];

    console.log('[db:init] table check');
    for (const tableName of tablesToCheck) {
      const exists = await tableExists(conn, tableName);
      console.log(`- ${tableName}: ${exists ? 'OK' : 'MISSING'}`);
    }

    console.log('[db:init] 완료');
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('[db:init] 실패');
  console.error(error);
  process.exit(1);
});
