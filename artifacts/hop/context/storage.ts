import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation, GroupConversation } from './HopContext';

export async function saveConvs(convs: Conversation[], onError?: () => void): Promise<void> {
  try {
    await AsyncStorage.setItem('@hop/conversations', JSON.stringify(convs));
  } catch (e) {
    console.warn('[HOP] Failed to persist conversations:', e);
    onError?.();
  }
}

export async function saveGroups(groups: GroupConversation[], onError?: () => void): Promise<void> {
  try {
    await AsyncStorage.setItem('@hop/groups', JSON.stringify(groups));
  } catch (e) {
    console.warn('[HOP] Failed to persist groups:', e);
    onError?.();
  }
}

export async function saveBroadcasts(broadcasts: object[], onError?: () => void): Promise<void> {
  try {
    await AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(broadcasts));
  } catch (e) {
    console.warn('[HOP] Failed to persist broadcasts:', e);
    onError?.();
  }
}
