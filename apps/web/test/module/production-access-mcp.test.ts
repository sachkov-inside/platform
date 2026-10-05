import { describe, expect, it } from "vitest";

import {
  distinctiveText,
  jsonStringLiterals,
  parseToolPayload,
} from "../production/mcp-client";

describe("production access pass MCP answers", () => {
  it("reads the owner MCP result, which has no value field", () => {
    expect(
      parseToolPayload({
        ok: true,
        operationRef: "b9c1f1d2-7f5e-4f53-9d1e-3c2a0e9f4a11",
        result: { outcome: "tiers", value: { items: [] } },
      }),
    ).toMatchObject({ ok: true });
    expect(
      parseToolPayload({ ok: false, error: { code: "forbidden" } }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
  });

  it("reads the learner MCP result with its value", () => {
    const payload = parseToolPayload({ ok: true, value: { body: [] } });

    expect(payload).toMatchObject({ ok: true, value: { body: [] } });
  });

  it("finds distinctive text inside a part of canonical JSON", () => {
    // Часть 0 обрывается посреди JSON: её нельзя разобрать целиком, только её строки.
    const data = `{"practice":{"title":"Настройка агента","businessInputs":"Участник начинает учебный проект платформы командной разработки с агентами","criteria":[{"requirement":"Локальный учебный проект связан с собственным GitHub-репозиторием, а агент знает его расположение"},{"requirement":"Инструкции называют \\"проект\\" и правила"}],"tail":"обрыв части без конца`;

    const literals = jsonStringLiterals(data);

    expect(literals).toContain(
      "Локальный учебный проект связан с собственным GitHub-репозиторием, а агент знает его расположение",
    );
    expect(literals).toContain('Инструкции называют "проект" и правила');
    expect(distinctiveText(literals)).toBe(
      "Локальный учебный проект связан с собственным GitHub-репозиторием, а агент знает",
    );
  });
});
