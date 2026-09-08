import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function billingContactProtection(secret: string) {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32)
    throw new Error("Billing contact key must contain 32 bytes");
  return {
    digest(value: string): string {
      return createHmac("sha256", key).update(value).digest("hex");
    },
    matches(left: string, right: string): boolean {
      const a = Buffer.from(left);
      const b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    seal(accountId: string, email: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`billing-contact:v1:${accountId}`));
      const ciphertext = Buffer.concat([
        cipher.update(email, "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },
    open(accountId: string, envelope: string): string {
      const [version, iv, tag, ciphertext, extra] = envelope.split(".");
      if (version !== "v1" || !iv || !tag || !ciphertext || extra !== undefined)
        throw new Error("Invalid contact envelope");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(Buffer.from(`billing-contact:v1:${accountId}`));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
