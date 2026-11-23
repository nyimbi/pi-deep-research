#!/usr/bin/env bash
# Builds llama-server with the Unlimited-OCR-2 patch into ./.llama-ocr (git-ignored: see .gitignore).
# The patch is the reviewed copy in docs/research/unlimited-ocr-llama-cpp/; the build refuses any other.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
patch="$here/docs/research/unlimited-ocr-llama-cpp/unlimited-ocr2.patch"
want="f2c337b512b9e4aec99750f857ce2b0766d702126d8d3702ac032fde0e583f41"
have="$(shasum -a 256 "$patch" | cut -d' ' -f1)"
[ "$have" = "$want" ] || { echo "patch hash $have is not the reviewed $want; review the change first" >&2; exit 1; }
dir="${LLAMA_OCR_DIR:-$here/.llama-ocr}"
mkdir -p "$dir"
if [ ! -d "$dir/src/.git" ]; then
	git init -q "$dir/src"
	git -C "$dir/src" remote add origin https://github.com/ggml-org/llama.cpp
fi
git -C "$dir/src" fetch -q --depth 1 origin tag b11913
git -C "$dir/src" checkout -q --detach FETCH_HEAD
git -C "$dir/src" apply "$patch"
# The UI assets are downloaded per build number; an API server does not need them.
cmake -S "$dir/src" -B "$dir/build" -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DLLAMA_BUILD_UI=OFF \
	-DLLAMA_BUILD_NUMBER=11913 -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build "$dir/build" --target llama-server -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
echo "built: $dir/build/bin/llama-server"
echo 'serve: llama-server -m Unlimited-OCR-2-AD-Q6_K.gguf --mmproj mmproj-Unlimited-OCR-2-F16.gguf --port 8089 -ngl 99 -c 16384 -np 1'
