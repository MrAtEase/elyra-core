import { safeNext } from './lib/safeNext';

type Case = { name: string; input: string | null | undefined; expected: string };

const cases: Case[] = [
  { name: 'Safe: /os', input: '/os', expected: '/os' },
  { name: 'Safe: /w', input: '/w', expected: '/w' },
  { name: 'Safe: /w/vision-2035', input: '/w/vision-2035', expected: '/w/vision-2035' },
  { name: 'Safe: /workspace', input: '/workspace', expected: '/workspace' },
  { name: 'Safe: /workspace/projects', input: '/workspace/projects', expected: '/workspace/projects' },
  { name: 'Safe: /merlin', input: '/merlin', expected: '/merlin' },
  { name: 'Safe: /admin/dashboard', input: '/admin/dashboard', expected: '/admin/dashboard' },
  { name: 'BLOCK: root / -> fallback', input: '/', expected: '/w' },
  { name: 'BLOCK: /signin -> fallback', input: '/signin', expected: '/w' },
  { name: 'BLOCK: absolute URL (allowed origin disallowed by policy)', input: 'http://localhost:3000/workspace', expected: '/w' },
  { name: 'BLOCK: /assistant/oauth/google/start', input: '/assistant/oauth/google/start', expected: '/w' },
  { name: 'BLOCK: Encoded /assistant/oauth/google/start', input: '/%61ssistant%2Foauth%2Fgoogle%2Fstart', expected: '/w' },
  { name: 'BLOCK: no leading slash', input: 'workspace', expected: '/w' },
  { name: 'BLOCK: null input', input: null, expected: '/w' },
  { name: 'BLOCK: excessively long path', input: '/' + 'a'.repeat(500), expected: '/w' },
  { name: 'BLOCK: external absolute', input: 'https://evil.com/phish', expected: '/w' },
];

console.log('🧪 safeNext tests\n');
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = safeNext(c.input as any, '/w');
  const ok = got === c.expected;
  if (ok) {
    passed++;
    console.log(`✅ ${c.name}`);
  } else {
    failed++;
    console.log(`❌ ${c.name}\n   input: ${String(c.input)}\n   expected: ${c.expected}\n   got: ${got}`);
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
