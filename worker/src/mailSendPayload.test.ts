import { isValidMailSendPayload, normalizeMailSendPayload } from './mailPayload';

type Case = {
  name: string;
  payload: any;
  expectValid: boolean;
};

const cases: Case[] = [
  {
    name: 'valid string recipients',
    payload: {
      to: 'user@example.com',
      subject: 'Test',
      bodyText: 'Hello',
    },
    expectValid: true,
  },
  {
    name: 'valid array recipients with cc and html',
    payload: {
      to: ['user@example.com', 'other@example.com'],
      cc: ['cc@example.com'],
      subject: 'Hello',
      bodyText: 'Some text',
      bodyHtml: '<p>Some text</p>',
    },
    expectValid: true,
  },
  {
    name: 'valid replyToMessage payload',
    payload: {
      to: 'user@example.com',
      subject: 'Re: Test',
      bodyText: 'Reply text',
      replyToMessage: {
        originalMessageId: '<abc-123@example.com>',
        originalReferences: ['<abc-123@example.com>', 'def-456@example.com'],
      },
    },
    expectValid: true,
  },
  {
    name: 'invalid missing recipients',
    payload: {
      subject: 'No recipients',
      bodyText: 'Oops',
    },
    expectValid: false,
  },
  {
    name: 'invalid missing body',
    payload: {
      to: 'user@example.com',
      subject: 'No body',
    },
    expectValid: false,
  },
];

console.log('🧪 mailSendPayload tests\n');
let passed = 0;
let failed = 0;

for (const test of cases) {
  const valid = isValidMailSendPayload(test.payload);
  if (valid !== test.expectValid) {
    failed++;
    console.log(
      `❌ ${test.name} -> expected valid=${test.expectValid}, got=${valid}`
    );
    continue;
  }

  if (valid) {
    const normalized = normalizeMailSendPayload(test.payload);
    if (!normalized || normalized.to.length === 0) {
      failed++;
      console.log(`❌ ${test.name} -> normalization failed`);
      continue;
    }
  }

  passed++;
  console.log(`✅ ${test.name}`);
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
