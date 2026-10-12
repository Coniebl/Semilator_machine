#!/usr/bin/env python3
"""
Semilator Machine Learning Dataset & Camera Service
Features:
  - Multi-threaded HTTP server (ThreadedHTTPServer) so video streaming NEVER blocks captures
  - Instant single-frame capture (POST /capture)
  - Batch burst shooting for N images (POST /burst/start with {"count": 20|50|100})
  - Live color channel flip toggle (POST /color_toggle) for instant true color calibration
  - 100% offline local storage in dataset/<category>/
  - Hardware support: Picamera2 (Raspberry Pi 5) with OpenCV and mock fallbacks
"""

import os
import io
import time
import json
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

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
        
        # Color calibration: toggle between swapped BGR->RGB and original
        self.color_swap = True
        
        # Batch burst state
        self.burst_active = False
        self.burst_remaining = 0
        self.burst_target = 0
        self.burst_interval = 0.18  # ~5.5 FPS
        
        self.last_saved_file = None
        self.total_captured = count_local_dataset()
        self.mode = "mock"

        self.init_camera()
        self.start_thread()

    def init_camera(self):
        # 1. Try OpenCV first if requested/available
        if HAS_CV2:
            try:
                self.cap = cv2.VideoCapture(0)
                if self.cap.isOpened():
                    self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                    self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    self.mode = "opencv"
                    print("[CAMERA] Initialized Camera via OpenCV V4L2")
                    return
                else:
                    self.cap = None
            except Exception as e:
                print(f"[CAMERA] OpenCV init failed: {e}")
                self.cap = None

        # 2. Try Picamera2 for Raspberry Pi 5 hardware
        if HAS_PICAM:
            try:
                self.picam2 = Picamera2()
                config = self.picam2.create_preview_configuration(main={"size": (1280, 720), "format": "RGB888"})
                self.picam2.configure(config)
                self.picam2.start()
                self.mode = "picamera2"
                print("[CAMERA] Initialized Raspberry Pi Camera via Picamera2")
                return
            except Exception as e:
                print(f"[CAMERA] Picamera2 init failed: {e}. Falling back to Mock.")

        self.mode = "mock"
        print("[CAMERA] Running in Mock Test Mode (no physical camera detected)")

    def toggle_color_swap(self):
        with self.lock:
            self.color_swap = not self.color_swap
            current = self.color_swap
        print(f"[CAMERA] Color channel swap set to: {current}")
        return current

    def _convert_to_rgb_image(self, arr):
        """Converts raw camera array to PIL Image, applying color flip if active."""
        if arr is None:
            return None

        try:
            if len(arr.shape) == 3:
                channels = arr.shape[2]
                if self.color_swap:
                    # Swap Channel 0 and 2 (BGR <-> RGB)
                    if channels == 3:
                        if HAS_CV2:
                            processed = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)
                        elif HAS_NUMPY:
                            processed = np.ascontiguousarray(arr[:, :, ::-1])
                        else:
                            processed = arr[:, :, ::-1]
                    elif channels == 4:
                        if HAS_CV2:
                            processed = cv2.cvtColor(arr, cv2.COLOR_BGRA2RGB)
                        elif HAS_NUMPY:
                            processed = np.ascontiguousarray(arr[:, :, [2, 1, 0]])
                        else:
                            processed = arr[:, :, [2, 1, 0]]
                    else:
                        processed = arr
                else:
                    processed = arr
            else:
                processed = arr

            return Image.fromarray(processed)
        except Exception as e:
            print(f"[CONVERT ERROR] {e}")
            try:
                return Image.fromarray(arr)
            except Exception:
                return None

    def capture_new_frame(self):
        """Captures a single raw frame and returns (jpeg_bytes, PIL_Image). Never returns None."""
        if self.mode == "opencv" and self.cap:
            try:
                ret, frame = self.cap.read()
                if ret:
                    img = self._convert_to_rgb_image(frame)
                    if img is not None:
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=80)
                        return buf.getvalue(), img
            except Exception as e:
                print(f"[OPENCV CAPTURE ERROR] {e}")

        elif self.mode == "picamera2" and self.picam2:
            try:
                arr = self.picam2.capture_array()
                img = self._convert_to_rgb_image(arr)
                if img is not None:
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=80)
                    return buf.getvalue(), img
            except Exception as e:
                print(f"[PICAM CAPTURE ERROR] {e}")

        # Fallback Mock Frame with timestamp
        img = Image.new("RGB", (640, 480), color=(26, 54, 93))
        draw = ImageDraw.Draw(img)
        t_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        draw.text((30, 30), "SEMILATOR CAMERA STREAM", fill=(255, 255, 255))
        draw.text((30, 80), f"Mode: {self.mode}", fill=(200, 200, 200))
        draw.text((30, 130), f"Color Swap: {self.color_swap}", fill=(255, 255, 0))
        draw.text((30, 180), f"Active Label: {self.active_label}", fill=(100, 255, 100))
        draw.text((30, 230), f"Dataset Count: {self.total_captured}", fill=(255, 200, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue(), img

    def save_capture(self, label=None):
        """Thread-safe, non-blocking save of the current frame to local storage."""
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
        
        # Save high quality JPEG directly to local disk
        img.save(filepath, format="JPEG", quality=95)

        with self.lock:
            self.total_captured += 1
            current_total = self.total_captured
            self.last_saved_file = filename

        return {
            "success": True,
            "filename": filename,
            "filepath": filepath,
            "label": label,
            "total_captured": current_total
        }

    def start_batch_burst(self, label=None, count=20):
        """Initiates a batch burst shoot of exactly count images."""
        with self.lock:
            self.active_label = label or self.active_label or "fingerlings"
            self.burst_target = int(count)
            self.burst_remaining = int(count)
            self.burst_active = True
        print(f"[BURST] Started batch burst: {count} images for label '{self.active_label}'")
        return {
            "success": True,
            "burst_active": True,
            "burst_target": self.burst_target,
            "burst_remaining": self.burst_remaining,
            "label": self.active_label
        }

    def stop_burst(self):
        """Halts any ongoing burst shoot."""
        with self.lock:
            self.burst_active = False
            self.burst_remaining = 0
            total = self.total_captured
        print("[BURST] Burst shoot stopped.")
        return {"success": True, "burst_active": False, "total_captured": total}

    def start_thread(self):
        self.is_running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        last_burst_time = 0
        while self.is_running:
            try:
                frame_bytes, img = self.capture_new_frame()
                with self.lock:
                    self.last_frame_bytes = frame_bytes
                    self.last_image = img

                # Handle batch burst shooting
                now = time.time()
                if self.burst_active and (now - last_burst_time) >= self.burst_interval:
                    if self.burst_remaining > 0:
                        self.save_capture()
                        with self.lock:
                            self.burst_remaining -= 1
                            if self.burst_remaining <= 0:
                                self.burst_active = False
                                print(f"[BURST] Batch completed: {self.burst_target} images saved!")
                        last_burst_time = now
                    else:
                        with self.lock:
                            self.burst_active = False

            except Exception as e:
                print(f"[CAMERA LOOP ERROR] {e}")

            time.sleep(0.04)  # ~25 FPS live preview

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
                    "color_swap": cam.color_swap,
                    "burst_active": cam.burst_active,
                    "burst_remaining": cam.burst_remaining,
                    "burst_target": cam.burst_target,
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
            count = payload.get("count", 20)
            res = cam.start_batch_burst(label=label, count=count)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif self.path == "/burst/stop":
            res = cam.stop_burst()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif self.path == "/color_toggle":
            new_val = cam.toggle_color_swap()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "color_swap": new_val}).encode("utf-8"))

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

# Multi-Threaded HTTP Server: prevents video stream from blocking API requests!
class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    print(f"[INFO] Semilator Multi-Threaded Camera Service starting on port {PORT}...")
    print(f"[INFO] Offline storage directory: {DATASET_ROOT}")
    print(f"[INFO] Initial photos in dataset: {cam.total_captured}")
    server = ThreadedHTTPServer(("0.0.0.0", PORT), CameraHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Stopping Camera Service...")
        cam.is_running = False
        server.server_close()
