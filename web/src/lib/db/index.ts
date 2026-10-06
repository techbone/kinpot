import "server-only";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Neon when DATABASE_URL is set (Vercel), otherwise an embedded Postgres in .data/ for local dev. */
async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const sql = neon(url);
    for (const statement of splitStatements(schema.SCHEMA_SQL)) await sql.query(statement);
    return drizzle(sql, { schema }) as unknown as Db;
  }
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data", { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(".data/pglite");
  await client.exec(schema.SCHEMA_SQL);
  return drizzle(client, { schema }) as unknown as Db;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const globalForDb = globalThis as unknown as { kinpotDb?: Promise<Db> };

export function db() {
  globalForDb.kinpotDb ??= connect().catch((error) => {
    globalForDb.kinpotDb = undefined; // retry on the next request instead of caching the failure
    throw error;
  });
  return globalForDb.kinpotDb;
}

export { schema };
