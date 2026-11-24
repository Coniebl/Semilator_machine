#!/usr/bin/env python3
"""
Semilator Machine Learning Dataset, Camera & Hardware Control Service
Features:
  - Multi-threaded HTTP server (ThreadedHTTPServer) so video streaming NEVER blocks captures or counting
  - Real-time Arduino Uno Serial communication (115200 baud) with 3x ToF, 3x IR break-beams, and 3x servo trapdoor gates
  - Smart Trapdoor Curation & Exact Fulfillment Algorithm (Subset-sum matching + anti-overshoot gating)
  - Tri-sensor real-time independent counting (Vision, ToF, IR) with continuous 2-out-of-3 majority consensus
  - Dual Mode: Auto-detects physical Arduino on USB; seamlessly falls back to realistic water-flow simulation if hardware is unplugged
  - Server-Sent Events (SSE) `/counting/stream` for live UI counter & gate visualization
  - Camera support: Picamera2 (Raspberry Pi 5) with OpenCV and mock fallbacks
  - Video recording for ML dataset collection: Continuous manual recording ("as long as you want") and timed short clips (e.g., 10-15s)
"""

import os
import io
import time
import json
import random
import threading
import queue
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
HAS_SERIAL = False

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

try:
    import serial
    import serial.tools.list_ports
    HAS_SERIAL = True
except ImportError:
    pass

from PIL import Image, ImageDraw

def count_local_dataset():
    """Counts total videos currently stored across all category folders."""
    count = 0
    if os.path.exists(DATASET_ROOT):
        for root, dirs, files in os.walk(DATASET_ROOT):
            for f in files:
                if f.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
                    count += 1
    return count

