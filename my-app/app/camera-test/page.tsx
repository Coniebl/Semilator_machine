"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function CameraTestPage() {
  const router = useRouter();
  const [selectedLabel, setSelectedLabel] = useState("fingerlings");
  const [customLabel, setCustomLabel] = useState("");
  const [serviceStatus, setServiceStatus] = useState<"connecting" | "online" | "fallback">("connecting");
  const [burstActive, setBurstActive] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const activeLabel = customLabel.trim() ? customLabel.trim().toLowerCase().replace(/\s+/g, "_") : selectedLabel;

  // Poll Python Camera Service status
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const checkService = async () => {
      try {
        const res = await fetch("http://localhost:5000/status", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setServiceStatus("online");
          setBurstActive(data.burst_active);
          setSessionCount(data.total_captured || 0);
          return;
        }
      } catch (err) {
        // Fallback to browser webcam
        setServiceStatus("fallback");
      }
    };

    checkService();
    interval = setInterval(checkService, 1500);

    return () => clearInterval(interval);
  }, []);

  // WebRTC Fallback if Python service isn't active
  useEffect(() => {
    if (serviceStatus === "fallback" && !streamRef.current) {
      navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 } })
        .then((stream) => {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((err) => {
          console.warn("Browser camera access denied:", err);
        });
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [serviceStatus]);

  const triggerFlash = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  const handleCaptureSingle = async () => {
    triggerFlash();
    try {
      if (serviceStatus === "online") {
        const res = await fetch("http://localhost:5000/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: activeLabel }),
        });
        const data = await res.json();
        if (data.success) {
          setSessionCount(data.total_captured);
          setLastSaved(data.filename);
        }
      } else {
        // Browser fallback: download snapshot
        if (videoRef.current) {
          const canvas = document.createElement("canvas");
          canvas.width = videoRef.current.videoWidth || 1280;
          canvas.height = videoRef.current.videoHeight || 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            const a = document.createElement("a");
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            a.download = `${activeLabel}_${ts}.jpg`;
            a.href = canvas.toDataURL("image/jpeg", 0.95);
            a.click();
            setSessionCount((prev) => prev + 1);
            setLastSaved(a.download);
          }
        }
      }
    } catch (err) {
      console.error("Capture error:", err);
    }
  };

  const handleToggleBurst = async () => {
    if (serviceStatus !== "online") {
      alert("Burst mode requires the local Python Camera Service (port 5000).");
      return;
    }

    const endpoint = burstActive ? "/burst/stop" : "/burst/start";
    try {
      const res = await fetch(`http://localhost:5000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: activeLabel }),
      });
      const data = await res.json();
      setBurstActive(data.burst_active);
      if (!data.burst_active && data.total_captured !== undefined) {
        setSessionCount(data.total_captured);
      }
    } catch (err) {
      console.error("Burst toggle error:", err);
    }
  };

  const handleExitKiosk = async () => {
    if (!confirm("Are you sure you want to exit Kiosk mode and return to the Pi desktop?")) return;
    setIsExiting(true);
    try {
      await fetch("/api/exit", { method: "POST" });
    } catch (err) {
      console.warn("Exit API failed:", err);
    }
    // Attempt browser window close as fallback
    window.close();
  };

  const categories = [
    { id: "fingerlings", label: "🐟 Fingerlings" },
    { id: "empty_background", label: "⬜ Empty / Background" },
    { id: "dense_flow", label: "🌊 High Density" },
    { id: "debris", label: "🌿 Debris / Bubbles" },
  ];

  return (
    <div className="w-full h-full bg-[#1e2022] text-white p-6 flex flex-col font-roboto select-none relative overflow-hidden">
      {/* Visual Shutter Flash */}
      {flash && <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none" />}

      {/* Header Bar */}
      <div className="flex flex-row justify-between items-center bg-[#2d3035] px-6 py-4 rounded-2xl mb-4 border border-white/10">
        <div className="flex flex-row items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="bg-[#4a4f57] hover:bg-[#5a606a] text-white font-bold px-5 py-2.5 rounded-xl text-lg flex items-center gap-2"
          >
            ← Back to Machine
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-wide">CAMERA CALIBRATION & ML DATA COLLECTOR</h1>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className={`inline-block w-3 h-3 rounded-full ${serviceStatus === "online" ? "bg-green-500 animate-pulse" : serviceStatus === "connecting" ? "bg-yellow-500" : "bg-blue-400"}`} />
              <span>
                {serviceStatus === "online" ? "Picamera2 Hardware Service Online" : serviceStatus === "connecting" ? "Detecting Camera..." : "Browser Webcam (Fallback)"}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleExitKiosk}
          disabled={isExiting}
          className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-xl text-lg transition-colors shadow-lg flex items-center gap-2"
        >
          {isExiting ? "Exiting Kiosk..." : "❌ Exit Kiosk [Test]"}
        </button>
      </div>

      {/* Main Content: Split Grid */}
      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Left Column: Live Video Feed */}
        <div className="flex-1 bg-black rounded-2xl overflow-hidden border-2 border-white/10 relative flex items-center justify-center">
          {serviceStatus === "online" ? (
            <img
              src="http://localhost:5000/video_feed"
              alt="Live Camera Feed"
              className="w-full h-full object-contain"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
          )}

          {/* Burst Active Badge */}
          {burstActive && (
            <div className="absolute top-4 left-4 bg-red-600 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 text-lg shadow-lg animate-pulse">
              <span className="w-3 h-3 bg-white rounded-full animate-ping" />
              BURST RECORDING ACTIVE (5 FPS)
            </div>
          )}

          {/* Live Overlay Stats */}
          <div className="absolute bottom-4 left-4 right-4 bg-black/60 backdrop-blur-md px-4 py-3 rounded-xl flex justify-between items-center text-sm border border-white/10">
            <span>Label: <strong className="text-green-400">{activeLabel}</strong></span>
            <span>Session Captures: <strong className="text-yellow-400 text-base">{sessionCount}</strong></span>
            <span>Last Saved: <strong className="text-gray-300">{lastSaved || "None"}</strong></span>
          </div>
        </div>

        {/* Right Column: Touch Controls & Dataset Tagging */}
        <div className="w-[380px] flex flex-col gap-4">
          {/* Label Selection Card */}
          <div className="bg-[#2d3035] p-5 rounded-2xl border border-white/10">
            <h2 className="text-lg font-bold text-gray-200 mb-3">1. SELECT CATEGORY / TAG</h2>
            <div className="grid grid-cols-1 gap-2 mb-3">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedLabel(cat.id);
                    setCustomLabel("");
                  }}
                  className={`py-3 px-4 rounded-xl font-bold text-left text-base transition-all ${
                    selectedLabel === cat.id && !customLabel
                      ? "bg-green-600 text-white shadow-md ring-2 ring-white"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="mt-2">
              <label className="text-xs text-gray-400 mb-1 block">Or type custom label:</label>
              <input
                type="text"
                placeholder="e.g. batch_a_juvenile"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                className="w-full bg-[#1e2022] border border-white/20 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* Capture Trigger Card */}
          <div className="bg-[#2d3035] p-5 rounded-2xl border border-white/10 flex-1 flex flex-col justify-between">
            <h2 className="text-lg font-bold text-gray-200 mb-2">2. CAPTURE SAMPLES</h2>

            <div className="flex flex-col gap-3 my-auto">
              {/* Single Shot Button */}
              <button
                onClick={handleCaptureSingle}
                className="w-full bg-green-600 hover:bg-green-700 active:scale-98 text-white font-bold py-5 rounded-2xl text-2xl shadow-xl flex items-center justify-center gap-3 transition-transform"
              >
                📸 TAKE PHOTO
              </button>

              {/* Continuous Burst Button */}
              <button
                onClick={handleToggleBurst}
                className={`w-full font-bold py-5 rounded-2xl text-2xl shadow-xl flex items-center justify-center gap-3 transition-all ${
                  burstActive
                    ? "bg-red-600 hover:bg-red-700 animate-pulse text-white"
                    : "bg-amber-600 hover:bg-amber-700 text-white"
                }`}
              >
                {burstActive ? "⏹ STOP BURST" : "⚡ START BURST (5/s)"}
              </button>
            </div>

            <div className="bg-[#1e2022] p-3 rounded-xl border border-white/10 text-xs text-gray-400 space-y-1">
              <div>📁 <strong>Destination folder:</strong></div>
              <div className="font-mono text-green-400 truncate">Semilator_machine/dataset/{activeLabel}/</div>
              <div className="text-[11px] text-gray-400">💡 Tap "Start Burst" to capture fish passing through continuously.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
