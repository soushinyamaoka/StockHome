<#
.SYNOPSIS
  StockHome の API を VPS（ssh エイリアス `vps`）へ再デプロイする。

.DESCRIPTION
  固定した1つの commit から artifact を作り、その commit hash を immutable tag
  （`stockhome-api:git-<40桁commit>`）として build・切替する。

  1. 対象 commit を解決し、実remote `origin/main` に存在することを確認する。
  2. `git archive` でその commit の内容だけを tar.gz にする（working tree の
     未コミット変更は原理的に混入しない。追跡外の `.env` も同様）。
  3. その commit の `scripts/vps-bootstrap.sh` を VPS の固定 path（冪等な
     上書き、lock 不要）へ転送する。
  4. tar.gz を **stdin 経由で** bootstrap script へ渡し、1 回の ssh 呼び出しで
     実行する。bootstrap は lock 取得 → 展開先を空にしてから展開 → そのまま
     `scripts/vps-deploy-runner.sh`（展開されたそのcommit時点のもの）へ
     引き継ぐ。**転送されたペイロードの展開・build・切替・health確認・
     cleanupはすべて同一のlock保持区間の中で行われる。**

  health matrix は internal/public の `/health`(200) と `/api/bridge/health`(401)
  の 4 点で、deploy 成功時と rollback 後の双方で確認する。

  VPS 側の `.env`（本番秘密情報）・DB・volume は送信/変更しない。
  Prisma migration がある場合はコンテナ起動時に `prisma migrate deploy` が自動適用する。

.PARAMETER Commit
  build 対象の commit（既定: 現在の HEAD）。full SHA へ解決され、`origin/main` に
  含まれることを検証する。含まれない場合はデプロイしない。

.PARAMETER DryRun
  転送・デプロイは行わず、作成した tar.gz の中身一覧だけ表示する（送信内容の確認用）。

.PARAMETER NoCache
  Docker イメージをキャッシュ無しで再ビルドする（通常は不要）。

.PARAMETER RollbackTo
  通常デプロイの代わりに、指定 commit へロールバックする。その commit の内容を
  `git archive` で取り直し、通常デプロイと**同じ経路**（lock → 展開 → runner）を
  通るが、runner には `--no-build` を渡すため実際の build は行わず、VPS 上に
  既に存在する `stockhome-api:git-<commit>` イメージへ切り替えるだけになる
  （直近3世代より前の commit は削除済みの可能性があり、その場合はエラーで停止）。

.EXAMPLE
  npm run deploy
  npm run deploy -- -DryRun
  npm run deploy -- -Commit 0123456789abcdef0123456789abcdef01234567
  npm run deploy -- -RollbackTo 0123456789abcdef0123456789abcdef01234567
#>
param(
  [string]$Commit,
  [switch]$DryRun,
  [switch]$NoCache,
  [string]$RollbackTo
)

$ErrorActionPreference = 'Stop'

$Root           = Split-Path -Parent $PSScriptRoot
$Remote         = 'vps'
$RemoteDir      = 'stockhome'
$Tarball        = 'deploy.tgz'
$BootstrapLocal = 'vps-bootstrap.local.sh'
$BootstrapPath  = "$RemoteDir/vps-bootstrap.sh"
$KeepImages     = 3

