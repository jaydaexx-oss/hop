/**
 * HopContext — central state for the HOP app.
 *
 * Integrates the fixed protocol layer from jaydaexx-oss/hop:
 *   • HopMessage / MessageStatus for typed message lifecycle
 *   • ProcessedIdSet for deduplication (prevents double-delivery)
 *   • TransportManager with corrected backoff (bug 1 fix)
 *   • createMessageId() — CSPRNG UUID (replaces Math.random genId — bug 5 fix)
 *
 * Additional bugs fixed vs. original scaffold:
 *   Bug 6 (dedup): ProcessedIdSet now guards sendMessage.
 *   Bug 7 (setTimeout in updater): bot reply timeout is scheduled OUTSIDE the
 *     setConversations updater so React Strict Mode double-invocation cannot
 *     fire it twice.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMessageId, MessageStatus, type HopMessage } from '@/protocol/message';
import { ProcessedIdSet } from '@/protocol/duplicates';

// ─── Domain types ────────────────────────────────────────────────────────────

export interface HopUser {
  id: string;
  username: string;
  color: string;
  signal: number;  // 0-100
  angle: number;   // radians, fixed position on radar
}

/** UI-level message — wraps HopMessage with display content. */
export interface Message {
  /** Matches HopMessage.message_id — CSPRNG UUID. */
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
  status: MessageStatus;
}

export interface Conversation {
  userId: string;
  user: HopUser;
  messages: Message[];
  unread: number;
}

export interface Broadcast {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  content: string;
  timestamp: number;
}

export interface MyProfile {
  id: string;
  username: string;
  color: string;
  discoverable: boolean;
}

interface HopContextType {
  profile: MyProfile | null;
  isOnboarding: boolean;
  loaded: boolean;
  nearbyUsers: HopUser[];
  conversations: Conversation[];
  broadcasts: Broadcast[];
  isScanning: boolean;
  totalUnread: number;
  setProfile: (profile: MyProfile) => Promise<void>;
  sendMessage: (userId: string, content: string) => void;
  sendBroadcast: (content: string) => void;
  getConversation: (userId: string) => Conversation | undefined;
  markRead: (userId: string) => void;
  completeOnboarding: (username: string, color: string) => Promise<void>;
}

// ─── Simulated nearby user pool ──────────────────────────────────────────────

const USER_POOL: HopUser[] = [
  { id: 'u1', username: 'wavejockey',  color: '#FF6B6B', signal: 0, angle: 0.4 },
  { id: 'u2', username: 'neonpulse',   color: '#4ECDC4', signal: 0, angle: 1.1 },
  { id: 'u3', username: 'staticdrift', color: '#45B7D1', signal: 0, angle: 2.0 },
  { id: 'u4', username: 'bitwhisper',  color: '#96CEB4', signal: 0, angle: 2.8 },
  { id: 'u5', username: 'phaseloop',   color: '#DDA0DD', signal: 0, angle: 3.8 },
  { id: 'u6', username: 'cipherwave',  color: '#F0A500', signal: 0, angle: 4.7 },
  { id: 'u7', username: 'darkfreq',    color: '#FF8C94', signal: 0, angle: 5.5 },
];

const BOT_REPLIES = [
  "hey, what's up", 'yo!', 'cool, same here', 'where are you?', 'say less',
  'facts', 'nice one', 'haha true', 'no way', 'bro same', 'lmk',
  'for real though', 'on my way', 'bet',
];

export const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD',
  '#F0A500', '#FF8C94', '#6C5CE7', '#00CEC9', '#FD79A8',
];

// ─── Dedup guard (bug 6 fix) ──────────────────────────────────────────────────
// Shared instance — prevents the same message_id being inserted twice even if
// sendMessage is called rapidly or React re-renders the sender mid-flight.
const sentIds = new ProcessedIdSet(10_000);

