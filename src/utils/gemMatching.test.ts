import test from 'node:test';
import assert from 'node:assert/strict';
import { doesGeMOrderMatch, normalizeGeMOrderNumber } from './gemMatching.ts';

test('normalizes GeM order numbers for comparison', () => {
  assert.equal(normalizeGeMOrderNumber('GEMC-511687712601789'), 'GEMC511687712601789');
  assert.equal(normalizeGeMOrderNumber(' gemc-511687712601789 '), 'GEMC511687712601789');
});

test('matches equivalent GeM order numbers across minor formatting differences', () => {
  assert.equal(
    doesGeMOrderMatch('GEMC-511687712601789', 'GEMC-511687712601789'),
    true,
  );
  assert.equal(
    doesGeMOrderMatch('GEMC-511687712601789', ' gemc-511687712601789 '),
    true,
  );
  assert.equal(
    doesGeMOrderMatch('GEMC-511687712601789', 'GEMC-511687712601780'),
    false,
  );
});
