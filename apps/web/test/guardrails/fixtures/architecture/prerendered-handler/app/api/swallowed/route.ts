/** Перехват глотает отказ от предсборки: ответ об ошибке застывает в образе. */
export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json({ url: request.url });
  } catch {
    return Response.json({ kind: "error" });
  }
}
