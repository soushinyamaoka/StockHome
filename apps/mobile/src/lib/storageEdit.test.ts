import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StorageLocationDto } from '../api/storage';
import { addTagName, apiErrorMessage, selfAndDescendantIds, suggestTags } from './storageEdit';

const tags = [
  { name: '掃除全般', usageCount: 5 },
  { name: 'トイレ掃除', usageCount: 2 },
  { name: '旅行', usageCount: 1 },
  { name: '服の汚れ', usageCount: 3 },
];

test('suggestTags: prefix matches first, then partial, excluding selected', () => {
  assert.deepEqual(suggestTags(tags, '掃除', []), ['掃除全般', 'トイレ掃除']);
  assert.deepEqual(suggestTags(tags, '掃除', ['掃除全般']), ['トイレ掃除']);
  assert.deepEqual(suggestTags(tags, 'カメラ', []), []);
});

test('suggestTags: empty input lists most used tags', () => {
  assert.deepEqual(suggestTags(tags, '  ', ['服の汚れ']), ['掃除全般', 'トイレ掃除', '旅行']);
});

test('addTagName normalizes width and spaces and ignores empty or duplicate names', () => {
  assert.deepEqual(addTagName([], ' 旅行 '), ['旅行']);
  assert.deepEqual(addTagName(['旅行'], '旅行'), ['旅行']);
  assert.deepEqual(addTagName(['旅行'], '   '), ['旅行']);
  assert.deepEqual(addTagName([], 'ＤＩＹ　工具'), ['DIY 工具']);
});

function loc(id: string, parentId: string | null): StorageLocationDto {
  return { id, name: id, parentId, memo: null, sortOrder: 0, depth: 0, pathText: id, childCount: 0, placementCount: 0 };
}

test('selfAndDescendantIds covers the subtree only', () => {
  const locations = [loc('f1', null), loc('pantry', 'f1'), loc('shelf', 'pantry'), loc('sink', 'f1'), loc('f3', null)];
  assert.deepEqual([...selfAndDescendantIds(locations, 'pantry')].sort(), ['pantry', 'shelf']);
  assert.deepEqual([...selfAndDescendantIds(locations, 'f1')].sort(), ['f1', 'pantry', 'shelf', 'sink']);
});

test('apiErrorMessage prefers the API message', () => {
  assert.equal(apiErrorMessage({ response: { data: { message: '中に物や場所があるため削除できません' } } }, 'x'), '中に物や場所があるため削除できません');
  assert.equal(apiErrorMessage(new Error('network'), '保存できませんでした'), '保存できませんでした');
});
