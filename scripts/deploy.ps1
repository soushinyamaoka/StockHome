<#
.SYNOPSIS
  StockHome の API を VPS（ssh エイリアス `vps`）へ再デプロイする。

.DESCRIPTION
  1. デプロイ対象のソース一式を tar.gz に固める（node_modules / dist / .env / ログ等は除外）。
  2. scp で VPS の ~/stockhome に転送し、展開する。
  3. `API_IMAGE_TAG=git-<40桁commit>` を指定して `docker compose -f docker-compose.prod.yml
     build/up -d api` を実行し、api コンテナを入れ替える（postgres と DB データはそのまま）。
     タグは deploy 時点のローカル git commit hash に固定される（C-5対応）。
  4. http://localhost:4002/health が 200 を返すか確認する。
  5. 成功時のみ、VPS上の stockhome-api:git-* イメージのうち古い世代を削除し、直近3世代
     （現在deploy分を含む）だけを残す。health chegck失敗時は削除しない（rollback先を壊さない）。

  VPS 側の `.env`（本番秘密情報）・DB・package-lock は送信/変更しない。
  Prisma migration がある場合はコンテナ起動時に `prisma migrate deploy` が自動適用する。

  commit固定tagの前提（「そのtag = そのcommitのソース」）を守るため、ローカルの git
  working tree に未commitの変更がある状態では通常デプロイを拒否する（-Force で明示的に
  無視できるが、その場合はtagの中身とcommit履歴が一致しなくなる）。

.PARAMETER DryRun
  転送・デプロイは行わず、作成した tar.gz の中身一覧だけ表示する（送信内容の確認用）。

.PARAMETER NoCache
  Docker イメージをキャッシュ無しで再ビルドする（通常は不要）。

.PARAMETER Force
  git working tree が dirty（未commit変更あり）でもデプロイを続行する。
  通常は使わない（tagの中身とcommit履歴が一致しなくなるため）。

.PARAMETER RollbackTo
  通常デプロイの代わりに、VPS上に既に保持されている stockhome-api:git-<commit> へ
  切り替える（40桁のフルcommit hashを指定する）。ソースの再転送・再ビルドは行わない。
  直近3世代より前のcommitは既に削除されている可能性がある（存在しなければエラーで停止）。

.EXAMPLE
  npm run deploy
  npm run deploy -- -DryRun
  npm run deploy -- -NoCache
  npm run deploy -- -RollbackTo 0123456789abcdef0123456789abcdef01234567
#>
param(
  [switch]$DryRun,
  [switch]$NoCache,
  [switch]$Force,
  [string]$RollbackTo
)

$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$Remote     = 'vps'
$RemoteDir  = 'stockhome'
$Tarball    = 'deploy.tgz'
$Compose    = 'docker-compose.prod.yml'
$KeepImages = 3

function Wait-Health {
  # リモート bash で 200 になるまで最大30回×2秒ポーリング。PowerShell に展開させないため単一引用符で渡す。
  $healthCmd = 'for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4002/health || true); [ "$code" = "200" ] && break; sleep 2; done; echo "$code"'
  return (ssh $Remote $healthCmd).Trim()
}

function Remove-OldImages([string]$KeepTag) {
  # git-* タグのうち、tagが付けられた時刻（LastTagTime）の降順で $KeepImages 件目より
  # 後（古いもの）を削除する。現在deployしたタグ（$KeepTag）は常に最新のため、
  # 通常は削除対象に入らない。個々の docker rmi 失敗（他コンテナ使用中等）は
  # デプロイ全体を失敗させない。
  #
  # 注意: docker images の --format '{{.CreatedAt}}' はスペース区切りの複合値
  # （日付・時刻・TZオフセット・TZ名）であり、単純な sort -k2 では日付部分しか
  # 比較されず同日中の複数世代を正しく順序付けできない。また BuildKit でビルドした
  # イメージは docker inspect の .Created が空になることがあるため、tag付け時刻を
  # 保持する .Metadata.LastTagTime（BuildKitでも設定される）を使う。ローカルの
  # Dockerでダミーイメージ5世代を作成し、直近3世代が正しく残ることを検証済み。
  $pruneCmd = @"
set -e
old=`$(
  for t in `$(docker images stockhome-api --format '{{.Tag}}' | grep '^git-'); do
    lt=`$(docker inspect -f '{{.Metadata.LastTagTime}}' "stockhome-api:`$t")
    echo "`$lt|`$t"
  done | sort -r | tail -n +$($KeepImages + 1) | cut -d'|' -f2
)
for tag in `$old; do
  echo "removing stockhome-api:`$tag"
  docker rmi "stockhome-api:`$tag" || echo "  (skip: in use or already removed)"
done
"@
  ssh $Remote $pruneCmd
}

