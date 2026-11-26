# 外部連携（Museなど）からのAPI利用

アプリ以外のサービス（Muse のカスタムコネクタなど）から StockHome の API を呼ぶための手順と約束ごと。

## トークン

- アプリの「せってい → 外部連携（Museなど）」で、利用者本人が発行する。発行時に1度だけ表示される `shk_` で始まる文字列。
- 期限なし。取り消すまで使える。発行した本人として動く（その人の家庭のデータだけを扱い、書き込みはその人の操作として記録される）。
- はじめは**読み取りだけ**。書き込み（POST・PUT・PATCH・DELETE）はトークンごとにアプリで許可する。許可していないトークンでの書き込みは API が 403 で拒否する。
- 書き込みを許可していても、トークンの発行・切り替え・取り消し（`/api/api-tokens`）、ログイン・パスワード変更（`/api/auth/*`）、
  家族メンバーの追加・変更（`/api/users` の GET 以外）は受け付けない。
- 一覧は本人の分だけ。管理者は家族全員の分を見て、書き込みの切り替えと取り消しができる。1人10個まで。
- DB にはトークン本体を保存せず SHA-256 だけを持つ（`api_tokens` テーブル）。紛失したら取り消して発行し直す。
- 実装: `apps/api/src/plugins/auth.ts`（認証）、`apps/api/src/services/apiTokens.ts`、`apps/api/src/routes/apiTokens.ts`

## 呼び方

```http
GET https://<API のホスト>/api/storage/search?q=トイレ
Authorization: Bearer shk_...
```

トークンはチャット・コード・Git・ログに書かない。連携先の安全な入力欄にだけ登録する。

## よく使う参照API

| API | 内容 |
|---|---|
| `GET /api/storage/search` | 品物と保管場所の検索。`q`（名前・メモ・用途タグ・場所の部分一致）、`tagId`、`locationId`、`kind`（`item`/`thing`）。条件なしなら物の全件と、置き場所か用途タグがある消耗品 |
| `GET /api/items` | 有効な消耗品の全件（置き場所未登録も含む。品名・カテゴリ・在庫予測） |
| `GET /api/storage/items/:itemId`・`GET /api/storage/things/:id` | 1件の置き場所と用途タグ |
| `GET /api/storage/locations`・`GET /api/storage/tags` | 場所の木・用途タグの一覧 |

条件なしの検索に出てこない消耗品は、置き場所も用途タグも無いもの。全件の候補が必要なら `GET /api/items` と `id` で突き合わせる。
入力ルール（文字数の上限など）は `packages/shared/src/schemas/` の Zod スキーマを参照。
