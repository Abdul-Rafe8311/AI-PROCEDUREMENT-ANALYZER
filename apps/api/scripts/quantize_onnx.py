"""Dynamic uint8 weight-quantization of an ONNX model.

This is exactly how the (now Xet-gated) Xenova quantized model was produced:
~4x smaller weights, ~99.6% cosine parity with fp32 for MiniLM sentence
embeddings. Run at Docker build time so the runtime image ships the small model.

Usage: python3 quantize_onnx.py <src fp32 .onnx> <dst quantized .onnx>
"""
import sys

from onnxruntime.quantization import QuantType, quantize_dynamic

src, dst = sys.argv[1], sys.argv[2]
quantize_dynamic(src, dst, weight_type=QuantType.QUInt8)
print(f"[quantize] {src} -> {dst}")
