#!/usr/bin/env python3
"""
Semilator Machine Learning Dataset & Camera Service
Provides:
  - MJPEG live stream on /video_feed
  - Single frame capture on POST /capture
  - Continuous burst capture on POST /burst/start and POST /burst/stop
  - Status info on GET /status
Works with Raspberry Pi 5 (Picamera2) with automatic fallback to OpenCV or test frames.
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

# Hardware Detection
HAS_PICAM = False
HAS_CV2 = False

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

class CameraManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.picam2 = None
        self.cap = None
        self.is_running = False
        self.last_frame_bytes = None
        self.active_label = "fingerlings"
        self.burst_active = False
        self.burst_interval = 0.2  # 5 fps
        self.total_captured = 0
        self.mode = "mock"

        self.init_camera()
        self.start_thread()

    def init_camera(self):
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

    def get_current_frame(self):
        if self.mode == "picamera2" and self.picam2:
            arr = self.picam2.capture_array()
            img = Image.fromarray(arr)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=80)
            return buf.getvalue(), img

        elif self.mode == "opencv" and self.cap:
            ret, frame = self.cap.read()
            if ret:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = Image.fromarray(rgb)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                return buf.getvalue(), img

        # Fallback Mock Frame with timestamp
        img = Image.new("RGB", (640, 480), color=(26, 54, 93))
        draw = ImageDraw.Draw(img)
        t_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        draw.text((30, 30), "SEMILATOR CAMERA STREAM (MOCK)", fill=(255, 255, 255))
        draw.text((30, 80), f"Mode: {self.mode}", fill=(200, 200, 200))
        draw.text((30, 130), f"Time: {t_str}", fill=(255, 255, 0))
        draw.text((30, 180), f"Active Label: {self.active_label}", fill=(100, 255, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue(), img

    def save_capture(self, label=None):
        label = label or self.active_label or "unlabeled"
        folder = os.path.join(DATASET_ROOT, label)
        os.makedirs(folder, exist_ok=True)

        _, img = self.get_current_frame()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{label}_{timestamp}.jpg"
        filepath = os.path.join(folder, filename)
        img.save(filepath, format="JPEG", quality=95)
        
        with self.lock:
            self.total_captured += 1
            current_total = self.total_captured

        print(f"[DATASET] Saved: {filepath} (Total: {current_total})")
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
                frame_bytes, _ = self.get_current_frame()
                with self.lock:
                    self.last_frame_bytes = frame_bytes

                # Handle burst mode if active
                now = time.time()
                if self.burst_active and (now - last_burst) >= self.burst_interval:
                    self.save_capture()
                    last_burst = now

            except Exception as e:
                print(f"[CAMERA LOOP ERROR] {e}")

            time.sleep(0.04)  # ~25 fps preview stream

cam = CameraManager()

class CameraHTTPHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/video_feed":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
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
            data = {
                "mode": cam.mode,
                "label": cam.active_label,
                "burst_active": cam.burst_active,
                "total_captured": cam.total_captured,
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
            cam.active_label = label
            cam.burst_active = True
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"burst_active": True, "label": label}).encode("utf-8"))

        elif self.path == "/burst/stop":
            cam.burst_active = False
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"burst_active": False, "total_captured": cam.total_captured}).encode("utf-8"))

        elif self.path == "/label":
            cam.active_label = payload.get("label", "fingerlings")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"active_label": cam.active_label}).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    print(f"[INFO] Semilator Camera Service starting on port {PORT}...")
    server = HTTPServer(("0.0.0.0", PORT), CameraHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Stopping Camera Service...")
        cam.is_running = False
        server.server_close()
