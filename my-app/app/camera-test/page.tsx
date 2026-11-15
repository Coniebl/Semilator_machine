"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTouchScroll } from "@/lib/useTouchScroll";

export default function CameraTestPage() {
  const router = useRouter();
  const panelScrollRef = useTouchScroll<HTMLDivElement>();
  const [selectedLabel, setSelectedLabel] = useState("fingerlings");
  const [customLabel, setCustomLabel] = useState("");
  const [shortDuration, setShortDuration] = useState<number>(10);
  const [serviceStatus, setServiceStatus] = useState<"connecting" | "online">("connecting");
  const [cameraMode, setCameraMode] = useState<string>("detecting");
  const [colorSwap, setColorSwap] = useState<boolean>(true);

  // Motion freeze & Exposure state
  const [shutterMode, setShutterMode] = useState<"auto" | "fast_500" | "ultra_1000">("auto");
  const [gainLevel, setGainLevel] = useState<number>(2.0);

  // Video Recording state
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingMode, setRecordingMode] = useState<"continuous" | "timed" | null>(null);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [recordingElapsed, setRecordingElapsed] = useState<number>(0);
  const [recordingRemaining, setRecordingRemaining] = useState<number>(0);

  const [sessionCount, setSessionCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const wasRecordingRef = useRef(false);

  const activeLabel = customLabel.trim()
    ? customLabel.trim().toLowerCase().replace(/\s+/g, "_")
    : selectedLabel;

  const showFeedback = (text: string, type: "success" | "error" | "info" = "info") => {
    setFeedbackMsg({ text, type });
    setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  const formatTime = (seconds: number) => {
    const totalSec = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Stable MJPEG preview URL
  const streamUrl =
    typeof window !== "undefined"
      ? `http://${window.location.hostname}:5000/video_feed`
      : "http://localhost:5000/video_feed";

  const pingService = async () => {
    try {
      const res = await fetch("/api/camera", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.running) {
          setServiceStatus("online");
          const isRec = Boolean(data.recording_active);

          if (wasRecordingRef.current && !isRec && data.last_saved) {
            showFeedback(`🎬 Video saved: ${data.last_saved}`, "success");
          }
          wasRecordingRef.current = isRec;

          setRecordingActive(isRec);
          setRecordingMode(data.recording_mode || null);
          setRecordingDuration(data.recording_duration ?? 0);
          setRecordingElapsed(data.recording_elapsed ?? 0);
          setRecordingRemaining(data.recording_remaining ?? 0);
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
    interval = setInterval(pingService, 400);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const handleBack = async () => {
    if (recordingActive) {
      await handleStopRecording();
    }
    router.push("/");
  };

  const handleStartContinuous = async () => {
    if (isBusy || recordingActive) return;
    setIsBusy(true);
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_start", label: activeLabel, duration: 0 }),
      });
      const data = await res.json();
      if (data.success) {
        wasRecordingRef.current = true;
        setRecordingActive(true);
        setRecordingMode("continuous");
        setRecordingDuration(0);
        setRecordingElapsed(0);
        showFeedback("🔴 Recording started — tap Stop whenever you are done!", "info");
      } else {
        showFeedback(data.error || "Failed to start recording", "error");
      }
    } catch {
      showFeedback("Offline recording error", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartShortVideo = async () => {
    if (isBusy || recordingActive) return;
    setIsBusy(true);
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_start", label: activeLabel, duration: shortDuration }),
      });
      const data = await res.json();
      if (data.success) {
        wasRecordingRef.current = true;
        setRecordingActive(true);
        setRecordingMode("timed");
        setRecordingDuration(shortDuration);
        setRecordingElapsed(0);
        setRecordingRemaining(shortDuration);
        showFeedback(`⏱️ Recording ${shortDuration}s short video clip!`, "info");
      } else {
        showFeedback(data.error || "Failed to start short video", "error");
      }
    } catch {
      showFeedback("Short video command error", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleStopRecording = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const res = await fetch("/api/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_stop" }),
      });
      const data = await res.json();
      wasRecordingRef.current = false;
      setRecordingActive(false);
      setRecordingMode(null);
      if (data.total_captured !== undefined) setSessionCount(data.total_captured);
      if (data.filename) setLastSaved(data.filename);
      showFeedback(
        data.filename
          ? `🎬 Video saved (${data.duration_recorded ?? 0}s): ${data.filename}`
          : "⏹ Video recording stopped & saved",
        "success"
      );
    } catch {
      showFeedback("Failed to stop recording", "error");
    } finally {
      setIsBusy(false);
    }
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

  const handleExitKiosk = async () => {
    if (!confirm("Are you sure you want to exit Kiosk mode and return to the Pi desktop?")) return;
    setIsExiting(true);
    if (recordingActive) {
      await handleStopRecording();
    }
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

  const shortDurationOptions = [10, 12, 15];
  const gainOptions = [
    { val: 1.0, label: "1x Clean" },
    { val: 2.0, label: "2x" },
    { val: 4.0, label: "4x Bright" },
    { val: 8.0, label: "8x Max" },
  ];

  const timedProgressPercent =
    recordingDuration > 0
      ? Math.min(100, Math.round((recordingElapsed / recordingDuration) * 100))
      : 0;

  return (
    <div className="w-full h-full bg-[#1e2022] text-white p-2 flex flex-col font-roboto select-none relative overflow-hidden">
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
            <h1 className="text-xs font-bold tracking-wide">CAMERA CALIBRATION & ML VIDEO COLLECTOR</h1>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  serviceStatus === "online" ? "bg-green-500 animate-pulse" : "bg-yellow-500 animate-ping"
                }`}
              />
              <span>
                {serviceStatus === "online"
                  ? `Hardware Online (${cameraMode.toUpperCase()}) • Video Dataset Mode`
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

          {/* Video Recording Active Overlay */}
          {recordingActive && (
            <div className="absolute top-2.5 left-2.5 right-2.5 bg-black/85 backdrop-blur-md border border-red-500/80 p-2.5 rounded-xl shadow-2xl flex flex-col gap-1.5 animate-fade-in z-30">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-red-400 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                  {recordingMode === "timed"
                    ? `SHORT VIDEO RECORDING (${recordingDuration}s)`
                    : "CONTINUOUS VIDEO RECORDING"}
                </span>
                <span className="font-mono text-yellow-300">
                  {recordingMode === "timed"
                    ? `${recordingElapsed.toFixed(1)}s / ${recordingDuration}s (${timedProgressPercent}%)`
                    : `${formatTime(recordingElapsed)} (${recordingElapsed.toFixed(1)}s)`}
                </span>
                <button
                  onClick={handleStopRecording}
                  className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-2.5 py-0.5 rounded font-bold active:scale-95"
                >
                  ⏹ Stop & Save
                </button>
              </div>
              {recordingMode === "timed" ? (
                <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden border border-white/20">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-red-500 h-full transition-all duration-150"
                    style={{ width: `${timedProgressPercent}%` }}
                  />
                </div>
              ) : (
                <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden border border-white/20">
                  <div className="bg-red-500/80 h-full w-full animate-pulse" />
                </div>
              )}
            </div>
          )}

          {/* Clean Bottom Overlay */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg flex justify-between items-center text-[11px] border border-white/10 z-20">
            <span className="truncate max-w-[34%]">
              Tag: <strong className="text-green-400 font-mono">{activeLabel}</strong>
            </span>
            <span className="truncate max-w-[34%]">
              Speed:{" "}
              <strong className="text-cyan-400 font-mono">
                {shutterMode === "auto" ? "Auto" : shutterMode === "fast_500" ? "1/500s" : "1/1000s"}
              </strong>{" "}
              ({gainLevel}x)
            </span>
            <span className="text-right text-gray-300 flex items-center gap-1">
              <span className="text-green-400 font-bold">🎬</span>
              <span>
                Videos: <strong className="text-yellow-400 font-mono">{sessionCount}</strong>
              </span>
            </span>
          </div>
        </div>

        {/* Right Column: Touch Controls & Dataset Tagging */}
        <div ref={panelScrollRef} className="w-[305px] flex flex-col gap-1.5 shrink-0 overflow-y-auto touch-scroll">
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
                  disabled={recordingActive}
                  className={`py-1 px-1.5 rounded-lg font-bold text-left text-[11px] transition-all truncate ${
                    selectedLabel === cat.id && !customLabel
                      ? "bg-green-600 text-white shadow ring-2 ring-white/80"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  } ${recordingActive ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Or custom tag (e.g. batch_fry_1)..."
              value={customLabel}
              disabled={recordingActive}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="w-full bg-[#1e2022] border border-white/20 rounded-lg px-2 py-1 text-white font-mono text-[11px] focus:outline-none focus:border-green-500 disabled:opacity-60"
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

          {/* Card 3: Short Video Duration Selector */}
          <div className="bg-[#2d3035] p-2 rounded-xl border border-white/10">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">3. Short Clip Duration</h2>
              <span className="text-[10px] text-amber-400 font-mono">{shortDuration}s clip</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {shortDurationOptions.map((sec) => (
                <button
                  key={sec}
                  onClick={() => setShortDuration(sec)}
                  disabled={recordingActive}
                  className={`py-1 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${
                    shortDuration === sec
                      ? "bg-amber-600 text-white shadow ring-2 ring-white/80"
                      : "bg-[#3e434a] text-gray-200 hover:bg-[#4a5058]"
                  } ${recordingActive ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span>⏱️</span> {sec} Secs
                </button>
              ))}
            </div>
          </div>

          {/* Card 4: Video Recording Controls */}
          <div className="bg-[#2d3035] p-2 rounded-xl border border-white/10 flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">4. Record Video</h2>

            {recordingActive ? (
              <button
                onClick={handleStopRecording}
                disabled={isBusy}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-2 rounded-xl text-sm shadow-lg flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 border border-red-400"
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 bg-white rounded-sm inline-block" />
                  <span>STOP & SAVE VIDEO</span>
                </div>
                <span className="text-[10px] text-red-100 font-mono">
                  {recordingMode === "timed"
                    ? `Timed Clip: ${recordingRemaining.toFixed(1)}s remaining`
                    : `Elapsed: ${formatTime(recordingElapsed)} (Manual Mode)`}
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {/* Free-Length Continuous Video Button */}
                <button
                  onClick={handleStartContinuous}
                  disabled={serviceStatus !== "online" || isBusy}
                  className={`font-bold py-2.5 px-1 rounded-xl text-xs shadow-md flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
                    serviceStatus === "online" && !isBusy
                      ? "bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                      : "bg-gray-600 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold">
                    <span>🎥</span>
                    <span>RECORD VIDEO</span>
                  </div>
                  <span className="text-[8px] text-green-200 font-normal truncate">
                    (As long as you want)
                  </span>
                </button>

                {/* Short Timed Video Button (10-15s) */}
                <button
                  onClick={handleStartShortVideo}
                  disabled={serviceStatus !== "online" || isBusy}
                  className={`font-bold py-2.5 px-1 rounded-xl text-xs shadow-md flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
                    serviceStatus === "online" && !isBusy
                      ? "bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                      : "bg-gray-600 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold">
                    <span>⏱️</span>
                    <span>SHORT ({shortDuration}s)</span>
                  </div>
                  <span className="text-[8px] text-amber-200 font-normal truncate">
                    (Auto-stops at {shortDuration}s)
                  </span>
                </button>
              </div>
            )}

            {lastSaved && (
              <div className="text-[10px] text-gray-400 truncate text-center font-mono mt-0.5">
                Last saved: <span className="text-green-400">{lastSaved}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
