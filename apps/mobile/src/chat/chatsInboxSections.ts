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
