import { AsyncLocalStorage } from 'node:async_hooks';

function encodeArg(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { type: 'null' };
    if (Number.isInteger(value)) return { type: 'integer', value: String(value) };
    return { type: 'float', value };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  }
  return { type: 'text', value: String(value) };
}

function decodeCell(cell) {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer' || cell.type === 'float') return Number(cell.value);
  if (cell.type === 'blob') return Buffer.from(cell.base64 || '', 'base64');
  return cell.value ?? null;
}

function decodeRows(result) {
  const cols = (result?.cols || []).map(c => c.name);
  const rows = result?.rows || [];
  return rows.map(row => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) {
      obj[cols[i]] = decodeCell(row[i]);
    }
    return obj;
  });
}

function normalizePipelineUrl(rawUrl) {
  const u = new URL(String(rawUrl).replace(/^libsql:\/\//i, 'https://'));
  u.pathname = u.pathname.replace(/\/+$/, '') + '/v2/pipeline';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Dependency-free Turso / libSQL Hrana v2 HTTP client using Node's built-in fetch().
 */
export function createTursoClient({ url, authToken = '' }) {
  if (!url) throw new Error('TURSO_DATABASE_URL is required.');
  const defaultEndpoint = normalizePipelineUrl(url);
  const txStore = new AsyncLocalStorage();

  async function sendPipeline(requests, state = null) {
    const endpoint = state?.baseUrl || defaultEndpoint;
    const body = state?.baton ? { baton: state.baton, requests } : { requests };
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Turso invalid JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`Turso HTTP ${res.status}: ${json?.error || json?.message || text.slice(0, 200)}`);
    }
    if (state) {
      state.baton = json.baton || null;
      if (json.base_url) state.baseUrl = normalizePipelineUrl(json.base_url);
    }
    for (const item of json.results || []) {
      if (item.type === 'error') {
        const msg = item.error?.message || 'Turso SQL execution failed';
        throw new Error(msg);
      }
    }
    return json;
  }

  async function execute(sql, args = [], wantRows = false) {
    const state = txStore.getStore() || null;
    const reqs = [
      {
        type: 'execute',
        stmt: {
          sql,
          args: args.map(encodeArg),
          want_rows: wantRows
        }
      }
    ];
    if (!state) reqs.push({ type: 'close' });
    const json = await sendPipeline(reqs, state);
    const result = json.results?.[0]?.response?.result || {};
    return {
      rows: wantRows ? decodeRows(result) : [],
      changes: Number(result.affected_row_count || 0),
      lastInsertRowid: result.last_insert_rowid != null ? Number(result.last_insert_rowid) : 0
    };
  }

  return {
    _isAsyncDb: true,
    isRemote: true,
    async get(sql, ...args) {
      const res = await execute(sql, args, true);
      return res.rows[0];
    },
    async all(sql, ...args) {
      const res = await execute(sql, args, true);
      return res.rows;
    },
    async run(sql, ...args) {
      const res = await execute(sql, args, false);
      return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
    },
    async exec(sql) {
      const state = txStore.getStore() || null;
      const reqs = [{ type: 'sequence', sql: String(sql) }];
      if (!state) reqs.push({ type: 'close' });
      await sendPipeline(reqs, state);
    },
    async tx(fn) {
      if (txStore.getStore()) {
        return fn();
      }
      const state = { baton: null, baseUrl: defaultEndpoint };
      await sendPipeline([{ type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE', want_rows: false } }], state);
      try {
        const result = await txStore.run(state, () => fn());
        if (state.baton) {
          await sendPipeline([
            { type: 'execute', stmt: { sql: 'COMMIT', want_rows: false } },
            { type: 'close' }
          ], state);
        }
        return result;
      } catch (err) {
        if (state.baton) {
          try {
            await sendPipeline([
              { type: 'execute', stmt: { sql: 'ROLLBACK', want_rows: false } },
              { type: 'close' }
            ], state);
          } catch {}
        }
        throw err;
      }
    },
    async close() {}
  };
}

/**
 * Wraps a synchronous node:sqlite DatabaseSync instance into the unified async DB interface.
 */
export function wrapDb(db) {
  if (!db) throw new Error('Database instance is required.');
  if (db._isAsyncDb) return db;
  let txQueue = Promise.resolve();
  let inTx = false;
  return {
    _isAsyncDb: true,
    isRemote: false,
    raw: db,
    async get(sql, ...args) {
      return db.prepare(sql).get(...args);
    },
    async all(sql, ...args) {
      return db.prepare(sql).all(...args);
    },
    async run(sql, ...args) {
      return db.prepare(sql).run(...args);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async tx(fn) {
      if (inTx) return fn();
      const runTx = async () => {
        inTx = true;
        db.exec('BEGIN IMMEDIATE');
        try {
          const res = await fn();
          db.exec('COMMIT');
          return res;
        } catch (err) {
          try { db.exec('ROLLBACK'); } catch {}
          throw err;
        } finally {
          inTx = false;
        }
      };
      const next = txQueue.then(runTx, runTx);
      txQueue = next.catch(() => {});
      return next;
    },
    async close() {
      db.close();
    }
  };
}
