<#
.SYNOPSIS
  StockHome の API を VPS（ssh エイリアス `vps`）へ再デプロイする。

.DESCRIPTION
  1. デプロイ対象のソース一式を tar.gz に固める（node_modules / dist / .env / ログ等は除外）。
  2. scp で VPS の ~/stockhome に転送し、展開する。
  3. `docker compose -f docker-compose.prod.yml up -d --build api` で API イメージを再ビルドし、
     api コンテナを入れ替える（postgres と DB データはそのまま）。
  4. http://localhost:4002/health が 200 を返すか確認する。

  VPS 側の `.env`（本番秘密情報）・DB・package-lock は送信/変更しない。
  Prisma migration がある場合はコンテナ起動時に `prisma migrate deploy` が自動適用する。

.PARAMETER DryRun
  転送・デプロイは行わず、作成した tar.gz の中身一覧だけ表示する（送信内容の確認用）。

.PARAMETER NoCache
  Docker イメージをキャッシュ無しで再ビルドする（通常は不要）。

.EXAMPLE
  npm run deploy
  npm run deploy -- -DryRun
  npm run deploy -- -NoCache
#>
param(
  [switch]$DryRun,
  [switch]$NoCache
)

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $PSScriptRoot
$Remote    = 'vps'
$RemoteDir = 'stockhome'
$Tarball   = 'deploy.tgz'
$Compose   = 'docker-compose.prod.yml'

# tar（bsdtar）が必要
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  throw 'tar コマンドが見つかりません（Windows 10/11 標準の tar.exe が必要です）。'
}

Push-Location $Root
try {
  # --- 1. tarball 作成 -------------------------------------------------------
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }

  # 除外（秘密情報・生成物・巨大ファイルは送らない）
  $excludes = @(
    '--exclude=*node_modules*',
    '--exclude=*/dist', '--exclude=*/dist/*', '--exclude=dist',
    '--exclude=*/.expo*',
    '--exclude=*/.env', '--exclude=.env', '--exclude=*/.env.*',
    '--exclude=*.log',
    '--exclude=.run'
  )
  # Docker ビルドコンテキストが必要とするファイル群のみ
  $include = @(
    'package.json',
    'package-lock.json',
    'packages/shared',
    'apps/api',
    'apps/mobile/package.json',
    $Compose,
    '.dockerignore'
  )

  Write-Host '== [1/4] tarball を作成中 ==' -ForegroundColor Cyan
  tar -czf $Tarball @excludes @include
  if ($LASTEXITCODE -ne 0) { throw 'tar の作成に失敗しました。' }
  Write-Host ('  {0} を作成 ({1:N0} bytes)' -f $Tarball, (Get-Item $Tarball).Length) -ForegroundColor Green

  if ($DryRun) {
    Write-Host '== DryRun: 送信内容（.env / node_modules が含まれていないこと） ==' -ForegroundColor Yellow
    tar -tzf $Tarball
    return
  }

  # --- 2. 転送 ---------------------------------------------------------------
  Write-Host '== [2/4] VPS へ転送中 ==' -ForegroundColor Cyan
  scp $Tarball ("{0}:{1}/{2}" -f $Remote, $RemoteDir, $Tarball)
  if ($LASTEXITCODE -ne 0) { throw 'scp 転送に失敗しました。' }

  # --- 3. 展開 + 再ビルド + 再起動 ------------------------------------------
  Write-Host '== [3/4] VPS で展開・再ビルド・コンテナ入れ替え中（数十秒）==' -ForegroundColor Cyan
  if ($NoCache) {
    $remoteCmd = "set -e; cd $RemoteDir; tar -xzf $Tarball; rm -f $Tarball; docker compose -f $Compose build --no-cache api; docker compose -f $Compose up -d api"
  }
  else {
    $remoteCmd = "set -e; cd $RemoteDir; tar -xzf $Tarball; rm -f $Tarball; docker compose -f $Compose up -d --build api"
  }
  ssh $Remote $remoteCmd
  if ($LASTEXITCODE -ne 0) { throw 'VPS でのビルド/起動に失敗しました。' }

  # --- 4. ヘルスチェック（起動直後は未応答のためリトライ）-------------------
  Write-Host '== [4/4] ヘルスチェック（最大60秒待機）==' -ForegroundColor Cyan
  # リモート bash で 200 になるまで最大30回×2秒ポーリング。PowerShell に展開させないため単一引用符で渡す。
  $healthCmd = 'for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4002/health || true); [ "$code" = "200" ] && break; sleep 2; done; echo "$code"'
  $code = (ssh $Remote $healthCmd).Trim()
  if ($code -eq '200') {
    Write-Host ('  OK (HTTP {0}) — デプロイ完了しました。' -f $code) -ForegroundColor Green
  }
  else {
    throw ("ヘルスチェック失敗 (HTTP {0})。ログ確認: ssh vps `"docker logs --tail 50 stockhome-api-prod`"" -f $code)
  }
}
finally {
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
  Pop-Location
}
