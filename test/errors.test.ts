import { describe, expect, it } from "vitest";
import { HmacPropagationError } from "../src/errors.js";

describe("HmacPropagationError", () => {
  it("carries the code", () => {
    const err = new HmacPropagationError("MANAGEMENT_NOT_CONFIGURED");
    expect(err.code).toBe("MANAGEMENT_NOT_CONFIGURED");
    expect(err.message).toBe("MANAGEMENT_NOT_CONFIGURED");
    expect(err.name).toBe("HmacPropagationError");
    expect(err instanceof Error).toBe(true);
  });

  it("carries an optional message and cause", () => {
    const cause = new Error("upstream");
    const err = new HmacPropagationError("INTERNAL_ERROR", "broker disconnected", cause);
    expect(err.message).toBe("broker disconnected");
    expect(err.cause).toBe(cause);
  });
});
