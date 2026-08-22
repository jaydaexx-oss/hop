/**
 * Honest Chats IA. Direct stays 1:1. Events are a separate conversation kind.
 * Groups are still not a product surface.
 */
export const REAL_CHATS_SECTIONS = ['message_requests', 'direct', 'events'] as const;
export type RealChatsSectionId = (typeof REAL_CHATS_SECTIONS)[number];

export const CHATS_SECTION_TITLES: Record<RealChatsSectionId, string> = {
  message_requests: 'Message requests',
  direct: 'Direct',
  events: 'Events',
};

export type InboxRowKind = 'direct' | 'event';
export type InboxRowRole = 'host' | 'guest' | null;
export type InboxMenuActionId =
  | 'mute'
  | 'unmute'
  | 'delete_chat'
  | 'block'
  | 'leave_event'
  | 'remove_from_list';

export type InboxMenuAction = {
  id: InboxMenuActionId;
  label: string;
  destructive?: boolean;
};

/** Per-row ••• items. Chat delete is for-me only. Event owner never ends the event here. */
export function inboxRowMenuActions(input: {
  kind: InboxRowKind | string | null | undefined;
  myRole?: InboxRowRole | string | null;
  muted?: boolean;
  isEventOwner?: boolean;
}): InboxMenuAction[] {
  const kind = input.kind === 'event' ? 'event' : 'direct';
  if (kind === 'event') {
    const owner = input.isEventOwner === true || input.myRole === 'host';
    if (owner) {
      return [{ id: 'remove_from_list', label: 'Remove from chat list', destructive: true }];
    }
    return [{ id: 'leave_event', label: 'Leave event', destructive: true }];
  }
  return [
    input.muted ? { id: 'unmute', label: 'Unmute' } : { id: 'mute', label: 'Mute' },
    { id: 'delete_chat', label: 'Delete chat', destructive: true },
    { id: 'block', label: 'Block user', destructive: true },
  ];
}

export function isEventInboxOwner(input: {
  kind?: string | null;
  myRole?: string | null;
  hostId?: string | null;
  selfId?: string | null;
}): boolean {
  if (input.kind !== 'event') return false;
  if (input.myRole === 'host') return true;
  return Boolean(input.hostId && input.selfId && input.hostId === input.selfId);
}
