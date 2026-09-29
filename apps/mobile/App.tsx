import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import {
  useFonts,
  ZenMaruGothic_400Regular,
  ZenMaruGothic_500Medium,
  ZenMaruGothic_700Bold,
  ZenMaruGothic_900Black,
} from '@expo-google-fonts/zen-maru-gothic';
import { Fraunces_700Bold, Fraunces_900Black } from '@expo-google-fonts/fraunces';
import { AuthProvider } from './src/hooks/useAuth';
import { NoticesProvider } from './src/hooks/useNoticesFeed';
import { QUERY_CACHE_MAX_AGE_MS, queryClient, queryPersister, shouldPersistQuery } from './src/lib/queryClient';
import { RootNavigator } from './src/navigation';
import { COLORS } from './src/theme';

export default function App() {
  const [fontsLoaded] = useFonts({
    ZenMaruGothic_400Regular,
    ZenMaruGothic_500Medium,
    ZenMaruGothic_700Bold,
    ZenMaruGothic_900Black,
    Fraunces_700Bold,
    Fraunces_900Black,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.paper, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.accent} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: QUERY_CACHE_MAX_AGE_MS,
            buster: 'v1',
            dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
          }}
        >
          <NoticesProvider>
          <AuthProvider>
            {/* SDK55+ で Android は edge-to-edge 必須化により backgroundColor は無効。
                各画面のコンテナ背景色(COLORS.paper)がステータスバー下に透けて見える */}
            <StatusBar style="dark" />
            <RootNavigator />
          </AuthProvider>
          </NoticesProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
