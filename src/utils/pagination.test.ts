import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ITEMS_PER_PAGE,
  getPaginatedItems,
  normalizeItemsPerPage,
} from './pagination.ts';

test('defaults pagination to 12 items per page', () => {
  assert.equal(normalizeItemsPerPage(undefined), DEFAULT_ITEMS_PER_PAGE);
  assert.equal(normalizeItemsPerPage(0), DEFAULT_ITEMS_PER_PAGE);
});

test('clamps user pagination to a safe range', () => {
  assert.equal(normalizeItemsPerPage(80), 50);
  assert.equal(normalizeItemsPerPage(1), 1);
});

test('splits items into page-sized groups', () => {
  const pages = getPaginatedItems([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(pages, [[1, 2, 3], [4, 5, 6]]);
});
