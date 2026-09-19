#!/bin/bash
# StockHome API deploy/rollback本体（VPS上で実行する）。
# scripts/deploy.ps1がgit archiveで固めたtarballと一緒に転送し、展開後に呼び出す。
#
# 責務:
#   - 同一service単位のdeploy排他lock（flock、非blocking。競合時は何もせず安全停止）
#   - 切替前に現行imageへimmutable tagを確定・保全する（自動rollback先）
#   - 通常時: build → up -d → health matrix → 成功ならcleanup / 失敗なら自動rollback
#   - --rollback-only時: buildせず指定tagへup -d → health matrix
#   - health matrixはinternal/public health(200)とinternal/public bridge(401)の4点
#
# 意図的に`set -e`を使わない。health失敗後の自動rollback処理へ確実に到達させるため、
# 各コマンドの成否は個別にifで判定する。
set -u
set -o pipefail

# 既定値はproduction。環境変数で上書きできるのは、productionと分離した環境で
# 正常deploy・health失敗からの自動復旧・明示rollback・世代保持・lock競合を
# 検証するため（VPS管理レビューの再レビュー条件2）。production実行時は
# deploy.ps1がこれらを設定しないので、常に下記の既定値が使われる。
REMOTE_DIR="${SH_DEPLOY_DIR:-$HOME/stockhome}"
COMPOSE="${SH_COMPOSE_FILE:-docker-compose.prod.yml}"
PUBLIC_URL="${SH_PUBLIC_URL:-https://stockhome.homehub-tools.dedyn.io}"
INTERNAL_URL="${SH_INTERNAL_URL:-http://127.0.0.1:4002}"
CONTAINER="${SH_CONTAINER:-stockhome-api-prod}"
IMAGE_REPO="${SH_IMAGE_REPO:-stockhome-api}"
LOCKFILE="$REMOTE_DIR/.deploy.lock"

NEW_TAG=""
KEEP_GENERATIONS=3
NO_CACHE=""
ROLLBACK_ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) NEW_TAG="${2:-}"; shift 2 ;;
    --keep) KEEP_GENERATIONS="${2:-3}"; shift 2 ;;
    --no-cache) NO_CACHE="1"; shift ;;
    --rollback-only) ROLLBACK_ONLY="1"; shift ;;
    *) echo "DEPLOY_RESULT=unknown_arg:$1"; exit 2 ;;
  esac
done

if [ -z "$NEW_TAG" ]; then
  echo "DEPLOY_RESULT=missing_tag"
  exit 2
fi

cd "$REMOTE_DIR" || { echo "DEPLOY_RESULT=chdir_failed"; exit 3; }

# --- 排他lock（非blocking。取得できなければ何も変更せず即停止） ---------------
# flock自体が無い環境では排他を保証できないため、lock競合と区別して明示的に停止する
# （「他のdeploy進行中」と誤報告しないため）。
if ! command -v flock >/dev/null 2>&1; then
  echo "DEPLOY_RESULT=flock_unavailable"
  exit 11
fi
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  echo "DEPLOY_RESULT=lock_failed"
  exit 10
fi

# --- health matrix。起動直後は未応答なのでinternal healthだけリトライする -----
wait_health_matrix() {
  local tries=0
  local max_tries=30
  local ih=000
  while [ $tries -lt $max_tries ]; do
    ih=$(curl -s -o /dev/null -w '%{http_code}' "$INTERNAL_URL/health" 2>/dev/null || echo 000)
    if [ "$ih" = "200" ]; then break; fi
    tries=$((tries + 1))
    sleep 2
  done
  local ib ph pb
  ib=$(curl -s -o /dev/null -w '%{http_code}' "$INTERNAL_URL/api/bridge/health" 2>/dev/null || echo 000)
  ph=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/health" 2>/dev/null || echo 000)
  pb=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/bridge/health" 2>/dev/null || echo 000)
  echo "HEALTH_MATRIX=internal_health=$ih internal_bridge=$ib public_health=$ph public_bridge=$pb"
  [ "$ih" = "200" ] && [ "$ib" = "401" ] && [ "$ph" = "200" ] && [ "$pb" = "401" ]
}

# --- rollback専用: buildせず既存tagへ切り替えてhealth確認するだけ -------------
if [ -n "$ROLLBACK_ONLY" ]; then
  if ! docker image inspect "$IMAGE_REPO:$NEW_TAG" >/dev/null 2>&1; then
    echo "DEPLOY_RESULT=rollback_target_missing"
    exit 22
  fi
  export API_IMAGE_TAG="$NEW_TAG"
  if ! docker compose -f "$COMPOSE" up -d --no-build api; then
    echo "DEPLOY_RESULT=rollback_up_failed"
    exit 21
  fi
  if wait_health_matrix; then
    echo "DEPLOY_RESULT=rollback_success"
    exit 0
  fi
  echo "DEPLOY_RESULT=rollback_health_failed"
  exit 34
fi