# ==============================================================================
# Camera Manager (Picamera2 / OpenCV / Mock)
# ==============================================================================
class CameraManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.picam2 = None
        self.cap = None
        self.is_running = False
        
        self.last_frame_bytes = None
        self.last_image = None
        self.active_label = "fingerlings"
        self.color_swap = True
        
        # Video Recording state
        self.recording_active = False
        self.recording_mode = None  # "continuous" or "timed"
        self.recording_duration = 0.0  # 0 = unlimited/manual, >0 = target seconds
        self.recording_start_time = 0.0
        self.recording_elapsed = 0.0
        self.recording_remaining = 0.0
        self.video_writer = None
        self.raw_file_writer = None
        self.video_frame_size = (1280, 720)
        self.current_video_file = None
        self.current_video_path = None
        self.recording_fps = 20.0
        
        # Exposure Controls
        self.shutter_mode = "auto"
        self.gain_level = 2.0

        self.last_saved_file = None
        self.total_captured = count_local_dataset()
        self.mode = "mock"
        self.selected_camera = "mock"
        self.opencv_index = None
        self.available_cameras = []

        self.init_camera()
        self.start_thread()

    def _open_opencv_capture(self, index):
        if not HAS_CV2:
            return None
        backends = [cv2.CAP_DSHOW, cv2.CAP_ANY] if os.name == "nt" else [cv2.CAP_ANY]
        for backend in backends:
            cap = None
            try:
                cap = cv2.VideoCapture(index, backend)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                        return cap
                cap.release()
            except Exception:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
        return None

    def _release_active_camera(self):
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None
        if self.picam2 is not None:
            try:
                self.picam2.stop()
                self.picam2.close()
            except Exception:
                pass
            self.picam2 = None
        self.opencv_index = None

    def scan_cameras(self, max_indices=5):
        """Scans for available Picamera2 and OpenCV camera devices."""
        found = []
        if HAS_PICAM:
            found.append({
                "id": "picamera2",
                "label": "Raspberry Pi Camera",
                "type": "picamera2",
                "index": None,
            })

        if HAS_CV2:
            with self.lock:
                active_idx = self.opencv_index if self.mode == "opencv" and self.cap is not None else None

            for idx in range(max_indices):
                if active_idx is not None and idx == active_idx:
                    found.append({
                        "id": f"opencv:{idx}",
                        "label": f"Camera {idx}",
                        "type": "opencv",
                        "index": idx,
                    })
                    continue

                cap = self._open_opencv_capture(idx)
                if cap is not None:
                    cap.release()
                    found.append({
                        "id": f"opencv:{idx}",
                        "label": f"Camera {idx}",
                        "type": "opencv",
                        "index": idx,
                    })

        found.append({
            "id": "mock",
            "label": "Simulated (Mock)",
            "type": "mock",
            "index": None,
        })

        with self.lock:
            self.available_cameras = found
        return found

    def select_camera(self, camera_id):
        """Switches the active camera source at runtime."""
        if not camera_id:
            return {"success": False, "error": "No camera_id provided"}

        if camera_id == "mock":
            with self.lock:
                self._release_active_camera()
                self.mode = "mock"
                self.selected_camera = "mock"
            print("[CAMERA] Switched to Mock Test Mode")
            return {
                "success": True,
                "mode": self.mode,
                "selected_camera": self.selected_camera,
                "cameras": self.available_cameras,
            }

        if camera_id == "picamera2":
            if not HAS_PICAM:
                return {"success": False, "error": "Picamera2 is not available on this system"}
            with self.lock:
                self._release_active_camera()
                try:
                    self.picam2 = Picamera2()
                    config = self.picam2.create_preview_configuration(main={"size": (1280, 720), "format": "RGB888"})
                    self.picam2.configure(config)
                    self.picam2.start()
                    self.mode = "picamera2"
                    self.selected_camera = "picamera2"
                    print("[CAMERA] Switched to Raspberry Pi Camera via Picamera2")
                    return {
                        "success": True,
                        "mode": self.mode,
                        "selected_camera": self.selected_camera,
                        "cameras": self.available_cameras,
                    }
                except Exception as e:
                    self._release_active_camera()
                    self.mode = "mock"
                    self.selected_camera = "mock"
                    return {"success": False, "error": f"Picamera2 init failed: {e}"}

        if camera_id.startswith("opencv:"):
            if not HAS_CV2:
                return {"success": False, "error": "OpenCV is not installed"}
            try:
                idx = int(camera_id.split(":", 1)[1])
            except ValueError:
                return {"success": False, "error": f"Invalid camera index: {camera_id}"}

            with self.lock:
                self._release_active_camera()
                cap = self._open_opencv_capture(idx)
                if cap is not None:
                    self.cap = cap
                    self.opencv_index = idx
                    self.mode = "opencv"
                    self.selected_camera = f"opencv:{idx}"
                    print(f"[CAMERA] Switched to OpenCV Camera {idx}")
                    return {
                        "success": True,
                        "mode": self.mode,
                        "selected_camera": self.selected_camera,
                        "cameras": self.available_cameras,
                    }
                else:
                    self.mode = "mock"
                    self.selected_camera = "mock"
                    return {"success": False, "error": f"Could not open Camera {idx}"}

        return {"success": False, "error": f"Unknown camera_id: {camera_id}"}

    def init_camera(self):
        if HAS_PICAM:
            try:
                self.picam2 = Picamera2()
                config = self.picam2.create_preview_configuration(main={"size": (1280, 720), "format": "RGB888"})
                self.picam2.configure(config)
                self.picam2.start()
                self.mode = "picamera2"
                self.selected_camera = "picamera2"
                print("[CAMERA] Initialized Raspberry Pi 5 Camera via Picamera2")
                self.scan_cameras()
                return
            except Exception as e:
                print(f"[CAMERA] Picamera2 init failed: {e}. Falling back to OpenCV/Mock.")

        if HAS_CV2:
            for idx in range(5):
                cap = self._open_opencv_capture(idx)
                if cap is not None:
                    self.cap = cap
                    self.opencv_index = idx
                    self.mode = "opencv"
                    self.selected_camera = f"opencv:{idx}"
                    print(f"[CAMERA] Initialized Camera {idx} via OpenCV")
                    self.scan_cameras()
                    return

        self.mode = "mock"
        self.selected_camera = "mock"
        self.scan_cameras()
        print("[CAMERA] Running in Mock Test Mode (no physical camera detected)")

    def toggle_color_swap(self):
        with self.lock:
            self.color_swap = not self.color_swap
            current = self.color_swap
        return current

    def set_exposure_controls(self, shutter_mode=None, gain=None):
        with self.lock:
            if shutter_mode is not None:
                self.shutter_mode = shutter_mode
            if gain is not None:
                self.gain_level = float(gain)
            current_shutter = self.shutter_mode
            current_gain = self.gain_level

        if self.mode == "picamera2" and self.picam2:
            try:
                if current_shutter == "fast_500":
                    self.picam2.set_controls({
                        "AeEnable": False,
                        "ExposureTime": 2000,
                        "AnalogueGain": current_gain
                    })
                elif current_shutter == "ultra_1000":
                    self.picam2.set_controls({
                        "AeEnable": False,
                        "ExposureTime": 1000,
                        "AnalogueGain": current_gain
                    })
                else:
                    self.picam2.set_controls({ "AeEnable": True })
            except Exception as e:
                print(f"[EXPOSURE ERROR] {e}")

        return { "success": True, "shutter_mode": current_shutter, "gain": current_gain }

    def _convert_to_rgb_image(self, arr):
        if arr is None:
            return None
        try:
            if len(arr.shape) == 3:
                channels = arr.shape[2]
                if self.color_swap:
                    if channels == 3:
                        processed = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB) if HAS_CV2 else arr[:, :, ::-1]
                    elif channels == 4:
                        processed = cv2.cvtColor(arr, cv2.COLOR_BGRA2RGB) if HAS_CV2 else arr[:, :, [2, 1, 0]]
                    else:
                        processed = arr
                else:
                    processed = arr
            else:
                processed = arr
            return Image.fromarray(processed)
        except Exception:
            return None

    def capture_new_frame(self):
        with self.lock:
            mode = self.mode
            cap = self.cap
            picam2 = self.picam2

            if mode == "opencv" and cap is not None:
                try:
                    ret, frame = cap.read()
                    if ret:
                        img = self._convert_to_rgb_image(frame)
                        if img is not None:
                            buf = io.BytesIO()
                            img.save(buf, format="JPEG", quality=80)
                            return buf.getvalue(), img
                except Exception:
                    pass

            elif mode == "picamera2" and picam2 is not None:
                try:
                    arr = picam2.capture_array()
                    img = self._convert_to_rgb_image(arr)
                    if img is not None:
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=80)
                        return buf.getvalue(), img
                except Exception:
                    pass

        # Fallback Mock Frame
        img = Image.new("RGB", (640, 480), color=(26, 54, 93))
        draw = ImageDraw.Draw(img)
        draw.text((30, 30), "SEMILATOR DUAL-MODE HARDWARE STREAM", fill=(255, 255, 255))
        draw.text((30, 80), f"Camera Mode: {self.mode}", fill=(200, 200, 200))
        draw.text((30, 120), f"Arduino Status: {'Connected' if arduino.is_connected else 'Simulated Mode'}", fill=(100, 255, 100))
        draw.text((30, 160), f"Color Swap: {self.color_swap}", fill=(255, 255, 0))
        draw.text((30, 200), f"Dataset Videos Saved: {self.total_captured}", fill=(255, 200, 100))
        if self.recording_active:
            mode_txt = f"Timed ({self.recording_duration:.0f}s)" if self.recording_duration > 0 else "Continuous"
            draw.text((30, 240), f"REC [{mode_txt}]: {self.recording_elapsed:.1f}s", fill=(255, 80, 80))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue(), img

    def start_recording(self, label=None, duration=0):
        with self.lock:
            if self.recording_active:
                return {
                    "success": True,
                    "recording_active": True,
                    "recording_mode": self.recording_mode,
                    "recording_duration": self.recording_duration,
                    "recording_elapsed": round(self.recording_elapsed, 1),
                    "recording_remaining": round(self.recording_remaining, 1),
                    "filename": self.current_video_file,
                    "label": self.active_label
                }

            self.active_label = label or self.active_label or "fingerlings"
            folder = os.path.join(DATASET_ROOT, self.active_label)
            os.makedirs(folder, exist_ok=True)

            img = self.last_image.copy() if self.last_image else None

        if img is None:
            _, img = self.capture_new_frame()

        frame_size = img.size if img is not None else (1280, 720)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dur_val = float(duration) if duration else 0.0
        mode_tag = f"{int(dur_val)}s" if dur_val > 0 else "cont"
        filename = f"{self.active_label}_{timestamp}_{mode_tag}.mp4"
        filepath = os.path.join(folder, filename)

        writer = None
        raw_writer = None

        if HAS_CV2:
            try:
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(filepath, fourcc, self.recording_fps, frame_size)
                if not writer.isOpened():
                    writer.release()
                    filename = f"{self.active_label}_{timestamp}_{mode_tag}.avi"
                    filepath = os.path.join(folder, filename)
                    fourcc = cv2.VideoWriter_fourcc(*"XVID")
                    writer = cv2.VideoWriter(filepath, fourcc, self.recording_fps, frame_size)
            except Exception as e:
                print(f"[VIDEO WRITER ERROR] {e}")
                writer = None

        if writer is None or (HAS_CV2 and not writer.isOpened()):
            writer = None
            try:
                raw_writer = open(filepath, "wb")
            except Exception as e:
                return {"success": False, "error": f"Failed to create video file: {e}"}

        with self.lock:
            self.video_writer = writer
            self.raw_file_writer = raw_writer
            self.video_frame_size = frame_size
            self.current_video_file = filename
            self.current_video_path = filepath
            self.recording_duration = dur_val
            self.recording_mode = "timed" if dur_val > 0 else "continuous"
            self.recording_start_time = time.time()
            self.recording_elapsed = 0.0
            self.recording_remaining = dur_val if dur_val > 0 else 0.0
            self.recording_active = True

        print(f"[VIDEO] Started {self.recording_mode} recording -> {filepath}")
        return {
            "success": True,
            "recording_active": True,
            "recording_mode": self.recording_mode,
            "recording_duration": self.recording_duration,
            "recording_elapsed": 0.0,
            "recording_remaining": self.recording_remaining,
            "filename": filename,
            "filepath": filepath,
            "label": self.active_label
        }

    def _write_video_frame(self, img, frame_bytes):
        with self.lock:
            if not self.recording_active:
                return
            writer = self.video_writer
            raw_writer = self.raw_file_writer
            target_size = self.video_frame_size

        if writer is not None and img is not None and HAS_CV2 and HAS_NUMPY:
            try:
                frame_img = img if img.size == target_size else img.resize(target_size)
                rgb_arr = np.array(frame_img)
                bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
                with self.lock:
                    if self.recording_active and self.video_writer is not None:
                        self.video_writer.write(bgr_arr)
            except Exception as e:
                print(f"[VIDEO FRAME WRITE ERROR] {e}")
        elif raw_writer is not None and frame_bytes is not None:
            try:
                with self.lock:
                    if self.recording_active and self.raw_file_writer is not None:
                        self.raw_file_writer.write(frame_bytes)
            except Exception:
                pass

    def stop_recording(self):
        with self.lock:
            was_recording = self.recording_active
            self.recording_active = False
            writer = self.video_writer
            raw_writer = self.raw_file_writer
            self.video_writer = None
            self.raw_file_writer = None

            filename = self.current_video_file
            filepath = self.current_video_path
            elapsed = round(self.recording_elapsed, 1)
            mode = self.recording_mode

            self.recording_mode = None
            self.recording_duration = 0.0
            self.recording_elapsed = 0.0
            self.recording_remaining = 0.0
            self.current_video_file = None
            self.current_video_path = None

            if was_recording and filename:
                self.total_captured += 1
                self.last_saved_file = filename
            total = self.total_captured

        if writer is not None:
            try:
                writer.release()
            except Exception as e:
                print(f"[VIDEO RELEASE ERROR] {e}")

        if raw_writer is not None:
            try:
                raw_writer.close()
            except Exception:
                pass

        if was_recording and filepath:
            print(f"[VIDEO] Saved recording ({elapsed}s): {filepath}")

        return {
            "success": True,
            "recording_active": False,
            "filename": filename or self.last_saved_file,
            "filepath": filepath,
            "duration_recorded": elapsed,
            "recording_mode": mode,
            "total_captured": total
        }

    def start_thread(self):
        self.is_running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self.is_running:
            try:
                frame_bytes, img = self.capture_new_frame()
                with self.lock:
                    self.last_frame_bytes = frame_bytes
                    self.last_image = img
                    is_rec = self.recording_active

                if is_rec:
                    self._write_video_frame(img, frame_bytes)
                    should_stop = False
                    with self.lock:
                        if self.recording_active:
                            now = time.time()
                            self.recording_elapsed = max(0.0, now - self.recording_start_time)
                            if self.recording_duration > 0:
                                self.recording_remaining = max(0.0, self.recording_duration - self.recording_elapsed)
                                if self.recording_elapsed >= self.recording_duration:
                                    should_stop = True
                    if should_stop:
                        self.stop_recording()
            except Exception:
                pass
            time.sleep(0.04)

