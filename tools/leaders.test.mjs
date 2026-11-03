import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildLeaders } from './leaders.mjs';
import { parseLeaderProfiles } from './sheets.mjs';
import { recentReturn } from './dates.mjs';

const header = ['Timestamp', 'Email address', 'Permission to display', 'Did you serve a mission?',
  'Where did you serve?', 'Mission country', 'Birthplace', 'Favorite scripture', 'Hobbies',
  'Family', 'Favorite hymn', 'Photo'];
const stakeHeader = ['Organization', 'Position', 'Name', 'Sustained', '', '', '', 'Email'];
const unitHeader = ['Ward', 'Calling', 'Name', 'Email'];
const units = [{ name: 'Burnaby Ward', id: 'burnaby', building: 'burnaby' }];

test('only current calling and latest consent determine what profile is published', () => {
  const former = ['Burnaby Ward', 'Bishop', 'Old, Leader', 'old@example.com'];
  const current = ['Burnaby Ward', 'Bishop', 'New, Leader', 'new@example.com'];
  const profiles = parseLeaderProfiles([
    header,
    ['', former[3], 'Yes', 'Yes', 'Canada Toronto Mission'],
    ['', current[3].toUpperCase(), 'Yes', 'No', 'should not appear', 'Canada'],
  ]);
  const build = (row, entries) => buildLeaders([stakeHeader], [unitHeader, row], entries, units, []);
  const [card] = build(current, profiles);
  assert.equal(card.name, 'Leader New');
  assert.equal(card.unitId, 'burnaby');
  assert.equal(card.mission, null);
  assert.equal(card.missionCountry, null);
  assert.equal(Object.hasOwn(card, 'email'), false);
  assert.deepEqual(build(current, profiles.slice(0, 1)), []);
  assert.deepEqual(build(current, [...profiles, { email: current[3], permission: false }]), []);
});

test('recent returns expire at the calendar anniversary and exclude future dates', () => {
  const now = new Date('2026-11-03T02:00:00Z'); // Nov 2 in Vancouver
  assert.equal(recentReturn('2026-11-02', now), true);
  assert.equal(recentReturn('2025-11-03', now), true);
  assert.equal(recentReturn('2025-11-02', now), false);
  assert.equal(recentReturn('2026-11-03', now), false);
});
