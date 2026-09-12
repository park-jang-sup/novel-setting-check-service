import { NextRequest, NextResponse } from "next/server";
import { runCheck } from "@/utils/parser";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const manuscript = typeof body === "object" && body?.manuscript ? body.manuscript : "";
    const settingsRaw = typeof body === "object" && body?.settings ? body.settings : "";

    if (!manuscript || typeof manuscript !== "string") {
      return NextResponse.json({ error: "원고가 필요합니다" }, { status: 400 });
    }

    const result = runCheck(settingsRaw, manuscript);
    return NextResponse.json(result);
  } catch (err) {
    console.error("check route error", err);
    return NextResponse.json({ error: "검사 중 오류가 발생했습니다" }, { status: 500 });
  }
}