Push-Location $Root
try {
  # --- ロールバック専用パス: 既存イメージへの切り替えのみ ---------------------
  if ($RollbackTo) {
    if ($RollbackTo -notmatch '^[0-9a-f]{40}$') {
      throw 'RollbackTo には 40桁のフルcommit hashを指定してください（git log --format=%H 等で確認）。'
    }
    $ImageTag = "git-$RollbackTo"
    Write-Host "== ロールバック: stockhome-api:$ImageTag へ切り替え ==" -ForegroundColor Cyan

    $checkCmd = "docker image inspect stockhome-api:$ImageTag >/dev/null 2>&1 && echo FOUND || echo MISSING"
    $exists = (ssh $Remote $checkCmd).Trim()
    if ($exists -ne 'FOUND') {
      throw "VPS上に stockhome-api:$ImageTag が見つかりません（保持されているのは直近${KeepImages}世代のみです）。"
    }

    $remoteCmd = "set -e; cd $RemoteDir; export API_IMAGE_TAG=$ImageTag; docker compose -f $Compose up -d api"
    ssh $Remote $remoteCmd
    if ($LASTEXITCODE -ne 0) { throw 'ロールバック起動（docker compose up -d）に失敗しました。' }

    Write-Host '== ヘルスチェック（最大60秒待機）==' -ForegroundColor Cyan
    $code = Wait-Health
    if ($code -eq '200') {
      Write-Host ('  OK (HTTP {0}) — stockhome-api:{1} へロールバックしました。' -f $code, $ImageTag) -ForegroundColor Green
    }
    else {
      throw ("ヘルスチェック失敗 (HTTP {0})。ログ確認: ssh vps `"docker logs --tail 50 stockhome-api-prod`"" -f $code)
    }
    return
  }

  # --- 通常デプロイ: dirty check ----------------------------------------------
  # commit固定tagの前提（tag = そのcommitのソース）を守るため、未commit変更があれば
  # 既定で中断する。-Force で無視できるが、その場合tagの中身とcommit履歴が一致しない。
  $gitStatus = git status --porcelain
  if ($gitStatus -and -not $Force) {
    throw "未commitの変更があります（commit固定tagの前提が崩れるため中断します）。`n$gitStatus`n`ncommitしてから再実行するか、-Force で強制続行してください（-Force時はtagの中身とcommit履歴が一致しなくなります）。"
  }

  $CommitHash = (git rev-parse HEAD).Trim()
  if ($CommitHash -notmatch '^[0-9a-f]{40}$') { throw "commit hashの取得に失敗しました: $CommitHash" }
  $ImageTag = "git-$CommitHash"
  Write-Host "== deploy対象commit: $CommitHash（tag: $ImageTag）==" -ForegroundColor Cyan
  if ($gitStatus) {
    Write-Host '  ※ -Force により未commit変更を含んだままデプロイします（tagの中身と履歴が一致しません）' -ForegroundColor Yellow
  }

  # tar（bsdtar）が必要
  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'tar コマンドが見つかりません（Windows 10/11 標準の tar.exe が必要です）。'
  }

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

  Write-Host '== [1/5] tarball を作成中 ==' -ForegroundColor Cyan
  tar -czf $Tarball @excludes @include
  if ($LASTEXITCODE -ne 0) { throw 'tar の作成に失敗しました。' }
  Write-Host ('  {0} を作成 ({1:N0} bytes)' -f $Tarball, (Get-Item $Tarball).Length) -ForegroundColor Green

  if ($DryRun) {
    Write-Host '== DryRun: 送信内容（.env / node_modules が含まれていないこと） ==' -ForegroundColor Yellow
    tar -tzf $Tarball
    return
  }

  # --- 2. 転送 ---------------------------------------------------------------
  Write-Host '== [2/5] VPS へ転送中 ==' -ForegroundColor Cyan
  scp $Tarball ("{0}:{1}/{2}" -f $Remote, $RemoteDir, $Tarball)
  if ($LASTEXITCODE -ne 0) { throw 'scp 転送に失敗しました。' }

  # --- 3. 展開 + タグ付きビルド + 再起動 --------------------------------------
  Write-Host '== [3/5] VPS で展開・ビルド（tag: ' $ImageTag '）・コンテナ入れ替え中（数十秒）==' -ForegroundColor Cyan
  $buildFlag = if ($NoCache) { '--no-cache' } else { '' }
  $remoteCmd = "set -e; cd $RemoteDir; tar -xzf $Tarball; rm -f $Tarball; export API_IMAGE_TAG=$ImageTag; docker compose -f $Compose build $buildFlag api; docker compose -f $Compose up -d api"
  ssh $Remote $remoteCmd
  if ($LASTEXITCODE -ne 0) { throw 'VPS でのビルド/起動に失敗しました。' }

  # --- 4. ヘルスチェック（起動直後は未応答のためリトライ）-------------------
  Write-Host '== [4/5] ヘルスチェック（最大60秒待機）==' -ForegroundColor Cyan
  $code = Wait-Health
  if ($code -ne '200') {
    throw ("ヘルスチェック失敗 (HTTP {0})。古いimageは削除していません。ログ確認: ssh vps `"docker logs --tail 50 stockhome-api-prod`"。ロールバックする場合は npm run deploy -- -RollbackTo <直前のcommit hash>" -f $code)
  }
  Write-Host ('  OK (HTTP {0}) — デプロイ完了しました（tag: {1}）。' -f $code, $ImageTag) -ForegroundColor Green

  # --- 5. 古いimage世代の削除（health成功後のみ）------------------------------
  Write-Host "== [5/5] 古いimage世代を整理中（直近 $KeepImages 世代を保持）==" -ForegroundColor Cyan
  Remove-OldImages -KeepTag $ImageTag
}
finally {
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
  Pop-Location
}
