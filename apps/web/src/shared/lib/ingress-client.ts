import { z } from "zod";

/** Клиент, по которому ведётся счёт, и признак запроса с самого хоста. */
export interface EntryClient {
  readonly key: string;
  readonly loopback: boolean;
}

/**
 * Первое значение `X-Forwarded-For` — адрес, с которым пришёл запрос: Caddy заменяет недоверенный
 * входящий заголовок, а без Caddy его заполняет сам Next.js. IPv6 считается по сети /64: её обычно
 * выдают одному абоненту целиком. Loopback снаружи не прислать; он приходит только мимо Caddy —
 * от проверок production-сборки и служебных вызовов на хосте.
 */
export function entryClient(headers: Headers): EntryClient {
  const address =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim().toLowerCase() ?? "";
  const ipv4 = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  if (z.ipv4().safeParse(ipv4).success)
    return { key: ipv4, loopback: ipv4.startsWith("127.") };
  if (z.ipv6().safeParse(address).success) {
    return { key: ipv6Network(address), loopback: address === "::1" };
  }
  return { key: "unidentified", loopback: false };
}

/** Первые четыре группы адреса; форма с IPv4 внутри остаётся целым адресом. */
function ipv6Network(address: string): string {
  if (address.includes(".")) return address;
  const [head = "", tail] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros =
    tail === undefined
      ? []
      : Array.from({ length: 8 - left.length - right.length }, () => "0");
  const groups = [...left, ...zeros, ...right].map((group) =>
    group.replace(/^0+(?=.)/u, ""),
  );
  return `${groups.slice(0, 4).join(":")}::/64`;
}
