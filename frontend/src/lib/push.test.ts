import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("decodes unpadded base64url", () => {
    expect(Array.from(urlBase64ToUint8Array("BP8"))).toEqual([4, 255]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
