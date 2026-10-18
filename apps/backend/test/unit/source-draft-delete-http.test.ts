import { HttpException } from "@nestjs/common";
import { expect, test, vi } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import type { MaterialAuthoring } from "../../src/modules/materials/index.js";
import { ImportSourceMaterialController } from "../../src/modules/materials/features/import-source-material/import-source-material.controller.js";
import { stubMaterialAuthoring } from "../fixtures/material-authoring.js";

const account = { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const materialId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const body = {
  sourceId: "inside-content:obsolete",
  materialId,
  expectedContentVersion: 2,
};

test("source deletion uses the authenticated actor and header key; body cannot override either", async () => {
  const deleteSourceDraft = vi
    .fn<MaterialAuthoring["deleteSourceDraft"]>()
    .mockResolvedValue({ ok: true, value: { materialId } });
  const controller = new ImportSourceMaterialController(
    stubMaterialAuthoring({ deleteSourceDraft }),
    parsePlatformConfig({ NODE_ENV: "test" }),
  );
  await expect(
    controller.deleteDraft(account, "delete-original-1", body),
  ).resolves.toEqual({ materialId });
  expect(deleteSourceDraft).toHaveBeenCalledWith({
    ...body,
    actor: account.accountId,
    idempotencyKey: "delete-original-1",
  });
  await expect(
    controller.deleteDraft(account, "delete-original-2", {
      ...body,
      actor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
  ).rejects.toBeInstanceOf(HttpException);
  await expect(
    controller.deleteDraft(account, "delete-original-2", {
      ...body,
      deleteVideoId: materialId,
    }),
  ).rejects.toBeInstanceOf(HttpException);
  expect(deleteSourceDraft).toHaveBeenCalledTimes(1);
  deleteSourceDraft.mockResolvedValue({
    ok: false,
    error: { code: "forbidden" },
  });
  await expect(
    controller.deleteDraft(account, "delete-original-3", body),
  ).rejects.toMatchObject({ status: 403 });
});