# runner/bootstrap が返す DEPLOY_RESULT を人間向けの説明にする
$ResultText = @{
  'success'                                            = 'デプロイ成功（health matrix 4点すべて期待どおり）'
  'rolled_back_to_previous'                             = 'health 確認に失敗したため、直前のイメージへ自動ロールバックしました（復旧後の health matrix は正常）'
  'lock_failed'                                         = '他のデプロイ/ロールバックが進行中のため中止しました（何も転送・展開・変更していません）'
  'flock_unavailable'                                   = 'VPS 側に flock コマンドが無く、排他制御できないため中止しました'
  'missing_tag'                                         = 'tag が指定されませんでした（内部エラー）'
  'runner_missing_in_release'                           = '展開した内容に scripts/vps-deploy-runner.sh が含まれていません'
  'missing_required_arg'                                = 'runner の呼び出し引数が不足しています（内部エラー）'
  'release_dir_missing'                                 = '展開先ディレクトリが見つかりません（内部エラー）'
  'compose_file_missing'                                = '展開した内容に docker-compose.prod.yml が含まれていません'
  'previous_image_preserve_failed'                       = '現在稼働中のイメージを安全に保全できなかったため、ビルド・切替を行わずに中止しました（現行コンテナは無変更）'
  'build_failed'                                        = 'VPS でのビルドに失敗しました（切替前に停止、現行コンテナは無変更）'
  'up_failed_no_previous_image'                          = 'コンテナ起動に失敗し、ロールバック先も特定できませんでした'
  'rollback_target_missing'                              = '指定した commit のイメージが VPS 上に存在しません（保持は直近3世代のみ）'
  'health_failed_no_previous_image'                      = 'health 確認に失敗しましたが、ロールバック先を特定できませんでした'
  'rollback_up_failed'                                  = 'ロールバックのコンテナ起動に失敗しました'
  'rollback_health_failed_manual_intervention_required'  = 'ロールバックを試みましたが復旧できませんでした。手動対応が必要です'
}

function Invoke-DeployRemote([string]$Tag, [string]$ExtraArgs) {
  Write-Host "== bootstrap を転送中（固定 path、上書き）==" -ForegroundColor Cyan
  scp $BootstrapLocal ("{0}:{1}" -f $Remote, $BootstrapPath)
  if ($LASTEXITCODE -ne 0) { throw 'bootstrap script の転送に失敗しました。' }
  ssh $Remote "chmod +x $BootstrapPath"
  if ($LASTEXITCODE -ne 0) { throw 'bootstrap script への実行権限付与に失敗しました。' }

  Write-Host "== tarball を stdin 経由で送信し、lock 取得・展開・build・切替・health 確認を実行中 ==" -ForegroundColor Cyan
  $remoteCmd = "bash $BootstrapPath --tag $Tag --keep $KeepImages $ExtraArgs"
  # cmd.exeの `<` によるファイルリダイレクトはバイト列をそのままssh.exeのstdinへ渡す。
  # PowerShellのパイプ（|）はテキストpipelineを経由し文字コード変換でバイナリを
  # 壊すおそれがあるため使わない。
  $output = cmd /c "ssh $Remote ""$remoteCmd"" < ""$Tarball""" 2>&1
  $exitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-Host "  $_" }

  $resultLine = $output | Where-Object { $_ -match '^DEPLOY_RESULT=' } | Select-Object -Last 1
  $result = if ($resultLine) { ($resultLine -replace '^DEPLOY_RESULT=', '').Trim() } else { '' }

  if (-not $result) {
    throw "bootstrap/runner から DEPLOY_RESULT を取得できませんでした（cmd exit=$exitCode）。VPS 側の状態を手動で確認してください。"
  }

  $text = if ($ResultText.ContainsKey($result)) { $ResultText[$result] } else { $result }
  if ($result -eq 'success' -or $result -eq 'rolled_back_to_previous') {
    Write-Host "  OK — $text" -ForegroundColor Green
  }
  else {
    throw "$text（DEPLOY_RESULT=$result, cmd exit=$exitCode）"
  }
}

function Resolve-DeployCommit([string]$Target) {
  $hash = (git rev-parse --verify "$Target^{commit}" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "commit を解決できませんでした: $Target" }
  $hash = $hash.Trim()
  if ($hash -notmatch '^[0-9a-f]{40}$') { throw "commit hash の形式が不正です: $hash" }

  # 実remote の最新を取得してから、対象 commit が origin/main に含まれるか検証する。
  # （ローカルにだけ存在する commit や、push 前の commit をデプロイ/ロールバックしないため）
  git fetch origin main --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main に失敗しました。' }
  git merge-base --is-ancestor $hash origin/main
  if ($LASTEXITCODE -ne 0) {
    throw "commit $hash は origin/main に含まれていません。push してから再実行してください。"
  }
  return $hash
}

