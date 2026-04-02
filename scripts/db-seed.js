const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');
require('dotenv').config();

const env = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'heatline',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  forceSeed: String(process.env.FORCE_SEED || '').toLowerCase() === 'true'
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
  const normalized = stmt.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalized.startsWith('USE ');
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

async function getCount(conn, tableName) {
  const rows = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${tableName}\``);
  return Number(rows[0].cnt);
}

async function main() {
  const seedPath = path.join(__dirname, '..', 'sql', 'seed.sql');

  if (!fs.existsSync(seedPath)) {
    throw new Error(`seed.sql 파일을 찾을 수 없습니다: ${seedPath}`);
  }

  const rawSql = normalizeSql(fs.readFileSync(seedPath, 'utf8'));
  const allStatements = splitSqlStatements(rawSql);
  const statements = allStatements.filter((stmt) => !shouldSkipStatement(stmt));

  if (statements.length === 0) {
    throw new Error('실행할 seed SQL 문을 찾지 못했습니다.');
  }

  console.log('[db:seed] target');
  console.log(`- host: ${env.host}`);
  console.log(`- port: ${env.port}`);
  console.log(`- database: ${env.database}`);
  console.log(`- user: ${env.user}`);
  console.log(`- statements: ${statements.length}`);
  console.log(`- forceSeed: ${env.forceSeed}`);

  const conn = await mariadb.createConnection({
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    multipleStatements: false
  });

  try {
    const usersExists = await tableExists(conn, 'users');
    if (!usersExists) {
      throw new Error('users 테이블이 없습니다. 먼저 npm run db:init 을 실행하세요.');
    }

    const userCount = await getCount(conn, 'users');
    if (userCount > 0 && !env.forceSeed) {
      console.log(`[db:seed] users 테이블에 이미 ${userCount}건이 있어 seed를 건너뜁니다.`);
      console.log('[db:seed] 다시 강제로 넣으려면 FORCE_SEED=true npm run db:seed 를 사용하세요.');
      return;
    }

    await conn.beginTransaction();

    try {
      for (let i = 0; i < statements.length; i += 1) {
        const stmt = statements[i];
        console.log(`[db:seed] (${i + 1}/${statements.length}) ${preview(stmt)}`);
        await conn.query(stmt);
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }

    const counts = {
      customers: await getCount(conn, 'customers'),
      users: await getCount(conn, 'users'),
      controllers: await getCount(conn, 'controllers'),
      event_logs: await getCount(conn, 'event_logs'),
      control_logs: await getCount(conn, 'control_logs')
    };

    console.log('[db:seed] inserted counts');
    Object.entries(counts).forEach(([name, count]) => {
      console.log(`- ${name}: ${count}`);
    });

    console.log('[db:seed] 완료');
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('[db:seed] 실패');
  console.error(error);
  process.exit(1);
});
