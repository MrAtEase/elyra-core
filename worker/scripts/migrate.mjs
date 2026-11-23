#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

function requireEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const raw = fsSync.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(workerRoot, ".dev.vars"));
loadEnvFile(path.join(workerRoot, ".env"));
loadEnvFile(path.join(workerRoot, ".env.local"));
loadEnvFile(path.resolve(workerRoot, "..", ".env"));
loadEnvFile(path.resolve(workerRoot, "..", ".env.local"));
const migrationsDir = path.resolve(__dirname, "..", "pg-migrations");

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  try {
    await ensureTable(client);

    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query(`SELECT version FROM public.schema_migrations`);
    const applied = new Set(rows.map((r) => r.version));

    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
          [f]
        );
        await client.query("COMMIT");
        console.log("applied", f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    console.log("migrations done");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