function New-DeployArtifact([string]$CommitHash) {
  Write-Host '== artifact を作成中（git archive）==' -ForegroundColor Cyan
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }

  # Docker ビルドコンテキストが必要とするファイル群 + VPS 実行用 runner/bootstrap
  $paths = @(
    'package.json',
    'package-lock.json',
    'packages/shared',
    'apps/api',
    'apps/mobile/package.json',
    'docker-compose.prod.yml',
    '.dockerignore',
    'scripts/vps-bootstrap.sh',
    'scripts/vps-deploy-runner.sh',
    ':(exclude)apps/api/.env.example'
  )

  git archive --format=tar.gz -o $Tarball $CommitHash -- @paths
  if ($LASTEXITCODE -ne 0) { throw 'git archive に失敗しました。' }
  Write-Host ('  {0} を作成 ({1:N0} bytes)' -f $Tarball, (Get-Item $Tarball).Length) -ForegroundColor Green

  # Windows標準のtar.exe(bsdtar)はGNU tar固有の--force-localを受け付けない。
  # $Tarballはリポジトリルート直下の相対パスなので指定不要
  $entries = tar -tzf $Tarball
  if ($entries -notcontains 'scripts/vps-deploy-runner.sh') {
    throw "scripts/vps-deploy-runner.sh が commit $CommitHash に含まれていません。"
  }
  $leaked = $entries | Where-Object { $_ -match '(^|/)\.env($|\.)' -or $_ -match 'node_modules' }
  if ($leaked) { throw "artifact に含めてはいけないファイルが含まれています: $($leaked -join ', ')" }
  return $entries
}

Push-Location $Root
try {
  $isRollback = [bool]$RollbackTo
  $target = if ($isRollback) { $RollbackTo } elseif ($Commit) { $Commit } else { 'HEAD' }

  if ($isRollback -and $RollbackTo -notmatch '^[0-9a-f]{40}$') {
    throw 'RollbackTo には 40桁のフル commit hash を指定してください（git log --format=%H 等で確認）。'
  }

  # --- 1. 対象 commit の解決と origin/main 上での存在確認 --------------------
  Write-Host '== [1/4] 対象 commit を確認中 ==' -ForegroundColor Cyan
  $CommitHash = Resolve-DeployCommit $target
  $ImageTag = "git-$CommitHash"
  Write-Host "  対象 commit: $CommitHash" -ForegroundColor Green
  Write-Host "  image tag  : stockhome-api:$ImageTag" -ForegroundColor Green
  if ($isRollback) {
    Write-Host "  モード     : ロールバック（--no-build、既存イメージへの切替のみ）" -ForegroundColor Yellow
  }

  # --- 2. artifact 作成（固定 commit の内容のみ） ---------------------------
  # git archive は commit に含まれる追跡ファイルだけを出力するため、working tree の
  # 未コミット変更・未追跡ファイル・gitignore済みの.envは原理的に混入しない。
  $entries = New-DeployArtifact $CommitHash

  # bootstrap script もその commit の内容から取り出す（deploy.ps1 実行時点の
  # working tree ではなく、実際に build/展開される commit と完全に一致させるため）
  git show "${CommitHash}:scripts/vps-bootstrap.sh" > $BootstrapLocal
  if ($LASTEXITCODE -ne 0) { throw "commit $CommitHash に scripts/vps-bootstrap.sh がありません。" }

  if ($DryRun) {
    Write-Host '== DryRun: 送信内容 ==' -ForegroundColor Yellow
    $entries | ForEach-Object { Write-Host "  $_" }
    Remove-Item $BootstrapLocal -Force -ErrorAction SilentlyContinue
    return
  }

  # --- 3/4. bootstrap転送 + lock取得・展開・build・切替・health確認 ----------
  $extraArgs = ''
  if ($NoCache -and -not $isRollback) { $extraArgs = '--no-cache' }
  if ($isRollback) { $extraArgs = '--no-build' }

  Invoke-DeployRemote -Tag $ImageTag -ExtraArgs $extraArgs
}
finally {
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
  if (Test-Path $BootstrapLocal) { Remove-Item $BootstrapLocal -Force }
  Pop-Location
}