cam = CameraManager()

# ==============================================================================
# Arduino USB Serial Bridge
# ==============================================================================
class ArduinoBridge:
    def __init__(self, baud=115200):
        self.baud = baud
        self.serial_conn = None
        self.is_connected = False
        self.lock = threading.Lock()
        self.port_name = None
        self.is_running = True
        
        # Start connection monitor thread
        threading.Thread(target=self._connection_monitor, daemon=True).start()

    def _find_arduino_port(self):
        if not HAS_SERIAL:
            return None
        ports = list(serial.tools.list_ports.comports())
        for p in ports:
            # Common Arduino USB identifiers (FTDI, Uno, CH340, CDC ACM)
            desc = p.description.lower()
            hwid = p.hwid.lower()
            if any(k in desc or k in hwid for k in ["arduino", "ch340", "cp210", "ftdi", "usb serial", "acm"]):
                return p.device
        if ports:
            return ports[0].device  # Fallback to first available COM/tty port
        return None

    def _connection_monitor(self):
        while self.is_running:
            if not self.is_connected:
                port = self._find_arduino_port()
                if port:
                    try:
                        conn = serial.Serial(port, self.baud, timeout=1)
                        time.sleep(1.8)  # Wait for Arduino bootloader DTR reset
                        with self.lock:
                            self.serial_conn = conn
                            self.port_name = port
                            self.is_connected = True
                        print(f"[ARDUINO] Successfully connected to Arduino on {port}")
                        threading.Thread(target=self._read_serial_loop, daemon=True).start()
                    except Exception as e:
                        print(f"[ARDUINO] Connection attempt failed on {port}: {e}")
            time.sleep(2.5)

    def _read_serial_loop(self):
        while self.is_connected and self.serial_conn:
            try:
                line = self.serial_conn.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    self._handle_serial_message(line)
            except Exception as e:
                print(f"[ARDUINO] Serial read error: {e}")
                with self.lock:
                    self.is_connected = False
                    if self.serial_conn:
                        try: self.serial_conn.close()
                        except: pass
                        self.serial_conn = None
                break

    def _handle_serial_message(self, line):
        # Format examples: "IR 1", "TOF 2 45", "READY", "STATUS ..."
        parts = line.split()
        if not parts:
            return
        cmd = parts[0].upper()
        if cmd == "IR" and len(parts) >= 2:
            try:
                trough_id = int(parts[1]) - 1 # 0-indexed
                curation.on_hardware_ir_event(trough_id)
            except ValueError:
                pass
        elif cmd == "TOF" and len(parts) >= 2:
            try:
                trough_id = int(parts[1]) - 1 # 0-indexed
                curation.on_hardware_tof_event(trough_id)
            except ValueError:
                pass

    def send_command(self, cmd_str):
        with self.lock:
            if self.is_connected and self.serial_conn:
                try:
                    self.serial_conn.write(f"{cmd_str}\n".encode("utf-8"))
                    self.serial_conn.flush()
                    return True
                except Exception as e:
                    print(f"[ARDUINO] Serial write failed: {e}")
                    self.is_connected = False
                    return False
        return False

    def start_counting(self, target):
        return self.send_command(f"START {target}")

    def stop_counting(self):
        return self.send_command("STOP")

    def set_gate(self, trough_id, state):
        # 0 = CLOSED (Buyer), 1 = OPEN (Seller)
        return self.send_command(f"GATE {trough_id + 1} {state}")

