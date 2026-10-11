#!/usr/bin/env bash
# 把 classes.dex、测试截图和日志推到 ci-out 分支（覆盖），本地用 git fetch 取回
set -euo pipefail
P=/tmp/pub; rm -rf $P; mkdir -p $P
cp -r out/emu $P/ 2>/dev/null || true
cp out/classes.dex out/toolchain.txt out/base.apk $P/ 2>/dev/null || true
cp out/*.log $P/ 2>/dev/null || true
cp out-compile.log $P/compile.log 2>/dev/null || true
echo "sha=$GITHUB_SHA run=$GITHUB_RUN_ID job=${JOB_STATUS:-?} at=$(date -u +%FT%TZ)" > $P/RESULT.txt
cd $P && git init -q && git checkout -q -b ci-out
git -c user.name=ci -c user.email=ci@users.noreply.github.com add -A
git -c user.name=ci -c user.email=ci@users.noreply.github.com commit -qm "CI $GITHUB_SHA"
git push -qf "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" ci-out
