import { describe, expect, test } from "bun:test";
import { parseDataUpload, parseHeartbeat } from "./validation";

describe("validation", () => {
  test("heartbeat requires sn + timestamp", () => {
    expect(() => parseHeartbeat({})).toThrow();
    expect(parseHeartbeat({ sn: "S1", timestamp: 1 }).sn).toBe("S1");
  });

  test("dataUpload parses required fields", () => {
    const p = parseDataUpload({ sn: "S1", time: 1, in: 1, out: 0, passby: 2, turnback: 0 });
    expect(p.sn).toBe("S1");
    expect(p.in).toBe(1);
  });
});

