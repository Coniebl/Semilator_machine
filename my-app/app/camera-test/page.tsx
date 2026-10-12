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
  
  // Motion freeze & Exposure state
  const [shutterMode, setShutterMode] = useState<"auto" | "fast_500" | "ultra_1000">("auto");
  const [gainLevel, setGainLevel] = useState<number>(2.0);

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
          if (data.shutter_mode) setShutterMode(data.shutter_mode);
          if (data.gain !== undefined) setGainLevel(data.gain);
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

  const handleSetExposure = async (newShutter: "auto" | "fast_500" | "ultra_1000", newGain: number) => {
    setShutterMode(newShutter);
    setGainLevel(newGain);
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_exposure", shutter_mode: newShutter, gain: newGain }),
      });
      const data = await res.json();
      if (data.success) {
        if (newShutter === "fast_500") showFeedback(`⚡ Fast Motion: 1/500s (Gain ${newGain}x)`, "info");
        else if (newShutter === "ultra_1000") showFeedback(`⚡⚡ Ultra Freeze: 1/1000s (Gain ${newGain}x)`, "info");
        else showFeedback(`Auto Exposure (AEC/AGC) Active`, "info");
      }
    } catch {
      showFeedback("Exposure control failed", "error");
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
  const gainOptions = [
    { val: 1.0, label: "1x Clean" },
    { val: 2.0, label: "2x" },
    { val: 4.0, label: "4x Bright" },
    { val: 8.0, label: "8x Max" },
  ];

  const burstProgressPercent = burstTarget > 0 ? Math.min(100, Math.round(((burstTarget - burstRemaining) / burstTarget) * 100)) : 0;

  return (
    <div className="w-full h-full bg-[#1e2022] text-white p-2 flex flex-col font-roboto select-none relative overflow-hidden">
      {/* Visual Shutter Flash */}
      {flash && <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity" />}

      {/* Floating Notification Toast */}
      {feedbackMsg && (
        <div
          className={`absolute top-12 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 border animate-fade-in ${
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
      <div className="flex flex-row justify-between items-center bg-[#2d3035] px-3 py-1.5 rounded-xl mb-1.5 border border-white/10 shrink-0">
        <div className="flex flex-row items-center gap-2.5">
          <button
            onClick={handleBack}
            className="bg-[#4a4f57] hover:bg-[#5a606a] text-white font-bold px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 active:scale-95 transition-transform"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-xs font-bold tracking-wide">CAMERA CALIBRATION & ML DATA COLLECTOR</h1>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  serviceStatus === "online" ? "bg-green-500 animate-pulse" : "bg-yellow-500 animate-ping"
                }`}
              />
              <span>
                {serviceStatus === "online"
                  ? `Hardware Online (${cameraMode.toUpperCase()}) • Global Shutter`
                  : "Connecting on Port 5000..."}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Color Flip Toggle Button */}
          <button
            onClick={handleToggleColor}
            className={`font-bold px-2.5 py-1 rounded-lg text-[11px] transition-colors border shadow flex items-center gap-1 active:scale-95 ${
              colorSwap
                ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-400"
                : "bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-500"
            }`}
            title="Tap to swap Red and Blue channels if colors look inverted"
          >
            <span>🎨 Color Swap:</span>
            <span className="font-mono">{colorSwap ? "ON" : "OFF"}</span>
          </button>

          <button
            onClick={handleExitKiosk}
            disabled={isExiting}
            className="bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-1 rounded-lg text-[11px] transition-colors shadow flex items-center gap-1 active:scale-95"
          >
            {isExiting ? "Exiting..." : "❌ Exit Kiosk"}
          </button>
        </div>
      </div>

      {/* Main Content: Split Grid */}
      <div className="flex flex-1 gap-2 overflow-hidden">
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
            <div className="flex flex-col items-center justify-center text-center p-4 text-gray-400 gap-1.5">
              <span className="w-7 h-7 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-1" />
              <p className="text-xs font-semibold text-gray-200">Connecting to Camera Hardware...</p>
              <p className="text-[10px] text-gray-400">Listening on port 5000</p>
              <button
                onClick={() => pingService()}
                className="mt-1 bg-[#3e434a] hover:bg-[#4e555e] text-white text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/20 active:scale-95"
              >
                🔄 Retry Connection
              </button>
            </div>
          )}

          {/* Burst Active Overlay with Live Progress Bar */}
          {burstActive && (
            <div className="absolute top-2.5 left-2.5 right-2.5 bg-black/85 backdrop-blur-md border border-red-500/80 p-2.5 rounded-xl shadow-2xl flex flex-col gap-1.5 animate-fade-in z-30">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-red-400 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                  BURST SHOOTING IN PROGRESS
                </span>
                <span className="font-mono text-yellow-300">
                  {burstTarget - burstRemaining} / {burstTarget} ({burstProgressPercent}%)
                </span>
                <button
                  onClick={handleStopBurst}
                  className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-2 py-0.5 rounded font-bold"
                >
                  ⏹ Stop
                </button>
              </div>
              <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden border border-white/20">
                <div
                  className="bg-gradient-to-r from-amber-500 to-red-500 h-full transition-all duration-150"
                  style={{ width: `${burstProgressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Clean Bottom Overlay */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg flex justify-between items-center text-[11px] border border-white/10 z-20">
            <span className="truncate max-w-[32%]">
              Tag: <strong className="text-green-400 font-mono">{activeLabel}</strong>
            </span>
            <span className="truncate max-w-[32%]">
              Speed: <strong className="text-cyan-400 font-mono">{shutterMode === "auto" ? "Auto" : shutterMode === "fast_500" ? "1/500s" : "1/1000s"}</strong> ({gainLevel}x)
            </span>
            <span className="text-right text-gray-300 flex items-center gap-1">
              <span className="text-green-400 font-bold">💾</span>
              <span>Total: <strong className="text-yellow-400 font-mono">{sessionCount}</strong></span>
            </span>
          </div>
        </div>

        {/* Right Column: Touch Controls & Dataset Tagging */}
        <div className="w-[305px] flex flex-col gap-1.5 shrink-0 overflow-y-auto">
          {/* Card 1: Category Selection */}
          <div className="bg-[#2d3035] p-2 rounded-xl border border-white/10">
            <h2 className="text-[11px] font-bold text-gray-300 mb-1 uppercase tracking-wider">1. Category / Tag</h2>
            <div className="grid grid-cols-2 gap-1 mb-1.5">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedLabel(cat.id);
                    setCustomLabel("");
                  }}
                  className={`py-1 px-1.5 rounded-lg font-bold text-left text-[11px] transition-all truncate ${
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
              className="w-full bg-[#1e2022] border border-white/20 rounded-lg px-2 py-1 text-white font-mono text-[11px] focus:outline-none focus:border-green-500"
            />
          </div>

          {/* Card 2: Motion Freeze & Exposure Controls */}
          <div className="bg-[#2d3035] p-2 rounded-xl border border-white/10">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">2. Motion Freeze (Shutter)</h2>
              <span className="text-[10px] text-cyan-400 font-mono">
                {shutterMode === "auto" ? "AEC Auto" : shutterMode === "fast_500" ? "2000µs" : "1000µs"}
              </span>
            </div>

            {/* Shutter Speed Presets */}
            <div className="grid grid-cols-3 gap-1 mb-1.5">
              <button
                onClick={() => handleSetExposure("auto", gainLevel)}
                className={`py-1 rounded-lg font-bold text-[10px] transition-all flex flex-col items-center justify-center ${
                  shutterMode === "auto"
                    ? "bg-cyan-600 text-white shadow ring-1 ring-white"
                    : "bg-[#3e434a] text-gray-300 hover:bg-[#4a5058]"
                }`}
              >
                <span>Auto</span>
                <span className="text-[8px] font-normal opacity-80">Room Light</span>
              </button>

              <button
                onClick={() => handleSetExposure("fast_500", gainLevel)}
                className={`py-1 rounded-lg font-bold text-[10px] transition-all flex flex-col items-center justify-center ${
                  shutterMode === "fast_500"
                    ? "bg-cyan-600 text-white shadow ring-1 ring-white"
                    : "bg-[#3e434a] text-gray-300 hover:bg-[#4a5058]"
                }`}
              >
                <span>⚡ 1/500s</span>
                <span className="text-[8px] font-normal opacity-80">Fast Hands</span>
              </button>

              <button
                onClick={() => handleSetExposure("ultra_1000", gainLevel)}
                className={`py-1 rounded-lg font-bold text-[10px] transition-all flex flex-col items-center justify-center ${
                  shutterMode === "ultra_1000"
                    ? "bg-cyan-600 text-white shadow ring-1 ring-white"
                    : "bg-[#3e434a] text-gray-300 hover:bg-[#4a5058]"
                }`}
              >
                <span>⚡⚡ 1/1000s</span>
                <span className="text-[8px] font-normal opacity-80">Fast Fry/Fish</span>
              </button>
            </div>

            {/* Brightness / Gain Boost Multiplier */}
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
              <span>Sensor Brightness Boost:</span>
              <span className="font-mono text-yellow-300">{gainLevel}x</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {gainOptions.map((g) => (
                <button
                  key={g.val}
                  onClick={() => handleSetExposure(shutterMode, g.val)}
                  className={`py-0.5 rounded text-[10px] font-bold transition-all text-center ${
                    gainLevel === g.val
                      ? "bg-amber-600 text-white ring-1 ring-white"
                      : "bg-[#1e2022] text-gray-300 hover:bg-[#333]"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Card 3: Burst Count Selector */}
          <div className="bg-[#2d3035] p-2 rounded-xl border border-white/10">
            <h2 className="text-[11px] font-bold text-gray-300 mb-1 uppercase tracking-wider">3. Burst Shoot Count</h2>
            <div className="grid grid-cols-3 gap-1">
              {burstOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setBurstCount(opt)}
                  className={`py-1 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${
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

          {/* Card 4: Capture Trigger Actions */}
          <div className="bg-[#2d3035] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between gap-1.5">
            <h2 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">4. Capture Images</h2>

            {/* Dual Action Photo Button: Tap for 1 shot, Hold for Burst */}
            <button
              onMouseDown={handlePressStart}
              onMouseUp={handlePressEnd}
              onTouchStart={handlePressStart}
              onTouchEnd={handlePressEnd}
              disabled={serviceStatus !== "online" || burstActive}
              className={`w-full font-bold py-2.5 rounded-xl text-base shadow-md flex flex-col items-center justify-center gap-0 transition-all active:scale-95 ${
                serviceStatus === "online" && !burstActive
                  ? "bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                  : "bg-gray-600 text-gray-400 cursor-not-allowed"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>📸</span>
                <span>{isCapturing ? "SAVING..." : "TAKE PHOTO"}</span>
              </div>
              <span className="text-[9px] text-green-200 font-normal">
                (Tap: 1 Photo • Hold: {burstCount} Burst)
              </span>
            </button>

            {/* Dedicated Direct Burst Button */}
            <button
              onClick={handleStartBurst}
              disabled={serviceStatus !== "online" || burstActive}
              className={`w-full font-bold py-1.5 rounded-xl text-xs shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                serviceStatus === "online" && !burstActive
                  ? "bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                  : "bg-gray-600 text-gray-400 cursor-not-allowed"
              }`}
            >
              <span>⚡</span>
              <span>BURST SHOOT ({burstCount} SHOTS)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
