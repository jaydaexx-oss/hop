import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import type { SqliteDriver } from "./store.js";

const require = createRequire(import.meta.url);

let sqlJs: SqlJsStatic | null = null;

async function loadSql(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs;
  const wasmPath = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
  sqlJs = await initSqlJs({
    locateFile: () => wasmPath,
  });
  return sqlJs;
}

type BindValue = number | string | Uint8Array | null;

export class SqlJsDriver implements SqliteDriver {
  private txDepth = 0;
  private txTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: Database,
    private readonly filePath?: string,
  ) {}

  static async open(filePath?: string): Promise<SqlJsDriver> {
    const SQL = await loadSql();
    if (filePath && existsSync(filePath)) {
      const file = readFileSync(filePath);
      return new SqlJsDriver(new SQL.Database(file), filePath);
    }
    return new SqlJsDriver(new SQL.Database(), filePath);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.run(sql, params as BindValue[]);
    if (this.txDepth === 0) this.persist();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params as BindValue[]);
    }
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    const run = this.txTail.then(
      () => this.runTransaction(fn),
      () => this.runTransaction(fn),
    );
    this.txTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runTransaction(fn: () => Promise<void>): Promise<void> {
    if (this.txDepth > 0) {
      await fn();
      return;
    }
    this.txDepth += 1;
    this.db.run("BEGIN");
    try {
      await fn();
      this.db.run("COMMIT");
      this.txDepth -= 1;
      this.persist();
    } catch (err) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      this.txDepth -= 1;
      throw err;
    }
  }

  persist(): void {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, Buffer.from(this.db.export()));
    renameSync(tmp, this.filePath);
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}