# --- 切替前に、現行imageのimmutable tagを確定・保全する ----------------------
# 目的: health失敗時の自動rollback先を、切替前に必ず1つ固定しておく。
# 旧方式でbuildされたcontainerはcompose自動命名（stockhome-api:latest等）のため、
# tag名の文字列加工では安全に取り出せない。repo:tag形式でなければ、この時点で
# 一度だけ pre-v2-<timestamp> というimmutable tagを付けて保全する
# （可変tagをrollback根拠にしない、という方針に沿う）。
PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo "")
PREVIOUS_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "")
ROLLBACK_TAG=""

if [ -n "$PREVIOUS_IMAGE" ]; then
  case "$PREVIOUS_IMAGE" in
    "$IMAGE_REPO":*)
      ROLLBACK_TAG="${PREVIOUS_IMAGE#$IMAGE_REPO:}"
      ;;
    *)
      # 旧方式のimage。image IDから一度だけimmutable tagを作って保全する
      if [ -n "$PREVIOUS_IMAGE_ID" ]; then
        ROLLBACK_TAG="pre-v2-$(date +%Y%m%d%H%M%S)"
        if docker tag "$PREVIOUS_IMAGE_ID" "$IMAGE_REPO:$ROLLBACK_TAG"; then
          echo "PRESERVED_PREVIOUS_AS=$IMAGE_REPO:$ROLLBACK_TAG"
        else
          ROLLBACK_TAG=""
        fi
      fi
      ;;
  esac
fi

# 保全したrollback先が実在することを、切替前に必ず確認する
if [ -n "$ROLLBACK_TAG" ] && ! docker image inspect "$IMAGE_REPO:$ROLLBACK_TAG" >/dev/null 2>&1; then
  ROLLBACK_TAG=""
fi

echo "PREVIOUS_IMAGE=$PREVIOUS_IMAGE"
echo "ROLLBACK_TAG=$ROLLBACK_TAG"
echo "NEW_TAG=$NEW_TAG"

# --- build（この時点ではまだ切り替えない。build失敗時は現行が動き続ける） -----
export API_IMAGE_TAG="$NEW_TAG"
BUILD_ARGS=""
if [ -n "$NO_CACHE" ]; then BUILD_ARGS="--no-cache"; fi

if ! docker compose -f "$COMPOSE" build $BUILD_ARGS api; then
  echo "DEPLOY_RESULT=build_failed"
  exit 20
fi

# --- 切替 --------------------------------------------------------------------
if ! docker compose -f "$COMPOSE" up -d --no-build api; then
  echo "DEPLOY_RESULT=up_failed_attempting_rollback"
  if [ -n "$ROLLBACK_TAG" ]; then
    export API_IMAGE_TAG="$ROLLBACK_TAG"
    if docker compose -f "$COMPOSE" up -d --no-build api && wait_health_matrix; then
      echo "DEPLOY_RESULT=rolled_back_to_previous"
      exit 32
    fi
    echo "DEPLOY_RESULT=rollback_health_failed_manual_intervention_required"
    exit 33
  fi
  echo "DEPLOY_RESULT=up_failed_no_previous_image"
  exit 21
fi

if wait_health_matrix; then
  echo "DEPLOY_RESULT=success"
  # --- cleanup: health成功後だけ実行する ------------------------------------
  # 直近KEEP_GENERATIONS世代を保持し、それより古いgit-*を削除する。
  # running（=NEW_TAG）と直前の成功image（=ROLLBACK_TAG）は世代数に関係なく必ず除外する。
  # LastTagTimeでソートする理由: docker images --format '{{.CreatedAt}}'は
  # スペース区切りの複合値で、単純sortだと同日中の複数世代を誤順序付けする。
  # BuildKitでbuildしたimageはdocker inspectの.Createdが空になるため使わない。
  old=$(
    for t in $(docker images "$IMAGE_REPO" --format '{{.Tag}}' | grep '^git-'); do
      lt=$(docker inspect -f '{{.Metadata.LastTagTime}}' "$IMAGE_REPO:$t" 2>/dev/null || echo "")
      [ -n "$lt" ] && echo "$lt|$t"
    done | sort -r | tail -n +$((KEEP_GENERATIONS + 1)) | cut -d'|' -f2
  )
  for tag in $old; do
    if [ "$tag" = "$NEW_TAG" ] || [ "$tag" = "$ROLLBACK_TAG" ]; then
      echo "keeping stockhome-api:$tag (running or previous)"
      continue
    fi
    echo "removing $IMAGE_REPO:$tag"
    docker rmi "$IMAGE_REPO:$tag" || echo "  (skip: in use or already removed)"
  done
  exit 0
fi

# --- health失敗: 保全しておいたprevious tagへ自動rollback --------------------
echo "DEPLOY_RESULT=health_failed_attempting_rollback"
if [ -z "$ROLLBACK_TAG" ]; then
  echo "DEPLOY_RESULT=health_failed_no_previous_image"
  exit 30
fi

export API_IMAGE_TAG="$ROLLBACK_TAG"
if ! docker compose -f "$COMPOSE" up -d --no-build api; then
  echo "DEPLOY_RESULT=rollback_up_failed"
  exit 31
fi

if wait_health_matrix; then
  echo "DEPLOY_RESULT=rolled_back_to_previous"
  # 失敗した新imageは調査のため残す（cleanupしない）
  exit 32
fi

echo "DEPLOY_RESULT=rollback_health_failed_manual_intervention_required"
exit 33
