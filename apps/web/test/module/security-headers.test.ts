import { afterEach, describe, expect, it, vi } from "vitest";

async function contentSecurityPolicy(
  environment: "development" | "production",
  localObjectStorageOrigin?: string,
): Promise<string> {
  vi.stubEnv("NODE_ENV", environment);
  if (localObjectStorageOrigin !== undefined) {
    vi.stubEnv("CSP_LOCAL_OBJECT_STORAGE_ORIGIN", localObjectStorageOrigin);
  }
  vi.resetModules();
  const { default: nextConfig } = await import("../../next.config");
  const rules = (await nextConfig.headers?.()) ?? [];
  const policy = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;
  if (policy === undefined) throw new Error("Content-Security-Policy is not configured");
  return policy;
}

function directive(policy: string, name: string): string {
  const value = policy.split("; ").find((entry) => entry.startsWith(`${name} `));
  if (value === undefined) throw new Error(`${name} is missing`);
  return value;
}

describe("Web security headers", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("keeps local storage addresses and eval out of the production policy", async () => {
    const policy = await contentSecurityPolicy("production");

    expect(policy).not.toMatch(/127\.0\.0\.1|localhost|http:\/\//u);
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(policy, "img-src")).toContain("https://storage.yandexcloud.net");
    for (const fixed of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(policy.split("; ")).toContain(fixed);
    }
  });

  it("lets only a full-stack smoke build name its loopback storage origin", async () => {
    const policy = await contentSecurityPolicy("production", "http://127.0.0.1:9000");

    expect(directive(policy, "img-src")).toContain(" http://127.0.0.1:9000 ");
    expect(policy).not.toContain("http://127.0.0.1:*");
    expect(policy).not.toContain("localhost");
    expect(policy.match(/http:\/\//gu)).toHaveLength(1);
    await expect(contentSecurityPolicy("production", "https://storage.example")).rejects.toThrow(
      "CSP_LOCAL_OBJECT_STORAGE_ORIGIN",
    );
  });

  it("lets the local stand show previews from its own storage", async () => {
    const policy = await contentSecurityPolicy("development");

    expect(directive(policy, "img-src")).toContain("http://127.0.0.1:*");
    expect(directive(policy, "img-src")).toContain("http://localhost:9000");
  });
});
