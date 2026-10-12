import { spawn, exec } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

// Keep a global process reference across requests
let cameraChildProcess: any = null;

async function isCameraRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:5000/status", { cache: "no-store", signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const running = await isCameraRunning();
  return NextResponse.json({ running });
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json().catch(() => ({ action: "start" }));

    if (action === "start") {
      const alreadyRunning = await isCameraRunning();
      if (alreadyRunning) {
        return NextResponse.json({ success: true, message: "Camera service already running" });
      }

      const scriptPath = path.resolve(process.cwd(), "..", "camera_service.py");
      const pythonCmd = process.platform === "win32" ? "python" : "python3";

      console.log(`[CAMERA API] Starting camera service: ${pythonCmd} ${scriptPath}`);
      cameraChildProcess = spawn(pythonCmd, [scriptPath], {
        detached: false,
        stdio: "ignore",
      });

      cameraChildProcess.unref();

      // Poll until port 5000 responds (up to 3 seconds)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await isCameraRunning()) {
          return NextResponse.json({ success: true, message: "Camera service started successfully" });
        }
      }

      return NextResponse.json({ success: true, message: "Camera service spawned, connecting..." });
    }

    if (action === "stop") {
      console.log("[CAMERA API] Stopping camera service...");

      if (cameraChildProcess) {
        try {
          cameraChildProcess.kill("SIGTERM");
        } catch {}
        cameraChildProcess = null;
      }

      if (process.platform === "win32") {
        exec("taskkill /F /FI \"WINDOWTITLE eq *camera_service*\" 2>nul || exit 0");
      } else {
        exec("pkill -f camera_service.py || true");
      }

      return NextResponse.json({ success: true, message: "Camera service stopped" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
