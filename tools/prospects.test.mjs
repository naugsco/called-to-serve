import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProspectiveRows } from './sheets.mjs';
import { matchUnit, buildProspects } from './prospects.mjs';

const stake = JSON.parse(readFileSync(new URL('../web/public/stake/stake.json', import.meta.url), 'utf8'));
const units = stake.units;

// The question titles exactly as they appear in the live Google Form's response sheet.
const HEADER = [
  'Timestamp',
  'Name (first and last)',
  'Are you a Young Man or a Young Woman?',
  'Which ward or branch are you in?',
  'Photo of you',
  'A favorite scripture',
  'Favorite hobbies or school subjects',
  'Why are you considering serving a mission?',
  'Who or what inspires you to serve? (optional)',
  "Parent or guardian permission: may we show your child's photo and answers on the stake kiosk and the stake website at www.myvanstake.com?",
];
const row = (o = {}) => [
  '2026/11/01 10:00', o.name ?? 'Jamie Sample', o.group ?? 'Young Man', o.ward ?? 'Burnaby Ward',
  o.photo ?? 'https://drive.google.com/open?id=1wwXfQBG3sbU5MtCPn69Bmsu6CF7YaloZ',
  o.scripture ?? 'Moroni 10:4', o.interests ?? 'Soccer, chemistry',
  o.why ?? 'I want to share what I know', o.inspiration ?? '', o.permission ?? 'Yes, I give permission',
];

test('suggested form headers map to exactly one column each', () => {
  const [p] = parseProspectiveRows([HEADER, row()]);
  assert.equal(p.name, 'Jamie Sample');
  assert.equal(p.group, 'YM');
  assert.equal(p.ward, 'Burnaby Ward');
  assert.equal(p.scripture, 'Moroni 10:4');
  assert.equal(p.interests, 'Soccer, chemistry');
  assert.equal(p.why, 'I want to share what I know');
  assert.equal(p.inspiration, null);
  assert.equal(p.permission, true);
  assert.equal(p.photoUrls.length, 1);
});

test('young women are detected and permission must be an explicit yes', () => {
  const [a, b] = parseProspectiveRows([HEADER, row({ group: 'Young Woman' }), row({ permission: 'No' })]);
  assert.equal(a.group, 'YW');
  assert.equal(b.permission, false);
});

test('a missing required column fails loudly', () => {
  assert.throws(() => parseProspectiveRows([HEADER.filter(h => !/ward/i.test(h)), ['x']]), /no column matches "ward"/);
});

test('matchUnit: exact, loose, and ambiguous answers', () => {
  assert.equal(matchUnit('Burnaby Ward', units).id, 'burnaby');
  assert.equal(matchUnit('burnaby', units).id, 'burnaby');
  assert.equal(matchUnit('Vancouver 1st Ward', units).id, 'vancouver-1');
  assert.equal(matchUnit('Vancouver 4th Ward (Spanish)', units).id, 'vancouver-4');
  assert.equal(matchUnit('Port Coquitlam', units).id, 'port-coquitlam');
  assert.equal(matchUnit('Coquitlam Ward', units).id, 'coquitlam');
  assert.equal(matchUnit('Vancouver', units), null);   // could be several units
  assert.equal(matchUnit('Surrey Ward', units), null);
  assert.equal(matchUnit('', units), null);
});

test('buildProspects drops people without permission or a matching ward, newest submission wins', () => {
  const rows = parseProspectiveRows([HEADER,
    row({ name: 'Ann Example', ward: 'Sechelt Branch', why: 'old answer' }),
    row({ name: 'Ann  Example', ward: 'Sechelt Branch', why: 'new answer' }),
    row({ name: 'No Permission', permission: 'No' }),
    row({ name: 'Lost Ward', ward: 'Somewhere Else' }),
    row({ name: 'Ben Example', ward: 'North Shore Ward' }),
  ]);
  const { prospects, skipped } = buildProspects(rows, units);
  assert.deepEqual(prospects.map(p => p.name), ['Ben Example', 'Ann  Example']); // north-shore before sechelt
  assert.equal(prospects.find(p => p.slug === 'ann-example').why, 'new answer');
  assert.equal(prospects[0].buildingId, 'north-shore');
  assert.deepEqual(skipped.map(s => s.name).sort(), ['Lost Ward', 'No Permission']);
});
