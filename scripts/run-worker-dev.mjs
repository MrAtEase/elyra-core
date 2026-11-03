#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();

function fail(message) {
  console.error(`worker dev helper error: ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(cwd, 'package.json'))) {
  fail('This script must be run from the repo root (package.json missing in current directory).');
}

const workerDir = path.join(cwd, 'worker');
if (!existsSync(workerDir)) {
  fail('worker directory is missing. Run this script from mira-stack repo root.');
}

const configFileName = 'wrangler.toml';
const configPath = path.join(workerDir, configFileName);
if (!existsSync(configPath)) {
  fail(`${configFileName} is missing from worker/ – rerun setup or restore the file before running local dev.`);
}

const configRelativeToWorker = path.relative(workerDir, configPath) || `.${path.sep}${path.basename(configPath)}`;

const configContents = readFileSync(configPath, 'utf-8');
const bindings = [
  { name: 'ASSISTANT_KV', test: configContents.includes('binding = "ASSISTANT_KV"') },
  { name: 'ASSISTANT_DB', test: configContents.includes('binding = "ASSISTANT_DB"') },
];

console.log('Local worker dev helper');
console.log(`  repo root: ${cwd}`);
console.log(`  worker dir: ${workerDir}`);
console.log(`  wrangler config: ${configPath}`);
bindings.forEach((binding) => {
  console.log(`  ${binding.name}: ${binding.test ? 'found' : 'missing'} in config`);
});

const extraArgs = process.argv.slice(2);
const hasExplicitPortArg =
  extraArgs.includes('--port') ||
  extraArgs.some((arg) => arg.startsWith('--port=')) ||
  extraArgs.includes('-p');
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const wranglerArgs = [
  'wrangler',
  'dev',
  '--env',
  'dev',
  '--config',
  configRelativeToWorker,
  ...(hasExplicitPortArg ? [] : ['--port', '8787']),
  ...extraArgs,
];

console.log(`Running: ${npxBin} ${wranglerArgs.join(' ')}`);

const child = spawn(npxBin, wranglerArgs, {
  cwd: workerDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
  },
});

const relaySignal = (signal) => {
  if (child.pid) {
    child.kill(signal);
  }
};
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
  process.on(signal, () => relaySignal(signal));
});

child.on('error', (error) => {
  console.error('Failed to start wrangler dev:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