arduino = ArduinoBridge()

# ==============================================================================
# Counting & Curation Engine (Smart Gating & Real-Time Consensus)
# ==============================================================================
class CurationEngine:
    def __init__(self):
        self.lock = threading.Lock()
        self.is_counting = False
        self.target = 0
        
        # Real-time tri-sensor independent tallies
        self.vision_count = 0
        self.tof_count = 0
        self.ir_count = 0
        self.final_count = 0
        
        # 2 Troughs Gate States: 0 = CLOSED (Buyer container), 1 = OPEN (Seller return)
        self.gates = [1, 1]  # Default all OPEN (return) when idle
        
        # In-flight fish currently detected in lanes: [Trough1, Trough2]
        self.in_flight = [0, 0]
        
        # SSE Subscribers
        self.subscribers = []
        
        # Simulation thread
        self.sim_thread = None

    def subscribe(self):
        q = queue.Queue(maxsize=50)
        with self.lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subscribers:
                self.subscribers.remove(q)

    def _broadcast(self, event_type="count_update"):
        payload = self.get_state()
        data_str = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
        with self.lock:
            subs = list(self.subscribers)
        for q in subs:
            try:
                q.put_nowait(data_str)
            except queue.Full:
                pass

    def get_state(self):
        with self.lock:
            mode = "hardware" if arduino.is_connected else "simulated"
            return {
                "is_counting": self.is_counting,
                "target": self.target,
                "vision": self.vision_count,
                "tof": self.tof_count,
                "ir": self.ir_count,
                "final": self.final_count,
                "gates": list(self.gates),
                "in_flight": list(self.in_flight),
                "mode": mode,
                "arduino_connected": arduino.is_connected
            }

    def compute_consensus(self):
        counts = [self.vision_count, self.tof_count, self.ir_count]
        freq = {}
        for c in counts:
            freq[c] = freq.get(c, 0) + 1
        
        # 2-out-of-3 majority consensus
        for val, count in freq.items():
            if count >= 2:
                return val
        
        # If all 3 diverge, take the median
        return sorted(counts)[1]

    def evaluate_curation_logic(self):
        """
        Calculates remaining needed R = target - final_count.
        If in-flight fish exceed R, chooses the exact subset of troughs to fulfill R without overshoot.
        Excess troughs immediately open their trapdoor to return fish to the seller.
        """
        remaining = max(0, self.target - self.final_count)
        
        if remaining <= 0:
            # Target met! Open all gates immediately
            self.gates = [1, 1]
            for i in range(2):
                arduino.set_gate(i, 1)
            return

        total_in_flight = sum(self.in_flight)
        if total_in_flight <= remaining:
            # Safe to route all current fish to buyer
            self.gates = [0, 0]
            for i in range(2):
                arduino.set_gate(i, 0)
            return

        # Overshoot risk! Search for subset sum match among troughs
        # Find which trough(s) can fulfill exactly 'remaining'
        best_troughs = None
        
        # 1. Single trough exact match
        for i in range(2):
            if self.in_flight[i] == remaining and self.in_flight[i] > 0:
                best_troughs = [i]
                break

        # 2. Both troughs exact match
        if best_troughs is None and remaining > 1:
            if self.in_flight[0] + self.in_flight[1] == remaining:
                best_troughs = [0, 1]

        # 3. Fallback: select single trough that won't overshoot
        if best_troughs is None:
            candidates = [i for i in range(2) if 0 < self.in_flight[i] <= remaining]
            if candidates:
                best_troughs = [candidates[0]]
            else:
                best_troughs = []

        # Apply gate states
        new_gates = [1, 1]  # Default OPEN (Return to Seller)
        for idx in best_troughs:
            new_gates[idx] = 0  # CLOSED (Allow to Buyer)

        self.gates = new_gates
        for i in range(2):
            arduino.set_gate(i, self.gates[i])

    def start_session(self, target):
        with self.lock:
            self.is_counting = True
            self.target = int(target)
            self.vision_count = 0
            self.tof_count = 0
            self.ir_count = 0
            self.final_count = 0
            self.gates = [0, 0]  # Closed to buyer by default
            self.in_flight = [0, 0]

        arduino.start_counting(self.target)
        self._broadcast("started")

        if not arduino.is_connected:
            self.start_simulation()

        return self.get_state()

    def stop_session(self):
        with self.lock:
            self.is_counting = False
            self.gates = [1, 1]  # Open to return
            self.in_flight = [0, 0]

        arduino.stop_counting()
        self._broadcast("stopped")
        return self.get_state()

    # --- Live Hardware Trigger Handlers ---
    def on_hardware_vision_event(self, trough_id):
        if not (0 <= trough_id < 2): return
        with self.lock:
            if not self.is_counting: return
            self.in_flight[trough_id] += 1
            self.evaluate_curation_logic()
            if self.gates[trough_id] == 0:
                self.vision_count += 1
                self.final_count = self.compute_consensus()
        self._broadcast()

    def on_hardware_tof_event(self, trough_id):
        if not (0 <= trough_id < 2): return
        with self.lock:
            if not self.is_counting: return
            if self.gates[trough_id] == 0:
                self.tof_count += 1
                self.final_count = self.compute_consensus()
        self._broadcast()

    def on_hardware_ir_event(self, trough_id):
        if not (0 <= trough_id < 2): return
        with self.lock:
            if not self.is_counting: return
            self.in_flight[trough_id] = max(0, self.in_flight[trough_id] - 1)
            if self.gates[trough_id] == 0:
                self.ir_count += 1
                self.final_count = self.compute_consensus()

            # Check target reached
            if self.final_count >= self.target:
                self.is_counting = False
                self.gates = [1, 1]
                arduino.stop_counting()
                completed = True
            else:
                completed = False

        if completed:
            self._broadcast("completed")
        else:
            self._broadcast()

    # --- Simulation Engine (Dual-Mode Fallback) ---
    def start_simulation(self):
        if self.sim_thread and self.sim_thread.is_alive():
            return
        self.sim_thread = threading.Thread(target=self._simulation_loop, daemon=True)
        self.sim_thread.start()

    def _simulation_loop(self):
        print(f"[SIMULATION] Starting water-flow fingerling simulation for target {self.target}...")
        while True:
            with self.lock:
                if not self.is_counting or self.final_count >= self.target:
                    break
                rem = self.target - self.final_count
                
                # Pick trough and quantity (1 or 2 fish)
                trough_idx = random.randint(0, 1)
                # Introduce multi-fish clusters occasionally to test anti-overshoot curation
                fish_in_lane = 2 if (rem > 1 and random.random() < 0.35) else 1
                
                self.in_flight[trough_idx] += fish_in_lane
                self.evaluate_curation_logic()
                
                is_buyer_lane = (self.gates[trough_idx] == 0)
                if is_buyer_lane:
                    self.vision_count += fish_in_lane
                    self.final_count = self.compute_consensus()

            self._broadcast()

            # Fish slides down towards ToF sensor (propagation delay ~180ms)
            time.sleep(0.18)
            with self.lock:
                if not self.is_counting: break
                if self.gates[trough_idx] == 0:
                    self.tof_count += fish_in_lane
                    self.final_count = self.compute_consensus()
            self._broadcast()

            # Fish slides down towards submerged IR break-beam (~220ms)
            time.sleep(0.22)
            completed = False
            with self.lock:
                if not self.is_counting: break
                self.in_flight[trough_idx] = max(0, self.in_flight[trough_idx] - fish_in_lane)
                if self.gates[trough_idx] == 0:
                    self.ir_count += fish_in_lane
                    self.final_count = self.compute_consensus()

                if self.final_count >= self.target:
                    self.is_counting = False
                    self.gates = [1, 1]
                    completed = True

            if completed:
                print(f"[SIMULATION] Target {self.target} fulfilled! Final: {self.final_count}")
                self._broadcast("completed")
                break
            else:
                self._broadcast()

            # Interval between fingerlings entering the funnel
            time.sleep(random.uniform(0.35, 0.75))

