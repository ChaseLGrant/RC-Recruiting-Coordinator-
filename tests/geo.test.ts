import { describe, expect, it } from "vitest";
import { geocode, geocodeCity, geocodeZip, haversineMiles, normalizeState } from "@/lib/domain/geo";

describe("geo", () => {
  it("computes great-circle distance (Austin → Dallas ≈ 182 mi)", () => {
    const d = haversineMiles({ lat: 30.2672, lng: -97.7431 }, { lat: 32.7767, lng: -96.797 });
    expect(d).toBeGreaterThan(178);
    expect(d).toBeLessThan(186);
  });
  it("is zero for the same point and symmetric", () => {
    const a = { lat: 35, lng: -90 }, b = { lat: 36, lng: -91 };
    expect(haversineMiles(a, a)).toBe(0);
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 9);
  });
  it("geocodes real ZIP codes and cities", () => {
    expect(geocodeZip("78712")?.label).toContain("Austin");
    expect(geocodeCity("Dallas", "Texas")?.precision).toBe("city");
    expect(geocode("Tulsa, OK")).not.toBeNull();
    expect(geocode("30.28,-97.73")?.precision).toBe("coordinates");
  });
  it("refuses to guess unknown places", () => {
    expect(geocode("Atlantis, ZZ")).toBeNull();
    expect(geocodeZip("00000")).toBeNull();
  });
  it("normalizes states", () => {
    expect(normalizeState("texas")).toBe("TX");
    expect(normalizeState("ok")).toBe("OK");
    expect(normalizeState("Narnia")).toBeNull();
  });
});
