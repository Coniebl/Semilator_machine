import { spawn, exec } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

let cameraChildProcess: any = null;

async function getCameraStatus(): Promise<any> {
  try {
    const res = await fetch("http://127.0.0.1:5000/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

function startCameraDaemon(): void {
  if (process.platform === "linux") {
    try {
      exec("sudo systemctl start camera.service 2>/dev/null || systemctl start camera.service 2>/dev/null");
    } catch {}
  }

  try {
    const scriptPath = path.resolve(process.cwd(), "..", "camera_service.py");
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    cameraChildProcess = spawn(pythonCmd, [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    cameraChildProcess.unref();
  } catch (err) {
    console.warn("[CAMERA API] Spawn error:", err);
  }
}

export async function GET() {
  const status = await getCameraStatus();
  if (status) {
    return NextResponse.json({ running: true, ...status });
  }

  startCameraDaemon();
  return NextResponse.json({ running: false, mode: "offline", total_captured: 0 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({ action: "start" }));
    const { action, label, count } = body;

    if (action === "start") {
      let currentStatus = await getCameraStatus();
      if (currentStatus) {
        return NextResponse.json({ success: true, message: "Camera service active", ...currentStatus });
      }

      startCameraDaemon();

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        currentStatus = await getCameraStatus();
        if (currentStatus) {
          return NextResponse.json({ success: true, message: "Camera service connected", ...currentStatus });
        }
      }

      return NextResponse.json({ success: false, message: "Camera service starting, please wait..." });
    }

    if (action === "capture") {
      try {
        const res = await fetch("http://127.0.0.1:5000/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Camera hardware service error: ${err.message}` },
          { status: 502 }
        );
      }
    }

    if (action === "burst_start") {
      try {
        const res = await fetch("http://127.0.0.1:5000/burst/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, count: count || 20 }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Failed to start burst: ${err.message}` },
          { status: 502 }
        );
      }
    }

    if (action === "burst_stop" || action === "stop") {
      try {
        const res = await fetch("http://127.0.0.1:5000/burst/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Failed to stop burst: ${err.message}` },
          { status: 502 }
        );
      }
    }

    if (action === "color_toggle") {
      try {
        const res = await fetch("http://127.0.0.1:5000/color_toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Color toggle failed: ${err.message}` },
          { status: 502 }
        );
      }
    }

    if (action === "set_exposure") {
      try {
        const res = await fetch("http://127.0.0.1:5000/exposure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shutter_mode: body.shutter_mode, gain: body.gain }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Exposure setting failed: ${err.message}` },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
