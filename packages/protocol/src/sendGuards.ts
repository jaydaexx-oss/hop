import { isCryptoBoxPayload } from "./cryptoBox.js";

/** Production sends require a distinct peer. Self-encrypt fallback is forbidden. */
export function requirePeerRecipient(senderId: string, recipientId: string | null | undefined): string {
  const sender = senderId.trim();
  const peer = (recipientId ?? "").trim();
  if (!sender || !peer || peer === sender) {
    throw new Error("Cannot send without a real recipient");
  }
  return peer;
}

export function isBoxedEnvelopePayload(payload: string | null | undefined): boolean {
  return Boolean(payload && isCryptoBoxPayload(payload));
}

export function refuseUnencryptedPayloadError(): string {
  return "Refusing to send plaintext or alg:none payload";
}
