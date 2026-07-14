#!/usr/bin/env sh
# Build-time embedding-model prep. Fetches all-MiniLM-L6-v2 from Qdrant's
# fastembed GCS bucket (reliable — NOT huggingface.co, whose Xet storage backend
# now 403s), quantizes it to uint8, and lays it out for @huggingface/transformers
# so deep-search makes ZERO network calls at runtime. Fails loudly on any error.
#
# Usage: sh scripts/prepare-embedding-model.sh [MODELS_DIR]   (default: ./models)
set -eu

MODELS_DIR="${1:-./models}"
REPO="Xenova/all-MiniLM-L6-v2"
DST="$MODELS_DIR/$REPO"
SRC_URL="https://storage.googleapis.com/qdrant-fastembed/sentence-transformers-all-MiniLM-L6-v2.tar.gz"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[model] downloading $SRC_URL"
curl -fSL --retry 3 --retry-delay 2 -o "$TMP/m.tar.gz" "$SRC_URL"
tar xzf "$TMP/m.tar.gz" -C "$TMP"
SRC="$TMP/fast-all-MiniLM-L6-v2"

mkdir -p "$DST/onnx"
# Tokenizer + config (small, plain JSON — needed by transformers.js).
cp "$SRC/config.json" "$SRC/tokenizer.json" "$SRC/tokenizer_config.json" \
   "$SRC/special_tokens_map.json" "$DST/"

echo "[model] quantizing fp32 -> uint8"
python3 "$SCRIPT_DIR/quantize_onnx.py" "$SRC/model.onnx" "$DST/onnx/model_quantized.onnx"

test -f "$DST/onnx/model_quantized.onnx"
echo "[model] ready at $DST:"
ls -lh "$DST" "$DST/onnx"
