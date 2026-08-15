---
name: HOP protocol audit
description: Bugs found in jaydaexx-oss/hop and fixes applied to the Replit project.
---

# HOP Repo Audit — Bugs Found & Fixed

## Repo: jaydaexx-oss/hop

### Bug 1 (CRITICAL) — processQueue ignores backoff delay
**File**: `packages/protocol/src/transportManager.ts`  
`nextBackoffMs()` returns a ms delay but `processQueue` never waits — all queued items are retried immediately on every call. Backoff is computed but thrown away.  
**Fix**: Added `nextAttemptAt: number` to `QueueItem`. `processQueue` skips items whose `nextAttemptAt > now`. Re-queued items set `nextAttemptAt = now + backoffMs`.

### Bug 2 (MINOR) — enqueue returns `{ ok: true, error: "Queued for retry" }`
`ok: true` alongside a non-null `error` string is semantically contradictory.  
**Fix**: Return `{ ok: true, queued: true }` with no `error` field for the queued case.

### Bug 3 (MODERATE) — transition() throws misleading error for expired messages
When a message is expired and caller requests a non-EXPIRED status, `IllegalStateTransitionError` is thrown with a message like "Illegal message transition: SENDING -> DELIVERED", hiding the real cause.  
**Fix**: Throw new `ExpiredMessageError` class with a clear expiry message.

## Our app (artifacts/hop)

### Bug 4 — useColors defaults light theme on web
`useColorScheme()` returns null on web → light palette shown instead of dark.  
**Fix**: `Appearance.setColorScheme('dark')` called at module load; hook defaults to `'dark'`.

### Bug 5 — genId used Math.random() (not CSPRNG)
Repo mandates `crypto.randomUUID()`. Our context used a weak RNG for message IDs.  
**Fix**: All IDs now use `createMessageId()` from `protocol/message.ts` (CSPRNG with UUID v4 fallback).

### Bug 6 — No deduplication
Repo has `ProcessedIdSet`. Our context had none, allowing duplicate messages.  
**Fix**: `ProcessedIdSet` (10k cap) guards `sendMessage`.

### Bug 7 — setTimeout inside setConversations updater
Bot reply timeout was scheduled inside the state updater function. React Strict Mode's double invocation fires two timeouts → duplicate bot replies.  
**Fix**: Timeout scheduled in the outer function body, before `setConversations` is called.

## Protocol layer location in project
`artifacts/hop/protocol/` — message.ts, stateMachine.ts, duplicates.ts, retry.ts, transportManager.ts
