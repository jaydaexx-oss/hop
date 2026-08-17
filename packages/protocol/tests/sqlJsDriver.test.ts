import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqlJsDriver } from "../src/sqlJsDriver.js";

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-sqljs-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqlJsDriver durability", () => {
  it("reopens after close with every write, without exporting the whole DB per statement", async () => {
    const file = tempDb();
    const driver = await SqlJsDriver.open(file);
    await driver.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const blob = "x".repeat(800);
    const n = 1_200;
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      await driver.execute("INSERT INTO t (v) VALUES (?)", [`${blob}-${i}`]);
    }
    const insertMs = Date.now() - started;
    driver.close();
    // Persist-every-execute of a growing sql.js image is quadratic and was
    // tens of seconds here. Close-once durability must stay linear.
    expect(insertMs).toBeLessThan(8_000);

    const reopened = await SqlJsDriver.open(file);
    const rows = await reopened.query<{ n: number }>("SELECT COUNT(*) AS n FROM t");
    expect(rows[0]?.n).toBe(n);
    reopened.close();
  });
});
