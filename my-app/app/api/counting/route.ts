import { spawn, exec } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

let serviceChildProcess: any = null;

async function getCountingStatus(): Promise<any> {
  try {
    const res = await fetch("http://127.0.0.1:5000/counting/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

function ensureServiceRunning(): void {
  if (process.platform === "linux") {
    try {
      exec("sudo systemctl start camera.service 2>/dev/null || systemctl start camera.service 2>/dev/null");
    } catch {}
  }

  try {
    const scriptPath = path.resolve(process.cwd(), "..", "camera_service.py");
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    serviceChildProcess = spawn(pythonCmd, [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    serviceChildProcess.unref();
  } catch (err) {
    console.warn("[COUNTING API] Spawn error:", err);
  }
}

export async function GET() {
  let status = await getCountingStatus();
  if (!status) {
    ensureServiceRunning();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200));
      status = await getCountingStatus();
      if (status) break;
    }
  }

  if (status) {
    return NextResponse.json({ running: true, ...status });
  }

  return NextResponse.json({
    running: false,
    mode: "offline",
    is_counting: false,
    vision: 0,
    tof: 0,
    ir: 0,
    final: 0,
    gates: [1, 1, 1],
    in_flight: [0, 0, 0]
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({ action: "status" }));
    const { action, target, trough, state } = body;

    // Check service health
    let status = await getCountingStatus();
    if (!status) {
      ensureServiceRunning();
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        status = await getCountingStatus();
        if (status) break;
      }
    }

    if (action === "start") {
      try {
        const res = await fetch("http://127.0.0.1:5000/counting/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: target || 10 }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 502 });
      }
    }

    if (action === "stop") {
      try {
        const res = await fetch("http://127.0.0.1:5000/counting/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 502 });
      }
    }

    if (action === "gate") {
      try {
        const res = await fetch("http://127.0.0.1:5000/counting/gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trough, state }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 502 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
