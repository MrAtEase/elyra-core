#!/usr/bin/env node
import process from 'node:process';
import { URL } from 'node:url';

const BASE_ORIGIN =
  process.env.WORKER_API_ORIGIN ||
  process.env.WORKER_BASE ||
  'http://localhost:8787';
const WHOAMI_URL = new URL('/assistant/auth/whoami', BASE_ORIGIN).toString();
const OAUTH_START_URL = new URL('/assistant/oauth/google/start/', BASE_ORIGIN).toString();

if (typeof globalThis.fetch !== 'function') {
  console.error('dev-smoke-test requires Node 18+ so that `fetch` is available globally.');
  process.exit(1);
}

const args = process.argv.slice(2);
const cookieArgIndex = args.findIndex((arg) => arg === '--cookie');
const cookieFromFlag =
  cookieArgIndex >= 0 && cookieArgIndex + 1 < args.length ? args[cookieArgIndex + 1] : undefined;
const cookie =
  cookieFromFlag ||
  process.env.MF_S_COOKIE ||
  process.env.SESSION_COOKIE ||
  process.env.SF_MF_S_COOKIE;

function describeCookieSource() {
  if (cookieArgIndex >= 0) return '--cookie flag';
  if (process.env.MF_S_COOKIE) return 'MF_S_COOKIE';
  if (process.env.SESSION_COOKIE) return 'SESSION_COOKIE';
  if (process.env.SF_MF_S_COOKIE) return 'SF_MF_S_COOKIE';
  return 'not provided';
}

async function requestWhoami(cookieValue) {
  const headers = { Accept: 'application/json' };
  if (cookieValue) {
    headers.Cookie = `mf-s=${cookieValue}`;
  }
  return fetch(WHOAMI_URL, {
    method: 'GET',
    headers,
  });
}

function formatResponse(resp, body) {
  return {
    status: resp.status,
    ok: resp.ok,
    code: body?.code,
    message: body?.message,
  };
}

async function assertOauthStart() {
  const response = await fetch(OAUTH_START_URL, { method: 'GET', redirect: 'manual' });
  if (response.status !== 302) {
    throw new Error(`Expected 302 redirect, got ${response.status}`);
  }
  const location = response.headers.get('location');
  if (!location || !location.includes('google')) {
    throw new Error(
      `Expected Location header pointing to Google's OAuth consent screen, got ${location ?? '<missing>'}`
    );
  }
  console.log('✔ OAuth start endpoint redirects to Google:', location);
}

(async () => {
  console.log(`Auth smoke test → ${WHOAMI_URL}`);
  console.log('Step 1/3: calling /assistant/auth/whoami without cookies (expect 401 AUTH_REQUIRED)...');

  const anonymous = await requestWhoami();
  const anonymousBody = await anonymous.json().catch(() => ({}));

  if (anonymous.status !== 401 || anonymousBody?.code !== 'AUTH_REQUIRED') {
    console.error('Unexpected whoami result:', formatResponse(anonymous, anonymousBody));
    process.exit(1);
  }

  console.log('✔ 401 AUTH_REQUIRED confirmed.');
  const loginUrl = anonymousBody?.loginUrl || anonymousBody?.authUrl || '[missing loginUrl]';
  console.log('Login URL (open in browser):', loginUrl);

  console.log('Step 2/3: checking OAuth start redirects to Google (302)...');
  await assertOauthStart();

  if (!cookie) {
    console.log(
      'No cookie provided. Complete the login flow via the login URL and run this script again with `--cookie <mf-s>` or `MF_S_COOKIE=<value>`.'
    );
    process.exit(0);
  }

  console.log(`Step 3/3: calling /assistant/auth/whoami with cookie (source: ${describeCookieSource()})`);
  const authed = await requestWhoami(cookie);
  const authedBody = await authed.json().catch(() => ({}));

  if (!authed.ok) {
    console.error('Authenticated whoami failed:', formatResponse(authed, authedBody));
    process.exit(1);
  }

  console.log('✔ 200 OK confirmed. Authenticated payload:', authedBody);
  process.exit(0);
})().catch((error) => {
  console.error('dev-smoke-test failed:', error);
  process.exit(1);
});
