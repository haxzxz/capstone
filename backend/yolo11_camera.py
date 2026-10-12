"""Run YOLO11 directly on a local camera without starting the FastAPI app."""

import argparse
import time

import cv2
import torch
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
    parser.add_argument("--model", default="yolo11n.pt", help="YOLO model path or Ultralytics model name (default: yolo11n.pt).")
    parser.add_argument("--device", default="0", help="Inference device, such as 0, cuda:0, or cpu (default: 0).")
    parser.add_argument("--imgsz", type=int, default=416, help="Inference image size (default: 416).")
    parser.add_argument("--conf", type=float, default=0.35, help="Minimum detection confidence (default: 0.35).")
    return parser.parse_args()


def main():
    args = parse_args()
    using_cuda = args.device.isdigit() or args.device.startswith("cuda")
    if using_cuda and not torch.cuda.is_available():
        raise SystemExit(
            "CUDA is unavailable to PyTorch. Install the CUDA-enabled PyTorch build, "
            "or rerun with --device cpu."
        )

    if using_cuda:
        device_index = int(args.device.split(":")[-1]) if ":" in args.device else int(args.device)
        print(f"Loading {args.model} on {torch.cuda.get_device_name(device_index)}...")
    else:
        print(f"Loading {args.model} on {args.device}...")

    model = YOLO(args.model)
    results = model.predict(
        source=args.camera,
        stream=True,
        stream_buffer=False,
        device=args.device,
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
