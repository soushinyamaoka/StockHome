/**
 * 保管場所のチャット経由登録・検索用 CLI（API 経由。DB には直接触らない）
 *
 *   npm run storage -- lookup                 場所の一覧・用途タグ・消耗品名を表示（登録内容を組み立てる前の確認用）
 *   npm run storage -- search <キーワード>     名前・タグ・場所・メモで検索
 *   npm run storage -- import <file.json>     一括登録の確認（dry run。何も書き込まない）
 *   npm run storage -- import <file.json> --apply   一括登録を実行
 *
 * 接続先と認証情報は apps/api/.env.local（gitignore 対象）に置く:
 *   STORAGE_CLI_API_URL=https://...      API のベース URL（末尾の /api は不要）
 *   STORAGE_CLI_EMAIL=...
 *   STORAGE_CLI_PASSWORD=...
 * ログインで得たトークンは apps/api/.data/storage-cli-token.json（gitignore 対象）に保存し、
 * 有効な間は再ログインしない（ログイン API のアカウント別回数制限に掛からないようにするため）。
 *
 * import のファイル形式は POST /api/storage/import の entries と同じ:
 *   { "entries": [ { "kind": "thing", "name": "ほうき",
 *                    "locations": [ { "path": ["1階", "パントリー", "A棚"], "memo": "床置き" } ],
 *                    "tags": ["掃除全般"] } ] }
 */
import { config } from 'dotenv';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const API_ROOT = resolve(__dirname, '..');
config({ path: resolve(API_ROOT, '.env.local') });
const TOKEN_FILE = resolve(API_ROOT, '.data', 'storage-cli-token.json');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} が未設定です。apps/api/.env.local に設定してください`);
    process.exit(2);
  }
  return value;
}

const baseUrl = requireEnv('STORAGE_CLI_API_URL').replace(/\/+$/, '').replace(/\/api$/, '');

function readCachedToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as { baseUrl?: string; token?: string };
    return saved.baseUrl === baseUrl && saved.token ? saved.token : null;
  } catch {
    return null;
  }
}

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: requireEnv('STORAGE_CLI_EMAIL'), password: requireEnv('STORAGE_CLI_PASSWORD') }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !body.token) {
    console.error(`ログインに失敗しました (${res.status}): ${body.message ?? ''}`);
    process.exit(1);
  }
  // トークンは本人以外が読めないようにする（Windows では mode は概ね無視されるが、他OSでの実行に備える）
  mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify({ baseUrl, token: body.token, savedAt: new Date().toISOString() }), {
    mode: 0o600,
  });
  chmodSync(TOKEN_FILE, 0o600);
  return body.token;
}

let token: string | null = null;

async function api<T>(method: string, path: string, payload?: unknown): Promise<{ status: number; body: T }> {
  token ??= readCachedToken() ?? (await login());
  const send = (t: string) =>
    fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  let res = await send(token);
  if (res.status === 401) {
    token = await login();
    res = await send(token);
  }
  const body = (await res.json().catch(() => ({}))) as T;
  if (res.status >= 400 && res.status !== 422) {
    console.error(`API エラー (${res.status}) ${method} ${path}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return { status: res.status, body };
}

// --- 表示 ---

interface Location {
  id: string;
  depth: number;
  pathText: string;
  memo: string | null;
  placementCount: number;
}
interface Tag {
  name: string;
  usageCount: number;
}
interface Placement {
  pathText: string;
  memo: string | null;
}
interface Result {
  kind: 'item' | 'thing';
  name: string;
  memo: string | null;
  placements: Placement[];
  tags: { name: string }[];
}

async function lookup() {
  const [{ body: loc }, { body: tags }, { body: items }] = await Promise.all([
    api<{ locations: Location[] }>('GET', '/storage/locations'),
    api<{ tags: Tag[] }>('GET', '/storage/tags'),
    api<{ items: { itemName: string; unit: string | null }[] }>('GET', '/items'),
  ]);
  console.log(`## 場所（${loc.locations.length}件）`);
  for (const l of loc.locations) {
    const memo = l.memo ? `  — ${l.memo}` : '';
    console.log(`${'  '.repeat(l.depth - 1)}- ${l.pathText.split(' › ').pop()} [${l.placementCount}]${memo}`);
  }
  console.log(`\n## 用途タグ（${tags.tags.length}件）`);
  console.log(tags.tags.map((t) => `${t.name}(${t.usageCount})`).join('、') || '（なし）');
  console.log(`\n## 消耗品（${items.items.length}件）`);
  console.log(items.items.map((i) => i.itemName).sort((a, b) => a.localeCompare(b, 'ja')).join('\n'));
}

