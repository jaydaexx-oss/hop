import { describe, expect, it } from "vitest";
import { decryptApplicationMessage } from "../src/cryptoBox.js";
import { SimulatedNetwork } from "../src/simulatedNetwork.js";

async function lineABC() {
  const net = new SimulatedNetwork();
  await net.addNode("A", true);
  await net.addNode("B", true);
  await net.addNode("C", true);
  net.connect("A", "B");
  net.connect("B", "C");
  return net;
}

async function lineABCD() {
  const net = await lineABC();
  await net.addNode("D", true);
  net.connect("C", "D");
  return net;
}

describe("controlled peer-relay simulator", () => {
  it("delivers A → B → C without letting B read plaintext", async () => {
    const net = await lineABC();
    const result = await net.sendText("A", "C", "secret for C");
    expect(result.ok).toBe(true);
    expect(net.node("C").inbox).toEqual([
      expect.objectContaining({ text: "secret for C", sender_id: "A" }),
    ]);
    expect(net.node("B").inbox).toHaveLength(0);
    await expect(
      decryptApplicationMessage(result.envelope.encrypted_payload, net.node("B").keys),
    ).rejects.toThrow();
    expect(result.envelope.encrypted_payload).not.toContain("secret for C");
    expect(net.events.some((event) => event.type === "relay" && event.node === "B")).toBe(true);
    expect(net.events.some((event) => event.type === "delivered" && event.node === "C")).toBe(true);
    expect(net.node("A").deliveryAcks.has(result.envelope.message_id)).toBe(true);
  });

  it("delivers A → B → C → D with hop-by-hop ack", async () => {
    const net = await lineABCD();
    const result = await net.sendText("A", "D", "four hop payload");
    expect(result.ok).toBe(true);
    expect(net.node("D").inbox.map((row) => row.text)).toEqual(["four hop payload"]);
    expect(net.node("B").inbox).toHaveLength(0);
    expect(net.node("C").inbox).toHaveLength(0);
    await expect(
      decryptApplicationMessage(result.envelope.encrypted_payload, net.node("C").keys),
    ).rejects.toThrow();
    expect(
      net.events
        .filter((event) => event.type === "relay" && event.message_id === result.envelope.message_id)
        .map((event) => event.node),
    ).toEqual(["B", "C"]);
    expect(net.node("A").deliveryAcks.has(result.envelope.message_id)).toBe(true);
  });

  it("drops duplicate packets after the first delivery", async () => {
    const net = await lineABC();
    const { envelope } = await net.sendText("A", "C", "once");
    expect(net.node("C").inbox).toHaveLength(1);
    const again = await net.inject("B", "A", envelope);
    expect(again).toBe(true);
    expect(net.node("C").inbox).toHaveLength(1);
  });

  it("drops expired messages", async () => {
    const net = await lineABC();
    net.setNow(new Date("2026-01-01T00:00:00.000Z"));
    const envelope = await net.craftEnvelope("A", "C", "too old", { ttlMs: 1 });
    net.setNow(new Date("2026-01-01T00:00:01.000Z"));
    const acked = await net.inject("B", "A", envelope);
    expect(acked).toBe(false);
    expect(net.node("C").inbox).toHaveLength(0);
    expect(net.events.some((event) => event.type === "drop" && event.reason === "expired")).toBe(true);
  });

  it("fails when a device disappears", async () => {
    const net = await lineABCD();
    net.removeNode("C");
    const result = await net.sendText("A", "D", "nobody home");
    expect(result.ok).toBe(false);
    expect(net.node("D").inbox).toHaveLength(0);
  });

  it("fails on a broken route", async () => {
    const net = await lineABCD();
    net.disconnect("B", "C");
    const result = await net.sendText("A", "D", "cut link");
    expect(result.ok).toBe(false);
    expect(net.node("D").inbox).toHaveLength(0);
  });

  it("does not relay without consent", async () => {
    const net = await lineABC();
    net.node("B").consent = false;
    const result = await net.sendText("A", "C", "nope");
    expect(result.ok).toBe(false);
    expect(net.node("C").inbox).toHaveLength(0);
    expect(net.events.some((event) => event.type === "drop" && event.reason === "no_consent")).toBe(true);
  });

  it("retries after a dropped packet then delivers", async () => {
    const net = await lineABC();
    net.dropNextPacket("A", "B");
    const result = await net.sendText("A", "C", "lossy");
    expect(result.ok).toBe(true);
    expect(net.node("C").inbox.map((row) => row.text)).toEqual(["lossy"]);
  });

  it("does not loop on a triangle", async () => {
    const net = new SimulatedNetwork();
    await net.addNode("A");
    await net.addNode("B");
    await net.addNode("C");
    await net.addNode("D");
    net.connect("A", "B");
    net.connect("B", "C");
    net.connect("C", "A");
    const result = await net.sendText("A", "D", "no destination");
    expect(result.ok).toBe(false);
    const relays = net.events.filter((event) => event.type === "relay");
    expect(relays.length).toBeLessThan(8);
    expect(net.node("D").inbox).toHaveLength(0);
  });
});
