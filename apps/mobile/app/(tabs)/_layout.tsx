import { SymbolView } from 'expo-symbols';
import { Redirect, Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useAuth } from '@/src/auth/AuthProvider';
import { useMessagesTabBadge } from '@/src/chat/useMessagesTabBadge';
import { DEFAULT_TAB_ROUTE } from '@/src/navigation/tabOrder';
import { formatUnreadBadge } from '@hop/protocol';

export const unstable_settings = {
  initialRouteName: DEFAULT_TAB_ROUTE,
};

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { ready, user } = useAuth();
  const messagesBadge = useMessagesTabBadge();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      initialRouteName={DEFAULT_TAB_ROUTE}
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="nearby"
        options={{
          title: 'Around Us',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'dot.radiowaves.left.and.right', android: 'wifi', web: 'wifi' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarBadge: formatUnreadBadge(messagesBadge) ?? undefined,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
    </Tabs>
  );
}