curation = CurationEngine()

# ==============================================================================
# Multi-Threaded HTTP & SSE Request Handler
# ==============================================================================
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
        clean_path = self.path.split("?")[0]
        
        # 1. Live Counting Server-Sent Events (SSE) Stream
        if clean_path == "/counting/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            q = curation.subscribe()
            try:
                # Send initial state snapshot immediately
                init_data = f"event: init\ndata: {json.dumps(curation.get_state())}\n\n"
                self.wfile.write(init_data.encode("utf-8"))
                self.wfile.flush()

                while True:
                    try:
                        msg = q.get(timeout=3.0)
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        # Heartbeat ping
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                curation.unsubscribe(q)

        # 2. Counting Status Snapshot
        elif clean_path == "/counting/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(curation.get_state()).encode("utf-8"))

        # 3. Video MJPEG Stream (for Camera & Testing)
        elif clean_path == "/video_feed":
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
                        self.wfile.write(f"Content-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n".encode("utf-8"))
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                    except (BrokenPipeError, ConnectionResetError):
                        break
                time.sleep(0.04)

        elif clean_path == "/snapshot":
            with cam.lock:
                frame = cam.last_frame_bytes
            if frame:
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(frame)
            else:
                self.send_response(503)
                self.end_headers()

        elif clean_path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            with cam.lock:
                cam_data = {
                    "running": True,
                    "mode": cam.mode,
                    "selected_camera": cam.selected_camera,
                    "cameras": cam.available_cameras,
                    "label": cam.active_label,
                    "color_swap": cam.color_swap,
                    "shutter_mode": cam.shutter_mode,
                    "gain": cam.gain_level,
                    "recording_active": cam.recording_active,
                    "recording_mode": cam.recording_mode,
                    "recording_duration": round(cam.recording_duration, 1),
                    "recording_elapsed": round(cam.recording_elapsed, 1),
                    "recording_remaining": round(cam.recording_remaining, 1),
                    "current_video": cam.current_video_file,
                    "total_captured": cam.total_captured,
                    "last_saved": cam.last_saved_file,
                    "dataset_path": DATASET_ROOT
                }
            self.wfile.write(json.dumps(cam_data).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        clean_path = self.path.split("?")[0]
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # 1. Counting Control: START
        if clean_path == "/counting/start":
            target = int(payload.get("target", 10))
            res = curation.start_session(target)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, **res }).encode("utf-8"))

        # 2. Counting Control: STOP
        elif clean_path == "/counting/stop":
            res = curation.stop_session()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, **res }).encode("utf-8"))

        # 3. Manual Gate Override
        elif clean_path == "/counting/gate":
            trough = int(payload.get("trough", 1)) - 1
            state = int(payload.get("state", 0)) # 0 = Buyer, 1 = Seller
            if 0 <= trough <= 1:
                curation.gates[trough] = state
                arduino.set_gate(trough, state)
                curation._broadcast()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, "gates": curation.gates }).encode("utf-8"))

        # 4. Camera Video Recording & Calibration
        elif clean_path == "/record/start":
            label = payload.get("label", cam.active_label)
            duration = payload.get("duration", 0)
            res = cam.start_recording(label=label, duration=duration)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif clean_path == "/record/stop":
            res = cam.stop_recording()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif clean_path == "/color_toggle":
            new_val = cam.toggle_color_swap()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "color_swap": new_val}).encode("utf-8"))

        elif clean_path == "/exposure":
            shutter = payload.get("shutter_mode")
            gain = payload.get("gain")
            res = cam.set_exposure_controls(shutter, gain)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif clean_path == "/cameras/scan":
            cameras = cam.scan_cameras()
            # If currently in mock mode and a real camera was just found, keep selection up to date
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "cameras": cameras,
                "selected_camera": cam.selected_camera,
                "mode": cam.mode
            }).encode("utf-8"))

        elif clean_path == "/camera/select":
            camera_id = payload.get("camera_id")
            res = cam.select_camera(camera_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif clean_path == "/label":
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


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    print(f"[INFO] Semilator Dual-Mode Hardware & Counting Service starting on port {PORT}...")
    print(f"[INFO] Offline storage directory: {DATASET_ROOT}")
    print(f"[INFO] Arduino status: {'Searching USB ports...' if HAS_SERIAL else 'PySerial not installed (Running Simulator)'}")
    server = ThreadedHTTPServer(("0.0.0.0", PORT), CameraHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Stopping Service...")
        if cam.recording_active:
            cam.stop_recording()
        cam.is_running = False
        arduino.is_running = False
        server.server_close()
