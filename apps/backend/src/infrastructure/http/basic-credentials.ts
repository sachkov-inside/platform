import { timingSafeEqual } from "node:crypto";

export function basicCredentialsMatch(
  header: string | undefined,
  username: string,
  password: string,
): boolean {
  if (header === undefined || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  return secretMatches(decoded, `${username}:${password}`);
}

function secretMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
