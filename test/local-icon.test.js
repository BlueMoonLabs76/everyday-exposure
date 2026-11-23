import assert from 'node:assert/strict';
import test from 'node:test';
import { categoriesFor, DESTINATION_TAGS } from '../src/config.js';

test('a state gets Waffle House unless it has its own local icon', () => {
  assert.deepEqual(categoriesFor('virginia'), ['grocery', 'gas', 'hospital', 'waffle_house']);
  assert.deepEqual(categoriesFor(), ['grocery', 'gas', 'hospital', 'waffle_house']);
  assert.deepEqual(categoriesFor('washington'), ['grocery', 'gas', 'hospital', 'starbucks']);
});

test('Starbucks is a cafe branded or named Starbucks', () => {
  const isStarbucks = DESTINATION_TAGS.starbucks;
  assert.ok(isStarbucks({ amenity: 'cafe', brand: 'Starbucks' }));
  assert.ok(isStarbucks({ amenity: 'cafe', name: 'Starbucks Reserve Roastery' }));
  assert.ok(isStarbucks({ amenity: 'fast_food', name: 'Starbucks' }));
  assert.ok(!isStarbucks({ amenity: 'cafe', name: 'Not Starbucks Coffee' }));
  assert.ok(!isStarbucks({ shop: 'coffee', brand: 'Starbucks' }));
  assert.ok(!isStarbucks({ amenity: 'cafe', name: 'Espresso Hut' }));
});

test('grocery includes the Northwest chains (2026-11-23)', () => {
  const isGrocery = DESTINATION_TAGS.grocery;
  for (const name of ['Fred Meyer', 'QFC', 'Albertsons', 'WinCo Foods', 'Haggen Food & Pharmacy', "Yoke's Fresh Market", 'Rosauers']) {
    assert.ok(isGrocery({ shop: 'supermarket', name }), name);
  }
  assert.ok(isGrocery({ shop: 'supermarket', brand: 'QFC', name: 'Quality Food Centers' }));
  assert.ok(!isGrocery({ amenity: 'fuel', brand: 'Fred Meyer' }));
  assert.ok(!isGrocery({ shop: 'supermarket', name: 'Pike Place Produce' }));
});