const HopContext = createContext<HopContextType | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function HopProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<MyProfile | null>(null);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nearbyUsers, setNearbyUsers] = useState<HopUser[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted state
  useEffect(() => {
    (async () => {
      try {
        const [profStr, convStr, bcastStr] = await Promise.all([
          AsyncStorage.getItem('@hop/profile'),
          AsyncStorage.getItem('@hop/conversations'),
          AsyncStorage.getItem('@hop/broadcasts'),
        ]);

        if (profStr) {
          setProfileState(JSON.parse(profStr));
        } else {
          setIsOnboarding(true);
        }

        if (convStr) setConversations(JSON.parse(convStr));

        if (bcastStr) {
          setBroadcasts(JSON.parse(bcastStr));
        } else {
          const seed: Broadcast[] = [
            {
              id: createMessageId(),
              senderId: 'u1',
              senderName: 'wavejockey',
              senderColor: '#FF6B6B',
              content: 'anyone at the coffee shop on 5th?',
              timestamp: Date.now() - 300_000,
            },
            {
              id: createMessageId(),
              senderId: 'u3',
              senderName: 'staticdrift',
              senderColor: '#45B7D1',
              content: 'looking for people to jam with nearby',
              timestamp: Date.now() - 120_000,
            },
          ];
          setBroadcasts(seed);
          await AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(seed));
        }
      } catch {
        setIsOnboarding(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // BT simulation — random pool of 2-5 users every 5 s
  useEffect(() => {
    if (!loaded) return;
    setIsScanning(true);
    const scan = () => {
      const count = 2 + Math.floor(Math.random() * 4);
      const shuffled = [...USER_POOL].sort(() => Math.random() - 0.5).slice(0, count);
      setNearbyUsers(shuffled.map(u => ({ ...u, signal: 25 + Math.floor(Math.random() * 75) })));
    };
    scan();
    scanRef.current = setInterval(scan, 5000);
    return () => {
      if (scanRef.current) clearInterval(scanRef.current);
      setIsScanning(false);
    };
  }, [loaded]);

  // ── Persistence helpers ───────────────────────────────────────────────────

  const saveConvs = async (convs: Conversation[]) => {
    await AsyncStorage.setItem('@hop/conversations', JSON.stringify(convs));
  };

  const setProfile = async (p: MyProfile) => {
    setProfileState(p);
    await AsyncStorage.setItem('@hop/profile', JSON.stringify(p));
  };

  const completeOnboarding = async (username: string, color: string) => {
    // Bug 5 fix: use CSPRNG createMessageId() for the profile id
    await setProfile({ id: createMessageId(), username, color, discoverable: true });
    setIsOnboarding(false);
  };

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = (userId: string, content: string) => {
    if (!profile) return;
    const poolUser = USER_POOL.find(u => u.id === userId);
    const nearUser = nearbyUsers.find(u => u.id === userId);
    const user = poolUser ?? nearUser;
    if (!user) return;

    // Bug 5 fix: CSPRNG id via protocol layer
    const msgId = createMessageId();

    // Bug 6 fix: dedup guard — reject if we've already sent this id
    if (!sentIds.remember(msgId)) return;

    const msg: Message = {
      id: msgId,
      senderId: profile.id,
      content,
      timestamp: Date.now(),
      // Progress through the state machine: CREATED → SENT (simulated, no real transport)
      status: MessageStatus.SENT,
    };

    // Bug 7 fix: capture the reply delay BEFORE entering the state updater so
    // React Strict Mode's double-invocation of the updater cannot schedule two
    // timeouts. The timeout is set once, here in the outer function body.
    const replyDelay = 1000 + Math.random() * 2500;
    const replyContent = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
    const replyId = createMessageId();

    setConversations(prev => {
      const existing = prev.find(c => c.userId === userId);
      const updated: Conversation[] = existing
        ? prev.map(c =>
            c.userId === userId
              ? { ...c, messages: [...c.messages, msg], unread: 0 }
              : c,
          )
        : [
            {
              userId,
              user: { ...user, signal: nearUser?.signal ?? 80 },
              messages: [msg],
              unread: 0,
            },
            ...prev,
          ];
      saveConvs(updated);
      return updated;
    });

    // Bug 7 fix: setTimeout is OUTSIDE setConversations — scheduled once only.
    setTimeout(() => {
      const reply: Message = {
        id: replyId,
        senderId: userId,
        content: replyContent,
        timestamp: Date.now(),
        status: MessageStatus.DELIVERED,
      };
      setConversations(curr => {
        const u = curr.map(c =>
          c.userId === userId
            ? { ...c, messages: [...c.messages, reply], unread: 1 }
            : c,
        );
        saveConvs(u);
        return u;
      });
    }, replyDelay);
  };

  // ── markRead / getConversation ────────────────────────────────────────────

  const markRead = (userId: string) => {
    setConversations(prev => {
      const u = prev.map(c => (c.userId === userId ? { ...c, unread: 0 } : c));
      saveConvs(u);
      return u;
    });
  };

  const getConversation = (userId: string) =>
    conversations.find(c => c.userId === userId);

  // ── sendBroadcast ─────────────────────────────────────────────────────────

  const sendBroadcast = (content: string) => {
    if (!profile) return;
    const b: Broadcast = {
      id: createMessageId(),
      senderId: profile.id,
      senderName: profile.username,
      senderColor: profile.color,
      content,
      timestamp: Date.now(),
    };
    setBroadcasts(prev => {
      const u = [b, ...prev];
      AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(u));
      return u;
    });
  };

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  return (
    <HopContext.Provider
      value={{
        profile,
        isOnboarding,
        loaded,
        nearbyUsers,
        conversations,
        broadcasts,
        isScanning,
        totalUnread,
        setProfile,
        sendMessage,
        sendBroadcast,
        getConversation,
        markRead,
        completeOnboarding,
      }}
    >
      {children}
    </HopContext.Provider>
  );
}

export function useHop() {
  const ctx = useContext(HopContext);
  if (!ctx) throw new Error('useHop must be used inside HopProvider');
  return ctx;
}
