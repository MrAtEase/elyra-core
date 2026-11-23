import { cp, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const appOutputDir = path.join(projectRoot, ".next", "server", "app");
const staticDir = path.join(projectRoot, ".next", "static");
const publicDir = path.join(projectRoot, "public");
const outDir = path.join(projectRoot, "out");

const isDynamicSegment = (segment) => segment.startsWith("[") && segment.endsWith("]");

async function ensureDir(target) {
  await mkdir(target, { recursive: true });
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function copyRouteHtml(dir, routeSegments = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nextSegments = isDynamicSegment(entry.name)
        ? routeSegments
        : [...routeSegments, entry.name];
      await copyRouteHtml(entryPath, nextSegments);
      continue;
    }

    if (!entry.name.endsWith(".html")) {
      continue;
    }

    const routeName = entry.name.slice(0, -5);
    if (routeName.startsWith("_")) {
      continue;
    }

    const finalSegments = routeName === "index" ? routeSegments : [...routeSegments, routeName];
    const targetDir = finalSegments.length ? path.join(outDir, ...finalSegments) : outDir;
    await ensureDir(targetDir);
    await copyFile(entryPath, path.join(targetDir, "index.html"));
  }
}

async function copyDirectoryIfExists(source, destination) {
  if (!(await pathExists(source))) {
    return;
  }
  await ensureDir(destination);
  await cp(source, destination, { recursive: true });
}

async function run() {
  if (!(await pathExists(appOutputDir))) {
    throw new Error("Missing `.next/server/app`; run `next build` before exporting.");
  }

  await rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);

  await copyDirectoryIfExists(publicDir, outDir);
  await copyDirectoryIfExists(staticDir, path.join(outDir, "_next", "static"));
  await copyRouteHtml(appOutputDir);
  console.log("Static export ready in out/");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
