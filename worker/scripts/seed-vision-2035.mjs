#!/usr/bin/env node
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const WORKSPACE_ID = "vision-2035";
const USER_ID = "vision-bootstrap-owner";

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

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  try {
    await client.query("BEGIN");

    // delete ALL existing workspaces + memberships (reset)
    await client.query(`DELETE FROM public.memberships`);
    await client.query(`DELETE FROM public.workspaces`);

    // ensure a bootstrap user exists
    await client.query(
      `
      INSERT INTO public.users (id, email, display_name)
      VALUES ($1, 'vision-bootstrap@local', 'Vision Bootstrap Owner')
      ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name
      `,
      [USER_ID]
    );

    // create exactly one workspace
    await client.query(
      `
      INSERT INTO public.workspaces (id, slug, name)
      VALUES ($1, 'vision-2035', 'Vision 2035')
      `,
      [WORKSPACE_ID]
    );

    // owner membership
    await client.query(
      `
      INSERT INTO public.memberships (id, user_id, workspace_id, role)
      VALUES ('vision-bootstrap-membership', $1, $2, 'owner')
      ON CONFLICT (user_id, workspace_id) DO UPDATE SET role=EXCLUDED.role
      `,
      [USER_ID, WORKSPACE_ID]
    );

    await client.query("COMMIT");
    console.log("seeded: Vision 2035 only");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
