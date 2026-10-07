#!/usr/bin/env bash
# 云朵天气 · WE 原生渲染移植：按固定提交拉上游和依赖源码，再打上移植补丁。
# 用法：we/fetch.sh <目标目录>   → 目标目录/wsr  lz4  freetype
# 只走 GitHub（CI 和本机代理都只放行 GitHub）；Eigen 用 GitHub 上的镜像，提交号和上游子模块记录的一致。
set -euo pipefail
DST=${1:?usage: fetch.sh <dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DST"

pin() {   # pin <url> <dir> <commit>：浅拉一个提交
  local url=$1 dir=$2 rev=$3
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD)" = "$rev" ]; then return; fi
  rm -rf "$dir"; mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$rev"
  git -C "$dir" checkout -q FETCH_HEAD
}

WSR="$DST/wsr"
pin https://github.com/CaptSilver/wallpaper-scene-renderer "$WSR" eb5a60d755566341c1858f1eaed52b4aac1ca2be
pin https://github.com/eigen-mirror/eigen            "$WSR/third_party/Eigen"         bc3b39870ecb690a623a3f49149a358b95c5781d
pin https://github.com/KhronosGroup/SPIRV-Reflect    "$WSR/third_party/SPIRV-Reflect" 62ca825c692334ed758027b908c5aafbbc76243f
pin https://github.com/KhronosGroup/glslang          "$WSR/third_party/glslang"       f0bd0257c308b9a26562c1a30c4748a0219cc951
pin https://github.com/mborgerding/kissfft           "$WSR/third_party/kissfft"       1e56ac81667d53363a8483a9e53afdbdf49ddfab
pin https://github.com/mackron/miniaudio             "$WSR/third_party/miniaudio"     9634bedb5b5a2ca38c1ee7108a9358a4e233f14d
pin https://github.com/nlohmann/json                 "$WSR/third_party/nlohmann"      55f93686c01528224f448c19128836e7df245f72
pin https://github.com/lz4/lz4                       "$DST/lz4"                       0774d05537f9762f838f7ab541b7765f1a729cb5
pin https://github.com/freetype/freetype             "$DST/freetype"                  VER-2-13-3 2>/dev/null || {
  rm -rf "$DST/freetype"; git clone -q --depth 1 --branch VER-2-13-3 https://github.com/freetype/freetype "$DST/freetype"; }

# 移植补丁：推送描述符兼容垫片、可选设备扩展、格式 5 贴图、栅栏等待超时溢出
if ! git -C "$WSR" diff --quiet; then git -C "$WSR" checkout -q -- .; fi
git -C "$WSR" apply "$HERE/patch/upstream.patch"
cp "$HERE/patch/vvk_push_emu.inl" "$WSR/src/Vulkan/include/vvk/vvk_push_emu.inl"
echo "fetched into $DST"
