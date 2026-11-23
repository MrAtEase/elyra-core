#!/usr/bin/env node
import { readFile } from 'fs/promises';

const DEFAULT_USER_KEY_FALLBACK = 'default';
const GOOGLE_TOKENS_KEY_PREFIX = 'google_tokens:';

function resolveDefaultUserKey(env = process.env) {
  const candidate = env.DEFAULT_USER_KEY;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return DEFAULT_USER_KEY_FALLBACK;
}

function googleTokensKey(userKey) {
  return `${GOOGLE_TOKENS_KEY_PREFIX}${userKey || DEFAULT_USER_KEY_FALLBACK}`;
}

function buildBaseUrl(origin = 'https://api.elyra-core.app') {
  return origin.replace(/\/+$/, '');
}

function formatCheck(label, passed, note) {
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} ${label}${note ? ` – ${note}` : ''}`);
}

async function discoverKvNamespaceId() {
  try {
    const content = await readFile('worker/wrangler.toml', 'utf-8');
    const match = content.match(
      /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"ASSISTANT_KV"[\s\S]*?id\s*=\s*"([^"]+)"/
    );
    if (match) {
      return match[1];
    }
  } catch {
    // ignore; best-effort discovery only
  }
  return null;
}

async function writeKvValue(accountId, namespaceId, apiToken, key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    key
  )}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KV write failed ${resp.status}: ${text}`);
  }
}

async function deleteKvValue(accountId, namespaceId, apiToken, key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    key
  )}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KV delete failed ${resp.status}: ${text}`);
  }
}

async function fetchEndpoint(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // allow non-JSON bodies
  }
  return { status: resp.status, json, text };
}

async function runCheck(label, url, expect401) {
  try {
    const { status, json } = await fetchEndpoint(url);
    const passed = expect401 ? status === 401 : status !== 401;
    const meta = `status ${status}${json?.code ? `, code=${json.code}` : ''}`;
    formatCheck(label, passed, meta);
    return passed;
  } catch (error) {
    formatCheck(label, false, error.message);
    return false;
  }
}

async function main() {
  const env = process.env;
  const apiOrigin = env.API_ORIGIN?.trim() || 'https://api.elyra-core.app';
  const baseUrl = buildBaseUrl(apiOrigin);
  const userKey = resolveDefaultUserKey(env);
  const kvKey = googleTokensKey(userKey);

  const cfAccountId = env.CF_ACCOUNT_ID?.trim();
  const cfApiToken = env.CF_API_TOKEN?.trim();
  let kvNamespaceId = env.KV_NAMESPACE_ID?.trim();

  if (!kvNamespaceId) {
    kvNamespaceId = await discoverKvNamespaceId();
  }

  if (!cfAccountId || !cfApiToken) {
    console.error('Missing CF_ACCOUNT_ID and/or CF_API_TOKEN for KV operations.');
    process.exitCode = 1;
    return;
  }

  if (!kvNamespaceId) {
    console.error(
      'KV namespace not configured. Provide KV_NAMESPACE_ID or ensure worker/wrangler.toml exposes ASSISTANT_KV.'
    );
    process.exitCode = 1;
    return;
  }

  let overallSuccess = true;
  const whoamiUrl = new URL('/assistant/auth/whoami', baseUrl).toString();

  overallSuccess = (await runCheck('whoami (no session) expects 401', whoamiUrl, true)) && overallSuccess;

  const dummyToken = {
    access_token: 'dummy',
    expiry_date: 9999999999999,
  };
  let seeded = false;
  try {
    await writeKvValue(cfAccountId, kvNamespaceId, cfApiToken, kvKey, dummyToken);
    seeded = true;
    console.log(`Seeded KV key ${kvKey} in namespace ${kvNamespaceId}`);
  } catch (error) {
    console.error(`KV seed failed: ${error.message}`);
    overallSuccess = false;
  }

  overallSuccess =
    (await runCheck('whoami (after KV seed) still expects 401', whoamiUrl, true)) && overallSuccess;

  const guardedEndpoints = [
    '/assistant/dashboard/summary',
    '/assistant/tasks/list',
    '/assistant/calendar/events',
    '/assistant/drive/files',
  ];

  for (const path of guardedEndpoints) {
    const endpointUrl = new URL(path, baseUrl).toString();
    overallSuccess =
      (await runCheck(`GET ${path} still expects 401`, endpointUrl, true)) && overallSuccess;
  }

  if (seeded) {
    try {
      await deleteKvValue(cfAccountId, kvNamespaceId, cfApiToken, kvKey);
      console.log(`Cleaned KV key ${kvKey}`);
    } catch (error) {
      console.warn(`Cleanup failed: ${error.message}`);
      overallSuccess = false;
    }
  } else {
    console.warn('Skipping cleanup because the KV key was not seeded.');
  }

  if (!overallSuccess) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
