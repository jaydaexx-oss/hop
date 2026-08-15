import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation, GroupConversation } from './HopContext';

export async function saveConvs(convs: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem('@hop/conversations', JSON.stringify(convs));
  } catch (e) {
    console.warn('[HOP] Failed to persist conversations:', e);
  }
}

export async function saveGroups(groups: GroupConversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem('@hop/groups', JSON.stringify(groups));
  } catch (e) {
    console.warn('[HOP] Failed to persist groups:', e);
  }
}
