import { describe, expect, it } from "vitest";
import { previewToken, validPreviewToken } from "../src/lib/server/preview.ts";

describe("preview links", () => {
  it("are valid for their project only", () => {
    const t = previewToken("demo");
    expect(validPreviewToken("demo", t)).toBe(true);
    expect(validPreviewToken("other", t)).toBe(false);
  });
  it("refuse tampered or expired tokens", () => {
    const [exp, sig] = previewToken("demo").split(".");
    expect(validPreviewToken("demo", `${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(validPreviewToken("demo", `${exp}.${sig!.slice(0, -1)}x`)).toBe(false);
    expect(validPreviewToken("demo", `${Date.now() - 1}.${sig}`)).toBe(false);
    expect(validPreviewToken("demo", "garbage")).toBe(false);
  });
});
