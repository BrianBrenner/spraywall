# Models

- `holds-detect.onnx` — [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2) (fp32 export). Single-class climbing hold detector: 2560×2560 RGB input, output `[1, 5, 134400]` (cx, cy, w, h, score). AGPL-3.0, see `holds-detect.LICENSE`.
- `sam-encoder.onnx`, `sam-decoder.onnx` — [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform) (int8 quantized `vision_encoder` and `prompt_encoder_mask_decoder`). SlimSAM, a pruned Segment Anything; Apache-2.0. Pre/post-processing lives in `src/lib/samCore.ts`.
