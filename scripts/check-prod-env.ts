import fs from "node:fs/promises";
import path from "node:path";

// Simple manual .env parser to avoid external dependencies
async function loadEnvLocal() {
  try {
    const content = await fs.readFile(path.resolve(process.cwd(), ".env.local"), "utf8");
    content.split("\n").forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value;
      }
    });
  } catch (err) {
    // Ignore if file doesn't exist
  }
}

const REQUIRED_FRONTEND_ENV = [
  "NEXT_PUBLIC_ASSISTANT_API_BASE",
  "NEXT_PUBLIC_AI_SERVICE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const REQUIRED_WORKER_ENV = [
  "ASSISTANT_DB", // Cloudflare D1
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

async function checkEnv() {
  await loadEnvLocal();
  console.log("=== Elyra Core Production Environment Audit ===\n");

  // Check frontend .env.local (if exists) or just simulate check for user
  console.log("Checking Frontend Requirements:");
  for (const key of REQUIRED_FRONTEND_ENV) {
    const value = process.env[key];
    if (value) {
      console.log(`✅ ${key}: set (starts with ${value.slice(0, 5)}...)`);
    } else {
      console.log(`❌ ${key}: MISSING`);
    }
  }

  console.log("\nChecking Worker Requirements (Simulation):");
  console.log("Note: Worker variables are usually set in Cloudflare Wrangler/Dashboard.");
  for (const key of REQUIRED_WORKER_ENV) {
    console.log(`ℹ️  Ensure ${key} is configured in Cloudflare.`);
  }

  console.log("\n=== Recommendation ===");
  console.log("1. Ensure NEXT_PUBLIC_AI_SERVICE_URL is set to your AI service (not the worker) if they are on different domains.");
  console.log("2. Ensure SUPABASE_SERVICE_ROLE_KEY is correctly set in your production host secrets.");
}

checkEnv().catch(console.error);
