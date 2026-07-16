import { describe, expect, it } from "vitest";
import { formatBytes, formatUptime, sparkPoints } from "../fmt";

describe("formatBytes / formatUptime", () => {
  it("unidades binárias", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  it("uptime legível", () => {
    expect(formatUptime(90)).toBe("1m");
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(90061)).toBe("1d 1h 1m");
  });
});

describe("sparkPoints", () => {
  it("mapeia 0–100 pra altura invertida", () => {
    expect(sparkPoints([0, 100], 100, 50)).toBe("0.0,50.0 100.0,0.0");
    expect(sparkPoints([], 100, 50)).toBe("");
    expect(sparkPoints([150], 100, 50)).toBe("0.0,0.0"); // clampa no teto
  });
});
