import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRosterCell } from './sheets.mjs';

const knownMissions = [
  'Brazil São Paulo North Mission',
  'Canada Vancouver Mission',
  'Peru Lima Mission',
  'Peru Lima North Mission',
];

test('parses dash-separated known mission cells', () => {
  assert.deepEqual(
    parseRosterCell('Sister Jane Smith - Canada Vancouver Mission', knownMissions),
    {
      name: 'Sister Jane Smith',
      mission: 'Canada Vancouver Mission',
      raw: 'Sister Jane Smith - Canada Vancouver Mission',
    },
  );
});

test('parses comma-separated newly discovered mission cells', () => {
  assert.deepEqual(
    parseRosterCell('Elder Elijah Pederson, Peru Cusco Mission', knownMissions),
    {
      name: 'Elder Elijah Pederson',
      mission: 'Peru Cusco Mission',
      raw: 'Elder Elijah Pederson, Peru Cusco Mission',
    },
  );
});

test('canonicalizes known mission names that differ only by diacritics', () => {
  assert.deepEqual(
    parseRosterCell('Elder Kayk de Souza, Brazil Sao Paulo North Mission', knownMissions),
    {
      name: 'Elder Kayk de Souza',
      mission: 'Brazil São Paulo North Mission',
      raw: 'Elder Kayk de Souza, Brazil Sao Paulo North Mission',
    },
  );
});
