import { exec } from "child_process";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    // Terminate Chromium browser running in kiosk mode on Linux / Raspberry Pi OS
    exec("pkill -o chromium || pkill chromium-browser || pkill chrome", (error) => {
      if (error) {
        console.warn("[EXIT API] Process kill completed or no browser found:", error.message);
      }
    });

    return NextResponse.json({ success: true, message: "Kiosk exit signal sent" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
