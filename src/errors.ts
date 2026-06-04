export type HmacPropagationErrorCode = "MANAGEMENT_NOT_CONFIGURED" | "UNKNOWN_CLIENT" | "INVALID_OPTIONS" | "INTERNAL_ERROR";

export class HmacPropagationError extends Error {
  readonly code: HmacPropagationErrorCode;
  readonly cause?: unknown;

  constructor(code: HmacPropagationErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.code = code;
    this.cause = cause;
    this.name = "HmacPropagationError";
  }
}
