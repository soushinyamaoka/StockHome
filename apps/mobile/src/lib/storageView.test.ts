import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StorageLocationDto, StoragePlacementDto, StorageResultDto } from '../api/storage';
import {
  ancestorsOf,
  indexChildren,
  isPlacementUnder,
  placementsByItemId,
  relativePlacementPath,
  stockLocationLabel,
  subtreePlacementCount,
} from './storageView';

function loc(id: string, name: string, parentId: string | null, placementCount = 0): StorageLocationDto {
  return { id, name, parentId, memo: null, sortOrder: 0, depth: 0, pathText: name, childCount: 0, placementCount };
}

const locations = [
  loc('f1', '1階', null, 1),
  loc('pantry', 'パントリー', 'f1', 0),
  loc('shelfA', 'A棚', 'pantry', 2),
  loc('tier1', '1段目', 'shelfA', 3),
  loc('sink', '洗面台下', 'f1', 1),
  loc('f3', '3階', null, 0),
];
const byId = new Map(locations.map((l) => [l.id, l]));

function placement(pathIds: string[], memo: string | null = null): StoragePlacementDto {
  const path = pathIds.map((id) => ({ id, name: byId.get(id)!.name }));
  return {
    id: `p-${pathIds.join('-')}`,
    itemId: null,
    thingId: 't',
    memo,
    locationId: pathIds[pathIds.length - 1],
    path,
    pathText: path.map((p) => p.name).join(' › '),
  };
}

test('indexChildren groups by parent and keeps API order; orphans become roots', () => {
  const index = indexChildren([...locations, loc('orphan', '迷子', 'missing')]);
  assert.deepEqual(index.get(null)?.map((l) => l.id), ['f1', 'f3', 'orphan']);
  assert.deepEqual(index.get('f1')?.map((l) => l.id), ['pantry', 'sink']);
});

test('subtreePlacementCount sums the location and all descendants', () => {
  const children = indexChildren(locations);
  assert.equal(subtreePlacementCount('f1', children, byId), 7);
  assert.equal(subtreePlacementCount('shelfA', children, byId), 5);
  assert.equal(subtreePlacementCount('f3', children, byId), 0);
});

test('ancestorsOf returns root-to-parent and stops on cycles', () => {
  assert.deepEqual(ancestorsOf('tier1', byId).map((l) => l.id), ['f1', 'pantry', 'shelfA']);
  assert.deepEqual(ancestorsOf('f1', byId), []);
  const cyclic = new Map([
    ['a', loc('a', 'A', 'b')],
    ['b', loc('b', 'B', 'a')],
  ]);
  assert.deepEqual(ancestorsOf('a', cyclic).map((l) => l.id), ['b']);
});

test('relativePlacementPath and isPlacementUnder are relative to the viewed location', () => {
  const p = placement(['f1', 'pantry', 'shelfA', 'tier1']);
  assert.equal(relativePlacementPath(p, 'pantry'), 'A棚 › 1段目');
  assert.equal(relativePlacementPath(p, 'tier1'), 'ここ');
  assert.equal(relativePlacementPath(p, 'f3'), '1階 › パントリー › A棚 › 1段目');
  assert.equal(isPlacementUnder(p, 'f1'), true);
  assert.equal(isPlacementUnder(p, 'sink'), false);
});

test('placementsByItemId only maps consumables that have placements', () => {
  const results: StorageResultDto[] = [
    { kind: 'item', id: 'i1', name: 'サンポール', memo: null, unit: null, placements: [placement(['f1', 'sink'])], tags: [] },
    { kind: 'item', id: 'i2', name: '場所なし', memo: null, unit: null, placements: [], tags: [] },
    { kind: 'thing', id: 't1', name: 'ほうき', memo: null, unit: null, placements: [placement(['f1'])], tags: [] },
  ];
  const map = placementsByItemId(results);
  assert.deepEqual([...map.keys()], ['i1']);
});

test('stockLocationLabel prefers a "ストック" placement and summarizes the rest', () => {
  assert.equal(stockLocationLabel(undefined), null);
  assert.equal(stockLocationLabel([]), null);
  assert.equal(stockLocationLabel([placement(['f1', 'sink'])]), '1階 › 洗面台下');
  assert.equal(
    stockLocationLabel([placement(['f1', 'sink'], '開封中'), placement(['f1', 'pantry', 'shelfA'], 'ストック2本')]),
    '1階 › パントリー › A棚（ストック2本） ほか1か所'
  );
});
