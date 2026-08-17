import * as SQLite from 'expo-sqlite';
import type { SqliteDriver } from '@hop/protocol';

export class ExpoSqliteDriver implements SqliteDriver {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name: string): Promise<ExpoSqliteDriver> {
    const db = await SQLite.openDatabaseAsync(name);
    return new ExpoSqliteDriver(db);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    await this.db.withTransactionAsync(fn);
  }
}
