"""Run YOLO11 directly on a local camera without starting the FastAPI app."""

import argparse
import time

import cv2
import torch
from PIL import Image
from ultralytics import YOLO


def camera_source(value):
    """Convert numeric camera IDs to integers; keep stream paths and URLs as strings."""
    try:
        return int(value)
    except ValueError:
        return value


def parse_args():
    parser = argparse.ArgumentParser(description="Run direct YOLO11 person detection on a camera.")
    parser.add_argument("--camera", type=camera_source, default=0, help="Camera index, video path, or stream URL (default: 0).")
    parser.add_argument("--model", default="yolo11m.pt", help="YOLO model path or Ultralytics model name (default: yolo11m.pt).")
    parser.add_argument("--device", default="auto", help="Inference device: auto, 0, cuda:0, or cpu (default: auto).")
    parser.add_argument("--imgsz", type=int, default=416, help="Inference image size (default: 416).")
    parser.add_argument("--conf", type=float, default=0.65, help="Minimum detection confidence (default: 0.65).")
    return parser.parse_args()


def main():
    args = parse_args()
    device = args.device
    if device == "auto":
        device = "0" if torch.cuda.is_available() else "cpu"
    using_cuda = device.isdigit() or device.startswith("cuda")
    if using_cuda and not torch.cuda.is_available():
        raise SystemExit(
            "CUDA is unavailable to PyTorch. Install the CUDA-enabled PyTorch build, "
            "or rerun with --device cpu."
        )

    if using_cuda:
        device_index = int(device.split(":")[-1]) if ":" in device else int(device)
        print(f"Loading {args.model} on {torch.cuda.get_device_name(device_index)}...")
    else:
        print(f"Loading {args.model} on {device}...")

    try:
        model = YOLO(args.model)
        model.to(f"cuda:{device}" if device.isdigit() else device)
        model.predict(
            Image.new("RGB", (args.imgsz, args.imgsz)),
            device=device,
            imgsz=args.imgsz,
            quantize=16 if using_cuda else 32,
            classes=[0],
            verbose=False,
        )
        if using_cuda:
            torch.cuda.synchronize(device_index)
    except Exception:
        if args.device != "auto" or not using_cuda:
            raise
        print("GPU warmup failed; continuing on CPU.")
        torch.cuda.empty_cache()
        device = "cpu"
        using_cuda = False
        model = YOLO(args.model)

    results = model.predict(
        source=args.camera,
        stream=True,
        stream_buffer=False,
        device=device,
        imgsz=args.imgsz,
        conf=args.conf,
        classes=[0],
        quantize=16 if using_cuda else 32,
        verbose=False,
    )

    print("Camera running. Press q or Esc in the video window to quit.")
    previous_frame_at = None
    try:
        for result in results:
            now = time.perf_counter()
            fps = 1 / (now - previous_frame_at) if previous_frame_at is not None and now > previous_frame_at else 0
            previous_frame_at = now

            frame = result.plot()
            cv2.putText(
                frame,
                f"YOLO11 camera FPS: {fps:.1f}",
                (16, 32),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (50, 230, 170),
                2,
                cv2.LINE_AA,
            )
            cv2.imshow("YOLO11 Direct Camera", frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break
    except KeyboardInterrupt:
        pass
    finally:
        close = getattr(results, "close", None)
        if close:
            close()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
