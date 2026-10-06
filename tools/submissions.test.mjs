import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSubmissionRows } from './sheets.mjs';
import { parseStartDate } from './dates.mjs';

// Header text copied from the live "Missionary Photos (Responses)" sheet.
const HEADER = [
  'Timestamp',
  'Missionary’s name. Ex. Sister Sarah Bateman',
  'Photo of your Missionary for display',
  'Do you give us your permission to display the photo on the Stake website at www.myvanstake.com ',
  'We can include a short bio about your missionary here and/or a favorite scripture. Mission area is not needed we have that. ',
  'When is/was their start date? ',
];

test('maps today\'s form columns by header text and skips the header row', () => {
  const subs = parseSubmissionRows([
    HEADER,
    ['27/05/2024 10:18:44', 'Sister Victoria Oviatt', 'https://drive.google.com/open?id=abc', 'Yes', '', ''],
    ['08/05/2026 21:00:35', 'Elder Brayden May', 'https://drive.google.com/open?id=x1, https://drive.google.com/open?id=x2',
      'Yes', 'Spanish speaking', '06/30/2025'],
  ]);
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[1], {
    name: 'Elder Brayden May',
    photoUrls: ['https://drive.google.com/open?id=x1', 'https://drive.google.com/open?id=x2'],
    permission: true,
    bio: 'Spanish speaking',
    startDateRaw: '06/30/2025',
    language: null,
    homeWard: null,
  });
  assert.equal(subs[0].bio, null);
  assert.equal(subs[0].startDateRaw, null);
});

test('picks up the new language and ward questions wherever the form puts them', () => {
  const subs = parseSubmissionRows([
    [...HEADER, 'What language is your missionary serving in?', 'Which ward is your missionary from?'],
    ['t', 'Elder A', '', 'No', '', 45000, 'Spanish', 'Kitsilano Ward'],
  ]);
  assert.equal(subs[0].language, 'Spanish');
  assert.equal(subs[0].homeWard, 'Kitsilano Ward');
  assert.equal(subs[0].startDateRaw, 45000);
  assert.equal(subs[0].permission, false);
});

test('throws when a required column is missing', () => {
  assert.throws(() => parseSubmissionRows([['Timestamp', 'Missionary’s name']]), /no column matches "photo"/);
});

test('throws when a pattern matches two columns', () => {
  const header = [...HEADER, 'Home ward', 'Ward boundaries note'];
  assert.throws(() => parseSubmissionRows([header]), /2 columns match "homeWard"/);
});

test('start dates: unambiguous text formats', () => {
  assert.deepEqual(parseStartDate('06/30/2025'), { iso: '2025-06-30' });   // MM/DD
  assert.deepEqual(parseStartDate('15/09/2025'), { iso: '2025-09-15' });   // DD/MM
  assert.deepEqual(parseStartDate('2025-03-11'), { iso: '2025-03-11' });
  assert.deepEqual(parseStartDate('05/05/2025'), { iso: '2025-05-05' });   // same both ways
});

test('start dates: ambiguous and bad values are flagged, never guessed', () => {
  assert.deepEqual(parseStartDate('10/02/2025'), { ambiguous: true });
  assert.deepEqual(parseStartDate('11/03/2025'), { ambiguous: true });
  assert.deepEqual(parseStartDate('next spring'), { invalid: true });
  assert.deepEqual(parseStartDate('2025-02-30'), { invalid: true });
  assert.equal(parseStartDate(''), null);
  assert.equal(parseStartDate(null), null);
});

test('start dates: Sheets day serials (Date-type answers) convert exactly', () => {
  assert.deepEqual(parseStartDate(45727), { iso: '2025-03-11' });
});
