import { describe, expect, it } from "vitest";
import { clientAddress, networkOf, trustedAddressHeader } from "../../src/lib/ratelimit/address";

const XFF = "x-forwarded-for";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("the address of a visitor", () => {
  it("is nothing when the platform said nothing", () => {
    expect(clientAddress(headers({}), XFF)).toBeNull();
    expect(clientAddress(headers({ "x-forwarded-for": "" }), XFF)).toBeNull();
  });

  it("is the first address in the chain the platform wrote", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "41.220.10.5" }), XFF)).toBe("41.220.10.5");
    expect(
      clientAddress(headers({ "x-forwarded-for": "  41.220.10.5 , 10.0.0.1, 10.0.0.2" }), XFF),
    ).toBe("41.220.10.5");
  });

  it("is nothing at all when no header is named, whatever the request carries", () => {
    const spoofed = headers({
      "x-forwarded-for": "41.220.10.5",
      "x-real-ip": "41.220.10.5",
      "cf-connecting-ip": "41.220.10.5",
    });
    expect(clientAddress(spoofed, undefined)).toBeNull();
  });

  it("is nothing for something that is not an address", () => {
    for (const bad of ["unknown", "999.1.1.1", "1.2.3", "<script>", "41.220.10.5.7", "-", "::::"])
      expect(clientAddress(headers({ "x-forwarded-for": bad }), XFF), bad).toBeNull();
  });

  it("reads the header it is told to read, and only that one", () => {
    const h = headers({ "x-real-ip": "41.1.2.3", "x-forwarded-for": "8.8.8.8" });
    expect(clientAddress(h, "x-real-ip")).toBe("41.1.2.3");
    expect(clientAddress(h, XFF)).toBe("8.8.8.8");
    expect(clientAddress(h, "cf-connecting-ip")).toBeNull();
  });

  it("counts a whole IPv6 network as one visitor", () => {
    const a = clientAddress(headers({ "x-forwarded-for": "2001:db8:abcd:12:1:2:3:4" }), XFF);
    const b = clientAddress(
      headers({ "x-forwarded-for": "2001:db8:abcd:12:ffff:eeee:dddd:cccc" }),
      XFF,
    );
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    // a different network is a different visitor
    expect(clientAddress(headers({ "x-forwarded-for": "2001:db8:abcd:13::1" }), XFF)).toBe(
      "2001:db8:abcd:13::/64",
    );
  });

  it("gives every spelling of an IPv6 address the same answer", () => {
    const spellings = [
      "2001:db8:0:0:0:0:0:1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "2001:db8::1",
      "[2001:db8::1]",
      "2001:DB8::1",
      "2001:db8::1%eth0",
    ];
    for (const spelling of spellings)
      expect(clientAddress(headers({ "x-forwarded-for": spelling }), XFF), spelling).toBe(
        "2001:db8:0:0::/64",
      );
  });

  it("treats an IPv4 address written as IPv6 as the IPv4 address", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "::ffff:41.220.10.5" }), XFF)).toBe(
      "41.220.10.5",
    );
  });

  it("copes with the loopback, an unspecified address and a dotted tail", () => {
    expect(networkOf("::1")).toBe("0:0:0:0::/64");
    expect(networkOf("::")).toBe("0:0:0:0::/64");
    expect(networkOf("64:ff9b::1.2.3.4")).toBe("64:ff9b:0:0::/64");
    expect(networkOf("1:2:3:4:5:6:7:8")).toBe("1:2:3:4::/64");
  });

  it("rejects an IPv6 address with too few or too many groups", () => {
    expect(networkOf("1:2:3")).toBeNull();
    expect(networkOf("1::2::3")).toBeNull();
    expect(networkOf("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("which header to believe", () => {
  it("is the one the operator named", () => {
    expect(trustedAddressHeader({ clientIpHeader: "cf-connecting-ip" })).toBe("cf-connecting-ip");
    expect(trustedAddressHeader({ clientIpHeader: "cf-connecting-ip", onVercel: true })).toBe(
      "cf-connecting-ip",
    );
  });

  it("is x-forwarded-for on Vercel, which sets it itself", () => {
    expect(trustedAddressHeader({ onVercel: true })).toBe("x-forwarded-for");
  });

  it("is none anywhere else: a visitor can send any header they like", () => {
    expect(trustedAddressHeader({})).toBeUndefined();
    expect(trustedAddressHeader({ onVercel: false })).toBeUndefined();
  });
});
