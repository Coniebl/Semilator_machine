"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function CameraTestPage() {
  const router = useRouter();
  const [selectedLabel, setSelectedLabel] = useState("fingerlings");
  const [customLabel, setCustomLabel] = useState("");
  const [burstCount, setBurstCount] = useState<number>(20);
  const [serviceStatus, setServiceStatus] = useState<"connecting" | "online">("connecting");
  const [cameraMode, setCameraMode] = useState<string>("detecting");
  const [colorSwap, setColorSwap] = useState<boolean>(true);
  
  // Burst progress state
  const [burstActive, setBurstActive] = useState(false);
  const [burstRemaining, setBurstRemaining] = useState(0);
  const [burstTarget, setBurstTarget] = useState(20);

  const [sessionCount, setSessionCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Long-press handling for capture button
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  const activeLabel = customLabel.trim() ? customLabel.trim().toLowerCase().replace(/\s+/g, "_") : selectedLabel;

  const showFeedback = (text: string, type: "success" | "error" | "info" = "info") => {
    setFeedbackMsg({ text, type });
    setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, 3000);
  };

  const triggerFlash = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 100);
  };

  // Stable MJPEG preview URL
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
          setBurstRemaining(data.burst_remaining ?? 0);
          setBurstTarget(data.burst_target || burstCount);
          setSessionCount(data.total_captured ?? 0);
          if (data.color_swap !== undefined) setColorSwap(data.color_swap);
          if (data.last_saved) setLastSaved(data.last_saved);
          if (data.mode) setCameraMode(data.mode);
          return true;
        }
      }
    } catch {}
    return false;
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;

    // Auto-ping camera service
    fetch("/api/camera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => {});

    pingService();
    interval = setInterval(pingService, 600);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const handleBack = () => {
    router.push("/");
  };

  const handleCaptureSingle = async () => {
    if (isCapturing || burstActive) return;
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
        showFeedback(`📸 Photo saved to local storage!`, "success");
      } else {
        showFeedback(data.error || "Capture error", "error");
      }
    } catch {
      showFeedback("Offline capture error", "error");
    } finally {
      setIsCapturing(false);
    }
  };

  const handleStartBurst = async () => {
    if (burstActive) return;
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "burst_start", label: activeLabel, count: burstCount }),
      });
      const data = await res.json();
      if (data.success) {
        setBurstActive(true);
        setBurstRemaining(burstCount);
        setBurstTarget(burstCount);
        showFeedback(`⚡ Burst started: Shooting ${burstCount} photos!`, "info");
      } else {
        showFeedback(data.error || "Burst start failed", "error");
      }
    } catch {
      showFeedback("Burst command error", "error");
    }
  };

  const handleStopBurst = async () => {
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "burst_stop" }),
      });
      const data = await res.json();
      setBurstActive(false);
      if (data.total_captured) setSessionCount(data.total_captured);
      showFeedback("⏹ Burst stopped early", "info");
    } catch {}
  };

  const handleToggleColor = async () => {
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "color_toggle" }),
      });
      const data = await res.json();
      if (data.success) {
        setColorSwap(data.color_swap);
        showFeedback(data.color_swap ? "🎨 Color Swap ON (BGR ↔ RGB)" : "🎨 Color Swap OFF (Native)", "info");
      }
    } catch {
      showFeedback("Color toggle error", "error");
    }
  };

  const handlePressStart = () => {
    if (burstActive) return;
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      handleStartBurst();
    }, 450); // 450ms hold triggers burst
  };

  const handlePressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!isLongPressRef.current && !burstActive) {
      handleCaptureSingle();
    }
  };

  const handleExitKiosk = async () => {
    if (!confirm("Are you sure you want to exit Kiosk mode and return to the Pi desktop?")) return;
    setIsExiting(true);
    try {
      await fetch("/api/exit", { method: "POST" });
    } catch {}
    window.close();
  };

  const categories = [
    { id: "fingerlings", label: "🐟 Fingerlings" },
    { id: "empty_background", label: "⬜ Empty / Background" },
    { id: "dense_flow", label: "🌊 High Density" },
    { id: "debris", label: "🌿 Debris / Bubbles" },
  ];

  const burstOptions = [20, 50, 100];
  const burstProgressPercent = burstTarget > 0 ? Math.min(100, Math.round(((burstTarget - burstRemaining) / burstTarget) * 100)) : 0;

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
                  serviceStatus === "online" ? "bg-green-500 animate-pulse" : "bg-yellow-500 animate-ping"
                }`}
              />
              <span>
                {serviceStatus === "online"
                  ? `Hardware Online (${cameraMode.toUpperCase()}) - Local Storage Ready`
                  : "Connecting to Camera Service on Port 5000..."}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Color Flip Toggle Button */}
          <button
            onClick={handleToggleColor}
            className={`font-bold px-3 py-1.5 rounded-lg text-xs transition-colors border shadow flex items-center gap-1.5 active:scale-95 ${
              colorSwap
                ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-400"
                : "bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-500"
            }`}
            title="Tap to swap Red and Blue channels if colors look inverted"
          >
            <span>🎨 Color Swap:</span>
            <span className="font-mono">{colorSwap ? "BGR↔RGB [ON]" : "OFF"}</span>
          </button>

          <button
            onClick={handleExitKiosk}
            disabled={isExiting}
            className="bg-red-600 hover:bg-red-700 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition-colors shadow flex items-center gap-1 active:scale-95"
          >
            {isExiting ? "Exiting..." : "❌ Exit Kiosk"}
          </button>
        </div>
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
              onError={(e) => {
                setTimeout(() => {
                  (e.target as HTMLImageElement).src = `${streamUrl}?r=${Date.now()}`;
                }, 1000);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-6 text-gray-400 gap-2">
              <span className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-1" />
              <p className="text-sm font-semibold text-gray-200">Connecting to Camera Hardware...</p>
              <p className="text-xs text-gray-400">Listening on port 5000</p>
              <button
                onClick={() => pingService()}
                className="mt-2 bg-[#3e434a] hover:bg-[#4e555e] text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/20 active:scale-95"
              >
                🔄 Retry Connection
              </button>
            </div>
          )}

          {/* Burst Active Overlay with Live Progress Bar */}
          {burstActive && (
            <div className="absolute top-3 left-3 right-3 bg-black/85 backdrop-blur-md border border-red-500/80 p-3 rounded-xl shadow-2xl flex flex-col gap-2 animate-fade-in z-30">
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-red-400 flex items-center gap-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full animate-ping" />
                  BURST SHOOTING IN PROGRESS
                </span>
                <span className="font-mono text-yellow-300">
                  {burstTarget - burstRemaining} / {burstTarget} photos ({burstProgressPercent}%)
                </span>
                <button
                  onClick={handleStopBurst}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs px-2.5 py-1 rounded-lg font-bold"
                >
                  ⏹ Stop Early
                </button>
              </div>
              <div className="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-white/20">
                <div
                  className="bg-gradient-to-r from-amber-500 to-red-500 h-full transition-all duration-150"
                  style={{ width: `${burstProgressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Clean Bottom Overlay */}
          <div className="absolute bottom-2 left-2 right-2 bg-black/75 backdrop-blur-md px-3.5 py-2 rounded-lg flex justify-between items-center text-xs border border-white/10 z-20">
            <span className="truncate max-w-[32%]">
              Category: <strong className="text-green-400 font-mono">{activeLabel}</strong>
            </span>
            <span className="truncate max-w-[32%]">
              Total Saved: <strong className="text-yellow-400 text-sm font-mono">{sessionCount}</strong> photos
            </span>
            <span className="text-right text-gray-300 flex items-center gap-1.5">
              <span className="text-green-400 font-bold">💾</span>
              <span>Saved to Local Storage (Offline)</span>
            </span>
          </div>
        </div>

        {/* Right Column: Touch Controls & Dataset Tagging */}
        <div className="w-[310px] flex flex-col gap-2 shrink-0">
          {/* Card 1: Category Selection */}
          <div className="bg-[#2d3035] p-2.5 rounded-xl border border-white/10">
            <h2 className="text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">1. Select Category / Tag</h2>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedLabel(cat.id);
                    setCustomLabel("");
                  }}
                  className={`py-1.5 px-2 rounded-lg font-bold text-left text-xs transition-all truncate ${
                    selectedLabel === cat.id && !customLabel
                      ? "bg-green-600 text-white shadow ring-2 ring-white/80"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Or custom tag (e.g. batch_fry_1)..."
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="w-full bg-[#1e2022] border border-white/20 rounded-lg px-2.5 py-1 text-white font-mono text-xs focus:outline-none focus:border-green-500"
            />
          </div>

          {/* Card 2: Burst Count Selector */}
          <div className="bg-[#2d3035] p-2.5 rounded-xl border border-white/10">
            <h2 className="text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">2. Burst Shoot Count</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {burstOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setBurstCount(opt)}
                  className={`py-1.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 ${
                    burstCount === opt
                      ? "bg-amber-600 text-white shadow ring-2 ring-white/80"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  }`}
                >
                  <span>⚡</span> {opt} Shots
                </button>
              ))}
            </div>
          </div>

          {/* Card 3: Capture Trigger Actions */}
          <div className="bg-[#2d3035] p-3 rounded-xl border border-white/10 flex-1 flex flex-col justify-between">
            <h2 className="text-xs font-bold text-gray-300 mb-1 uppercase tracking-wider">3. Capture Images</h2>

            <div className="flex flex-col gap-2 my-auto">
              {/* Dual Action Photo Button: Tap for 1 shot, Hold for Burst */}
              <button
                onMouseDown={handlePressStart}
                onMouseUp={handlePressEnd}
                onTouchStart={handlePressStart}
                onTouchEnd={handlePressEnd}
                disabled={serviceStatus !== "online" || burstActive}
                className={`w-full font-bold py-3.5 rounded-xl text-lg shadow-md flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
                  serviceStatus === "online" && !burstActive
                    ? "bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                    : "bg-gray-600 text-gray-400 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📸</span>
                  <span>{isCapturing ? "SAVING..." : "TAKE PHOTO"}</span>
                </div>
                <span className="text-[10px] text-green-200 font-normal">
                  (Tap: 1 Photo • Hold: {burstCount} Burst)
                </span>
              </button>

              {/* Dedicated Direct Burst Button */}
              <button
                onClick={handleStartBurst}
                disabled={serviceStatus !== "online" || burstActive}
                className={`w-full font-bold py-2.5 rounded-xl text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-95 ${
                  serviceStatus === "online" && !burstActive
                    ? "bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                    : "bg-gray-600 text-gray-400 cursor-not-allowed"
                }`}
              >
                <span>⚡</span>
                <span>BURST SHOOT ({burstCount} SHOTS)</span>
              </button>
            </div>

            {/* Offline Local Storage Guarantee Footer */}
            <div className="bg-[#1e2022] p-2 rounded-lg border border-white/10 text-[11px] text-gray-300 flex items-center gap-2">
              <span className="text-base text-green-400">💾</span>
              <div>
                <div className="font-semibold text-white">Auto-saved to Local Storage</div>
                <div className="text-[10px] text-gray-400">Captures store directly on your device offline.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
