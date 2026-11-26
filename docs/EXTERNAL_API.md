# 外部連携（Museなど）からのAPI利用

アプリ以外のサービス（Muse のカスタムコネクタなど）から StockHome の API を呼ぶための手順と約束ごと。

## トークン

- アプリの「せってい → 外部連携（Museなど）」で、利用者本人が発行する。発行時に1度だけ表示される `shk_` で始まる文字列。
- 期限なし。取り消すまで使える。発行した本人として動く（その人の家庭のデータだけを扱い、書き込みはその人の操作として記録される）。
- はじめは**読み取りだけ**。書き込み（POST・PUT・PATCH・DELETE）はトークンごとにアプリで許可する。許可していないトークンでの書き込みは API が 403 で拒否する。
- 書き込みを許可していても、次のAPIは参照も含めて受け付けない（403）。
  - トークンの発行・切り替え・取り消し（`/api/api-tokens`）、ログイン・パスワード変更（`/api/auth/*`）
  - 夜間バッチの手動実行（`/api/dashboard/run-batch`。バッチ内のプッシュ通知の配信結果確認が世帯を限定しないため）
  - 利用者の個人情報を返すもの: 家族メンバー（`/api/users`、メールアドレス）、プッシュ通知の端末（`/api/push-devices`）、
    Gmail取込の候補と反映記録（`/api/import-candidates`・`/api/reflections`、取り込んだ人のメールアドレス・メールの件名と本文の一部）
  - パスワードはどのAPIも返さない（DBにもハッシュしか無い）。購入記録の「買った人」の表示名（`purchasedByUserName`）は返る
- 一覧は本人の分だけ。管理者は家族全員の分を見て、書き込みの切り替えと取り消しができる。1人10個まで。
- DB にはトークン本体を保存せず SHA-256 だけを持つ（`api_tokens` テーブル）。紛失したら取り消して発行し直す。
- 実装: `apps/api/src/plugins/auth.ts`（認証）、`apps/api/src/services/apiTokens.ts`、`apps/api/src/routes/apiTokens.ts`

## 悪用の検知

連携先は正しく使えば拒否されないため、拒否そのものを「想定外の使われ方」の合図として扱う。

- 次の拒否があると、トークンを発行した本人の端末へプッシュ通知する（同じトークンについて24時間に1回まで。`apps/api/src/services/apiTokenAlerts.ts`）。
  通知を受けるには、本人の端末でプッシュ通知が有効になっている必要がある。発行した本人が無効化されているか、その家庭から外れている場合は送らない
  - 読み取り専用のトークンでの書き込み
  - トークンでは使えないAPI（上記）の呼び出し
  - 取り消したトークンの利用
- 拒否はすべて API のログに `event: api_token_denied`（`reason`・`api_token_id`・`method`・`route`）で残る。存在しないトークンは `reason: unknown`
- 通知の結果もログに残る: `api_token_alert_sent`（1台以上で受理）、`api_token_alert_no_target`（`cause`: `owner_inactive`・`owner_not_member`・`no_active_device`）、
  `api_token_alert_failed`（`cause`: `push_not_accepted`＝送る先はあったが受理0台、`exception`＝処理の例外）。24時間以内の2回目以降はログを出さない
- 各リクエストのログ（`event: http_request`）に、認証済みなら `user_id`・`auth_kind`（`jwt`／`api_token`）・`api_token_id` が入る
- トークン値・メールアドレスはログに出さない

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
| `GET /api/stocks` | 消耗品ごとの在庫予測（残数・残り日数・切れる日・アラート）と消費ペースの提案 |

条件なしの検索に出てこない消耗品は、置き場所も用途タグも無いもの。全件の候補が必要なら `GET /api/items` と `id` で突き合わせる。
入力ルール（文字数の上限など）は `packages/shared/src/schemas/` の Zod スキーマを参照。
