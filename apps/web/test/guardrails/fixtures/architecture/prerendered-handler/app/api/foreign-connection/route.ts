import { NextResponse } from "next/server";

import { connection } from "../handlers";

/** Одноимённая функция из своего модуля запроса не касается: ответ застыл бы в образе. */
export async function GET(): Promise<Response> {
  await connection();
  return NextResponse.json({ kind: "ready" });
}
