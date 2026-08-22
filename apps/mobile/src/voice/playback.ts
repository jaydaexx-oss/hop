type StopFn = () => void | Promise<void>;

let activeId: string | null = null;
let stopActive: StopFn | null = null;

/** Only one voice bubble may play. Starting another stops the previous. */
export function claimVoicePlayback(messageId: string, stop: StopFn): void {
  if (activeId && activeId !== messageId) {
    const previous = stopActive;
    stopActive = null;
    activeId = null;
    if (previous) void Promise.resolve(previous()).catch(() => undefined);
  }
  activeId = messageId;
  stopActive = stop;
}

export function releaseVoicePlayback(messageId: string): void {
  if (activeId !== messageId) return;
  activeId = null;
  stopActive = null;
}

export function activeVoicePlaybackId(): string | null {
  return activeId;
}
