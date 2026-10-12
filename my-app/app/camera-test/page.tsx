"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function CameraTestPage() {
  const router = useRouter();
  const [selectedLabel, setSelectedLabel] = useState("fingerlings");
  const [customLabel, setCustomLabel] = useState("");
  const [serviceStatus, setServiceStatus] = useState<"connecting" | "online" | "fallback">("connecting");
  const [cameraMode, setCameraMode] = useState<string>("detecting");
  const [burstActive, setBurstActive] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState<string>("/dataset");
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const activeLabel = customLabel.trim() ? customLabel.trim().toLowerCase().replace(/\s+/g, "_") : selectedLabel;

  const showFeedback = (text: string, type: "success" | "error" | "info" = "info") => {
    setFeedbackMsg({ text, type });
    setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  const triggerFlash = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  };

  // Determine dynamic MJPEG preview URL
  const streamUrl = typeof window !== "undefined"
    ? `http://${window.location.hostname}:5000/video_feed`
    : "http://localhost:5000/video_feed";

  const pingService = async () => {
    try {
      const res = await fetch("/api/camera", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.running) {
          setServiceStatus("online");
          setBurstActive(data.burst_active || false);
          setSessionCount(data.total_captured ?? 0);
          if (data.last_saved) setLastSaved(data.last_saved);
          if (data.mode) setCameraMode(data.mode);
          if (data.dataset_path) setDatasetPath(data.dataset_path);
          return true;
        }
      }
    } catch (err) {}
    return false;
  };

  // Auto-connect and poll camera service
  useEffect(() => {
    let interval: NodeJS.Timeout;

    // Trigger auto-start of Python camera service via Next.js backend
    fetch("/api/camera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => {});

    pingService();
    interval = setInterval(pingService, 1000);

    return () => {
      clearInterval(interval);
      // Stop burst on unmount if active
      fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  const handleBack = async () => {
    try {
      await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch {}
    router.push("/");
  };

  const handleCaptureSingle = async () => {
    if (isCapturing) return;
    triggerFlash();
    setIsCapturing(true);

    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture", label: activeLabel }),
      });
      const data = await res.json();
      if (data.success) {
        setSessionCount(data.total_captured);
        setLastSaved(data.filename);
        setLastSavedPath(data.filepath);
        showFeedback(`📸 Saved: ${data.filename}`, "success");
      } else {
        showFeedback(data.error || "Capture failed", "error");
      }
    } catch (err: any) {
      showFeedback("Offline capture error", "error");
    } finally {
      setIsCapturing(false);
    }
  };

  const handleToggleBurst = async () => {
    const action = burstActive ? "burst_stop" : "burst_start";
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, label: activeLabel }),
      });
      const data = await res.json();
      if (data.success) {
        setBurstActive(data.burst_active);
        if (data.burst_active) {
          showFeedback(`⚡ Burst active (5 FPS) -> dataset/${activeLabel}/`, "info");
        } else {
          if (data.total_captured !== undefined) setSessionCount(data.total_captured);
          showFeedback(`⏹ Burst stopped. Total captured: ${data.total_captured}`, "info");
        }
      } else {
        showFeedback(data.error || "Burst toggle failed", "error");
      }
    } catch (err) {
      showFeedback("Burst control error", "error");
    }
  };

  const handleExitKiosk = async () => {
    if (!confirm("Are you sure you want to exit Kiosk mode and return to the Pi desktop?")) return;
    setIsExiting(true);
    try {
      await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      await fetch("/api/exit", { method: "POST" });
    } catch (err) {
      console.warn("Exit API failed:", err);
    }
    window.close();
  };

  const categories = [
    { id: "fingerlings", label: "🐟 Fingerlings" },
    { id: "empty_background", label: "⬜ Empty / Background" },
    { id: "dense_flow", label: "🌊 High Density" },
    { id: "debris", label: "🌿 Debris / Bubbles" },
  ];

  return (
    <div className="w-full h-full bg-[#1e2022] text-white p-2.5 flex flex-col font-roboto select-none relative overflow-hidden">
      {/* Visual Shutter Flash */}
      {flash && <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity" />}

      {/* Floating Notification Toast */}
      {feedbackMsg && (
        <div
          className={`absolute top-14 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 border animate-fade-in ${
            feedbackMsg.type === "success"
              ? "bg-green-600/95 text-white border-green-400"
              : feedbackMsg.type === "error"
              ? "bg-red-600/95 text-white border-red-400"
              : "bg-amber-600/95 text-white border-amber-400"
          }`}
        >
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-row justify-between items-center bg-[#2d3035] px-4 py-2 rounded-xl mb-2 border border-white/10 shrink-0">
        <div className="flex flex-row items-center gap-3">
          <button
            onClick={handleBack}
            className="bg-[#4a4f57] hover:bg-[#5a606a] text-white font-bold px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-base font-bold tracking-wide">CAMERA CALIBRATION & ML DATA COLLECTOR</h1>
            <div className="flex items-center gap-1.5 text-xs text-gray-300">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  serviceStatus === "online"
                    ? "bg-green-500 animate-pulse"
                    : "bg-yellow-500 animate-ping"
                }`}
              />
              <span>
                {serviceStatus === "online"
                  ? `Hardware Service Online (${cameraMode.toUpperCase()}) - Offline Storage Ready`
                  : "Connecting to Camera Service on Port 5000..."}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleExitKiosk}
          disabled={isExiting}
          className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-1.5 rounded-lg text-sm transition-colors shadow-lg flex items-center gap-1.5 active:scale-95"
        >
          {isExiting ? "Exiting..." : "❌ Exit Kiosk [Test]"}
        </button>
      </div>

      {/* Main Content: Split Grid */}
      <div className="flex flex-1 gap-2.5 overflow-hidden">
        {/* Left Column: Live Video Feed */}
        <div className="flex-1 bg-black rounded-xl overflow-hidden border border-white/10 relative flex items-center justify-center">
          {serviceStatus === "online" ? (
            <img
              src={streamUrl}
              alt="Live Camera Feed"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-6 text-gray-400 gap-2">
              <span className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-1" />
              <p className="text-sm font-semibold text-gray-200">Connecting to Camera Hardware...</p>
              <p className="text-xs text-gray-400">Listening for service on port 5000</p>
              <button
                onClick={() => pingService()}
                className="mt-2 bg-[#3e434a] hover:bg-[#4e555e] text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/20 active:scale-95"
              >
                🔄 Retry Connection
              </button>
            </div>
          )}

          {/* Burst Active Badge */}
          {burstActive && (
            <div className="absolute top-2.5 left-2.5 bg-red-600 text-white font-bold px-3 py-1 rounded-lg flex items-center gap-2 text-sm shadow-lg animate-pulse">
              <span className="w-2 h-2 bg-white rounded-full animate-ping" />
              BURST RECORDING ACTIVE (5 FPS)
            </div>
          )}

          {/* Live Overlay Stats */}
          <div className="absolute bottom-2 left-2 right-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg flex justify-between items-center text-xs border border-white/10">
            <span className="truncate max-w-[30%]">
              Category: <strong className="text-green-400 font-mono">{activeLabel}</strong>
            </span>
            <span>
              Total Dataset: <strong className="text-yellow-400 text-sm font-mono">{sessionCount}</strong> photos
            </span>
            <span className="truncate max-w-[40%] text-right">
              Last: <strong className="text-gray-300 font-mono">{lastSaved || "None"}</strong>
            </span>
          </div>
        </div>

        {/* Right Column: Touch Controls & Dataset Tagging */}
        <div className="w-[310px] flex flex-col gap-2 shrink-0">
          {/* Label Selection Card */}
          <div className="bg-[#2d3035] p-3 rounded-xl border border-white/10">
            <h2 className="text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">1. Select Category / Tag</h2>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedLabel(cat.id);
                    setCustomLabel("");
                  }}
                  className={`py-1.5 px-2.5 rounded-lg font-bold text-left text-xs transition-all truncate ${
                    selectedLabel === cat.id && !customLabel
                      ? "bg-green-600 text-white shadow ring-2 ring-white/80"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div>
              <input
                type="text"
                placeholder="Or custom tag (e.g. batch_fry_1)..."
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                className="w-full bg-[#1e2022] border border-white/20 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* Capture Trigger Card */}
          <div className="bg-[#2d3035] p-3 rounded-xl border border-white/10 flex-1 flex flex-col justify-between">
            <h2 className="text-xs font-bold text-gray-300 mb-1 uppercase tracking-wider">2. Capture Offline Samples</h2>

            <div className="flex flex-col gap-2 my-auto">
              {/* Single Shot Button */}
              <button
                onClick={handleCaptureSingle}
                disabled={serviceStatus !== "online" || isCapturing}
                className={`w-full font-bold py-3 rounded-xl text-lg shadow-md flex items-center justify-center gap-2 transition-all active:scale-98 ${
                  serviceStatus === "online"
                    ? "bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                    : "bg-gray-600 text-gray-400 cursor-not-allowed"
                }`}
              >
                {isCapturing ? "SAVING..." : "📸 TAKE PHOTO"}
              </button>

              {/* Continuous Burst Button */}
              <button
                onClick={handleToggleBurst}
                disabled={serviceStatus !== "online"}
                className={`w-full font-bold py-3 rounded-xl text-lg shadow-md flex items-center justify-center gap-2 transition-all active:scale-98 ${
                  serviceStatus !== "online"
                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                    : burstActive
                    ? "bg-red-600 hover:bg-red-700 animate-pulse text-white cursor-pointer"
                    : "bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                }`}
              >
                {burstActive ? "⏹ STOP BURST" : "⚡ START BURST (5/s)"}
              </button>
            </div>

            {/* Offline Storage Path Details */}
            <div className="bg-[#1e2022] p-2.5 rounded-lg border border-white/10 text-[11px] text-gray-400 space-y-1">
              <div className="flex items-center justify-between text-gray-300 font-semibold">
                <span>📁 Offline Target Folder:</span>
                <span className="text-[10px] text-green-400 bg-green-950/80 px-1.5 py-0.5 rounded border border-green-800">
                  100% OFFLINE
                </span>
              </div>
              <div className="font-mono text-green-400 truncate text-[10px]">
                {datasetPath}/{activeLabel}/
              </div>
              {lastSavedPath && (
                <div className="text-[10px] text-gray-400 truncate">
                  Last saved: <span className="font-mono text-gray-300">{lastSavedPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