function formatResult(r: Result) {
  const lines = [`- ${r.name}${r.kind === 'item' ? '（消耗品）' : ''}${r.memo ? `  — ${r.memo}` : ''}`];
  if (r.placements.length === 0) lines.push('    場所: 未登録');
  for (const p of r.placements) lines.push(`    場所: ${p.pathText}${p.memo ? `（${p.memo}）` : ''}`);
  if (r.tags.length > 0) lines.push(`    用途: ${r.tags.map((t) => t.name).join('、')}`);
  return lines.join('\n');
}

async function search(q: string) {
  const { body } = await api<{ results: Result[] }>('GET', `/storage/search?q=${encodeURIComponent(q)}`);
  console.log(`「${q}」の検索結果: ${body.results.length}件`);
  for (const r of body.results) console.log(formatResult(r));
}

interface ImportPlan {
  index: number;
  kind: 'thing' | 'item';
  name: string;
  action: 'create' | 'update' | 'error';
  error?: string;
  memoUpdated: boolean;
  createdLocations: string[];
  addedPlacements: Placement[];
  updatedPlacements: Placement[];
  unchangedPlacements: string[];
  createdTags: string[];
  addedTags: string[];
}
interface ImportResult {
  dryRun: boolean;
  applied: boolean;
  summary: Record<string, number>;
  entries: ImportPlan[];
}

const ACTION_LABEL = { create: '新規', update: '追記', error: 'エラー' } as const;

async function runImport(file: string, apply: boolean) {
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as { entries?: unknown[] } | unknown[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  const { body } = await api<ImportResult>('POST', '/storage/import', { dryRun: !apply, entries });

  console.log(apply ? (body.applied ? '## 登録しました' : '## 登録できませんでした（何も登録していません）') : '## 登録内容の確認（まだ登録していません）');
  console.log('');
  console.log('| # | 種類 | 名前 | 処理 | 置き場所 | 用途タグ |');
  console.log('|---|---|---|---|---|---|');
  for (const e of body.entries) {
    const places = [
      ...e.addedPlacements.map((p) => `＋${p.pathText}${p.memo ? `（${p.memo}）` : ''}`),
      ...e.updatedPlacements.map((p) => `メモ更新 ${p.pathText}（${p.memo ?? 'なし'}）`),
      ...e.unchangedPlacements.map((p) => `登録済 ${p}`),
    ].join('<br>');
    const tags = [...e.addedTags.map((t) => (e.createdTags.includes(t) ? `${t}🆕` : t))].join('、');
    const action = e.action === 'error' ? `エラー: ${e.error}` : ACTION_LABEL[e.action] + (e.memoUpdated ? '・メモ更新' : '');
    console.log(`| ${e.index + 1} | ${e.kind === 'item' ? '消耗品' : '物'} | ${e.name} | ${action} | ${places || '—'} | ${tags || '—'} |`);
  }
  const created = Array.from(new Set(body.entries.flatMap((e) => e.createdLocations)));
  if (created.length > 0) {
    console.log('\n新しく作る場所:');
    for (const p of created) console.log(`- ${p}`);
  }
  const s = body.summary;
  console.log(
    `\n合計 ${s.entries}件（新規の物 ${s.thingsCreated} / 追記 ${s.targetsUpdated} / エラー ${s.errors}）、` +
      `新しい場所 ${s.locationsCreated}、置き場所の追加 ${s.placementsAdded}、新しい用途タグ ${s.tagsCreated}`
  );
  if (!body.applied && apply) process.exit(1);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'lookup') return lookup();
  if (command === 'search' && args.length > 0) return search(args.join(' '));
  if (command === 'import' && args[0]) return runImport(args[0], args.includes('--apply'));
  console.error('使い方: npm run storage -- lookup | search <キーワード> | import <file.json> [--apply]');
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
