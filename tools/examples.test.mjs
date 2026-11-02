import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseProspects } from '../web/src/examples.js';

const examples = { prospects: [{ name: 'Jordan Sample' }, { name: 'Riley Example' }] };
const real = n => ({ submissions: n, prospects: Array.from({ length: n }, (_, i) => ({ name: `Real ${i}` })) });

test('examples show while the form has no submissions', () => {
  assert.deepEqual(chooseProspects({ submissions: 0, prospects: [] }, examples).map(p => p.name), ['Jordan Sample', 'Riley Example']);
});

test('the first submission switches the examples off', () => {
  assert.deepEqual(chooseProspects(real(1), examples).map(p => p.name), ['Real 0']);
});

test('a submission that cannot be shown still switches the examples off', () => {
  assert.deepEqual(chooseProspects({ submissions: 1, prospects: [] }, examples), []);
});

test('unknown state (form not configured, unreadable, or file missing) shows nothing', () => {
  assert.deepEqual(chooseProspects({ submissions: null, prospects: [] }, examples), []);
  assert.deepEqual(chooseProspects(null, examples), []);
  assert.deepEqual(chooseProspects({ prospects: [{ name: 'Old file' }] }, examples).map(p => p.name), ['Old file']);
});
