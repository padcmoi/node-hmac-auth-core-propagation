import { describe, expect, it } from "vitest";
import {
  buildQueueName,
  DEFAULT_AMQP_VHOST,
  decodeEvent,
  encodeAckEvent,
  encodeApplyEvent,
  isAckEvent,
  isApplyEvent,
  propagationSecretMatches,
} from "../src/wire.js";
import type { AckEvent, ApplyEvent } from "../src/types.js";

describe("wire", () => {
  it("vhost default is hmac-credentials", () => {
    expect(DEFAULT_AMQP_VHOST).toBe("hmac-credentials");
  });

  it("queue name is prefixed hmac- and suffixed .queue", () => {
    expect(buildQueueName("x-authority-hmac")).toBe("hmac-x-authority-hmac.queue");
    expect(buildQueueName("ABC123")).toBe("hmac-ABC123.queue");
  });

  it("queue name rejects forbidden characters", () => {
    expect(() => buildQueueName("bad name")).toThrow();
    expect(() => buildQueueName("bad/name")).toThrow();
    expect(() => buildQueueName("")).toThrow();
  });

  it("encodes and decodes an apply event byte-identically", () => {
    const event: ApplyEvent = {
      eventId: "00000000-0000-4000-8000-000000000001",
      ts: 1781000123456,
      propagationSecret: "secret-of-target-B",
      senderAmqpQueue: "x-authority-hmac",
      op: "credential.create",
      track: "http",
      clientId: "client_partner_a",
      payload: {
        secretHash: "deadbeef",
        allowedIps: ["10.0.0.0/8"],
        expiresAt: null,
      },
    };
    const buf = encodeApplyEvent(event);
    const back = decodeEvent(buf);
    expect(back).toEqual(event);
    expect(isApplyEvent(back)).toBe(true);
  });

  it("encodes and decodes an ack event byte-identically", () => {
    const ack: AckEvent = {
      eventId: "00000000-0000-4000-8000-000000000099",
      ts: 1781000125000,
      propagationSecret: "secret-of-sender-A",
      senderAmqpQueue: "x-ged-extract-mistral",
      op: "credential.ack",
      ackEventId: "00000000-0000-4000-8000-000000000001",
      ackResult: "applied",
      ackReason: null,
    };
    const buf = encodeAckEvent(ack);
    const back = decodeEvent(buf);
    expect(back).toEqual(ack);
    expect(isAckEvent(back)).toBe(true);
  });

  it("propagationSecretMatches returns true for equal strings and false for any difference", () => {
    expect(propagationSecretMatches("foo", "foo")).toBe(true);
    expect(propagationSecretMatches("foo", "bar")).toBe(false);
    expect(propagationSecretMatches("foo", "foobar")).toBe(false);
    expect(propagationSecretMatches("", "")).toBe(true);
  });

  it("decodeEvent rejects malformed payloads", () => {
    expect(() => decodeEvent("not json")).toThrow();
    expect(() => decodeEvent('{"hello":"world"}')).toThrow();
  });
});
