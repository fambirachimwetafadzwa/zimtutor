import { isIP } from "node:net";

/**
 * The header to believe an address from: the one the operator named (CLIENT_IP_HEADER), or on
 * Vercel x-forwarded-for, which Vercel sets itself, overwriting whatever the visitor sent.
 *
 * Anywhere else NO header is believed. Next.js fills x-forwarded-for in from the connection only when
 * the visitor did not send one, so a visitor who sends their own is believed by anything that reads
 * it, and could use somebody else's address (a school's) to get them turned away, or a different
 * address each time to get past any limit. Without a trusted header, only the limits by account
 * apply.
 */
export function trustedAddressHeader(env: {
  clientIpHeader?: string | undefined;
  onVercel?: boolean;
}): string | undefined {
  return env.clientIpHeader ?? (env.onVercel ? "x-forwarded-for" : undefined);
}

/**
 * The internet address a request came from, from the one header that can be believed (or nothing,
 * when none is named). The address is used for counting only, and is hashed before it is stored.
 *
 * IPv6 addresses are cut to their first 64 bits: one home or one phone is given a whole /64, so
 * counting full addresses would let one device sidestep a limit by changing its last digits.
 */
export function clientAddress(
  headers: { get(name: string): string | null },
  headerName: string | undefined,
): string | null {
  if (!headerName) return null;
  const raw = headers.get(headerName);
  if (!raw) return null;
  // x-forwarded-for lists the chain of addresses; the platform puts the visitor's first
  const first =
    raw
      .split(",")[0]
      ?.trim()
      .replace(/^\[|\]$/g, "") ?? "";
  const withoutZone = first.split("%")[0] ?? "";
  const kind = isIP(withoutZone);
  if (kind === 4) return withoutZone;
  if (kind === 6) return networkOf(withoutZone);
  return null;
}

/** The /64 an IPv6 address belongs to, written the same way for every spelling of it. */
export function networkOf(address: string): string | null {
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1] && isIP(mapped[1]) === 4) return mapped[1];

  let text = address.toLowerCase();
  // an address ending in dotted IPv4 (::1.2.3.4): turn that into two groups
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const firstFour = groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
  return `${firstFour.join(":")}::/64`;
}
