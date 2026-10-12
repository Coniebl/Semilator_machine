#!/usr/bin/env python3
"""
Semilator Machine Learning Dataset & Camera Service
Provides:
  - High-performance MJPEG live preview on /video_feed
  - Single frame capture on POST /capture
  - Continuous burst capture (5 FPS) on POST /burst/start and POST /burst/stop
  - System status & dataset statistics on GET /status
  - Completely offline local storage in dataset/<category>/

Hardware Support:
  - Raspberry Pi 5 with Pi Camera (Picamera2) - with proper BGR to RGB color conversion
  - Fallback to OpenCV (V4L2) or synthetic test patterns
"""

import os
import io
import time
import json
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 5000
DATASET_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dataset")
os.makedirs(DATASET_ROOT, exist_ok=True)

# Hardware & Library Detection
HAS_PICAM = False
HAS_CV2 = False
HAS_NUMPY = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    pass

try:
    from picamera2 import Picamera2
    HAS_PICAM = True
except ImportError:
    try:
        from picam2 import Picamera2
        HAS_PICAM = True
    except ImportError:
        pass

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    pass

from PIL import Image, ImageDraw

def count_local_dataset():
    """Counts total photos currently stored across all category folders."""
    count = 0
    if os.path.exists(DATASET_ROOT):
        for root, dirs, files in os.walk(DATASET_ROOT):
            for f in files:
                if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                    count += 1
    return count

class CameraManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.picam2 = None
        self.cap = None
        self.is_running = False
        
        self.last_frame_bytes = None
        self.last_image = None
        self.active_label = "fingerlings"
        self.burst_active = False
        self.burst_interval = 0.2  # 5 FPS
        self.last_saved_file = None
        self.total_captured = count_local_dataset()
        self.mode = "mock"

        self.init_camera()
        self.start_thread()

    def init_camera(self):
        if HAS_PICAM:
            try:
                self.picam2 = Picamera2()
                # Configure 1280x720 preview / capture configuration
                config = self.picam2.create_preview_configuration(main={"size": (1280, 720), "format": "RGB888"})
                self.picam2.configure(config)
                self.picam2.start()
                self.mode = "picamera2"
                print("[CAMERA] Initialized Raspberry Pi Camera via Picamera2 (RGB888 mode)")
                return
            except Exception as e:
                print(f"[CAMERA] Picamera2 init failed: {e}. Falling back to OpenCV/Mock.")

        if HAS_CV2:
            try:
                self.cap = cv2.VideoCapture(0)
                if self.cap.isOpened():
                    self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                    self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    self.mode = "opencv"
                    print("[CAMERA] Initialized Camera via OpenCV V4L2")
                    return
            except Exception as e:
                print(f"[CAMERA] OpenCV init failed: {e}")

        self.mode = "mock"
        print("[CAMERA] Running in Mock Test Mode (no physical camera detected)")

    def _convert_to_rgb_image(self, arr):
        """
        Converts raw camera array into a PIL Image with true RGB colors.
        Picamera2 / libcamera and OpenCV output BGR byte ordering by default on Linux/ARM.
        Swapping channel 0 and 2 fixes the red/blue swap (e.g. red jackets appear red).
        """
        if arr is None:
            return None

        if len(arr.shape) == 3:
            channels = arr.shape[2]
            if channels == 3:
                # BGR -> RGB
                if HAS_CV2:
                    rgb_arr = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)
                elif HAS_NUMPY:
                    rgb_arr = np.ascontiguousarray(arr[:, :, ::-1])
                else:
                    rgb_arr = arr[:, :, ::-1]
            elif channels == 4:
                # BGRA/XBGR -> RGB
                if HAS_CV2:
                    rgb_arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2RGB)
                elif HAS_NUMPY:
                    rgb_arr = np.ascontiguousarray(arr[:, :, [2, 1, 0]])
                else:
                    rgb_arr = arr[:, :, [2, 1, 0]]
            else:
                rgb_arr = arr
        else:
            rgb_arr = arr

        return Image.fromarray(rgb_arr)

    def capture_new_frame(self):
        """Captures a single raw frame and returns (jpeg_bytes, PIL_Image)."""
        if self.mode == "picamera2" and self.picam2:
            try:
                arr = self.picam2.capture_array()
                img = self._convert_to_rgb_image(arr)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                return buf.getvalue(), img
            except Exception as e:
                print(f"[PICAM CAPTURE ERROR] {e}")

        elif self.mode == "opencv" and self.cap:
            try:
                ret, frame = self.cap.read()
                if ret:
                    if HAS_CV2:
                        rgb_arr = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    elif HAS_NUMPY:
                        rgb_arr = np.ascontiguousarray(frame[:, :, ::-1])
                    else:
                        rgb_arr = frame[:, :, ::-1]
                    img = Image.fromarray(rgb_arr)
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=80)
                    return buf.getvalue(), img
            except Exception as e:
                print(f"[OPENCV CAPTURE ERROR] {e}")

        # Fallback Mock Frame with live counter and timestamp
        img = Image.new("RGB", (640, 480), color=(26, 54, 93))
        draw = ImageDraw.Draw(img)
        t_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        draw.text((30, 30), "SEMILATOR CAMERA STREAM (MOCK MODE)", fill=(255, 255, 255))
        draw.text((30, 80), f"Mode: {self.mode}", fill=(200, 200, 200))
        draw.text((30, 130), f"Time: {t_str}", fill=(255, 255, 0))
        draw.text((30, 180), f"Active Label: {self.active_label}", fill=(100, 255, 100))
        draw.text((30, 230), f"Dataset Count: {self.total_captured}", fill=(255, 200, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue(), img

    def save_capture(self, label=None):
        """Thread-safe save of the current frame to the offline dataset directory."""
        label = label or self.active_label or "unlabeled"
        folder = os.path.join(DATASET_ROOT, label)
        os.makedirs(folder, exist_ok=True)

        with self.lock:
            img = self.last_image.copy() if self.last_image else None

        if img is None:
            _, img = self.capture_new_frame()

        if img is None:
            return {"success": False, "error": "No camera frame available"}

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{label}_{timestamp}.jpg"
        filepath = os.path.join(folder, filename)
        
        # Save high quality JPEG offline
        img.save(filepath, format="JPEG", quality=95)

        with self.lock:
            self.total_captured += 1
            current_total = self.total_captured
            self.last_saved_file = filename

        print(f"[DATASET OFFLINE] Saved: {filepath} (Total: {current_total})")
        return {
            "success": True,
            "filename": filename,
            "filepath": filepath,
            "label": label,
            "total_captured": current_total
        }

    def start_thread(self):
        self.is_running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        last_burst = 0
        while self.is_running:
            try:
                frame_bytes, img = self.capture_new_frame()
                with self.lock:
                    self.last_frame_bytes = frame_bytes
                    self.last_image = img

                # Handle continuous burst mode (5 FPS = every 0.2s)
                now = time.time()
                if self.burst_active and (now - last_burst) >= self.burst_interval:
                    self.save_capture()
                    last_burst = now

            except Exception as e:
                print(f"[CAMERA LOOP ERROR] {e}")

            time.sleep(0.04)  # ~25 FPS preview stream

cam = CameraManager()

class CameraHTTPHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/video_feed":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()

            while True:
                with cam.lock:
                    frame = cam.last_frame_bytes
                if frame:
                    try:
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n\r\n")
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                    except (BrokenPipeError, ConnectionResetError):
                        break
                time.sleep(0.04)

        elif self.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            with cam.lock:
                data = {
                    "running": True,
                    "mode": cam.mode,
                    "label": cam.active_label,
                    "burst_active": cam.burst_active,
                    "total_captured": cam.total_captured,
                    "last_saved": cam.last_saved_file,
                    "dataset_path": DATASET_ROOT
                }
            self.wfile.write(json.dumps(data).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        if self.path == "/capture":
            label = payload.get("label", cam.active_label)
            res = cam.save_capture(label)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif self.path == "/burst/start":
            label = payload.get("label", cam.active_label)
            with cam.lock:
                cam.active_label = label
                cam.burst_active = True
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "burst_active": True, "label": label}).encode("utf-8"))

        elif self.path == "/burst/stop":
            with cam.lock:
                cam.burst_active = False
                total = cam.total_captured
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "burst_active": False, "total_captured": total}).encode("utf-8"))

        elif self.path == "/label":
            new_label = payload.get("label", "fingerlings")
            with cam.lock:
                cam.active_label = new_label
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "active_label": new_label}).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    print(f"[INFO] Semilator Camera Service starting on port {PORT}...")
    print(f"[INFO] Local offline dataset directory: {DATASET_ROOT}")
    print(f"[INFO] Initial photos in dataset: {cam.total_captured}")
    server = HTTPServer(("0.0.0.0", PORT), CameraHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Stopping Camera Service...")
        cam.is_running = False
        server.server_close()
