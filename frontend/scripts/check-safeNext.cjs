const assert = require('assert').strict;

function safeNextSim(raw, fallback = '/workspace') {
  if (!raw) return fallback;
  let v = raw;
  try { v = decodeURIComponent(raw); } catch {};
  v = v.trim();
  const lower = v.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return fallback;
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('/assistant/oauth/google/start')) return fallback;
  if (v.length > 200) return fallback;
  const allowed = ['/workspace','/assistant','/merlin','/admin'];
  if (!allowed.some(p => v === p || v.startsWith(p + '/') || v.startsWith(p + '?') || v.startsWith(p + '#'))) return fallback;
  return v;
}

// Tests
assert.equal(safeNextSim('/workspace'), '/workspace');
assert.equal(safeNextSim('/workspace/settings'), '/workspace/settings');
assert.equal(safeNextSim('https://evil.com'), '/workspace');
assert.equal(safeNextSim('/assistant/oauth/google/start?next=/workspace'), '/workspace');
assert.equal(safeNextSim('/assistant/other'), '/assistant/other');
assert.equal(safeNextSim(null), '/workspace');
assert.equal(safeNextSim('/' + 'a'.repeat(300)), '/workspace');

console.log('safeNext checks passed');
