// Expo Push トークンの取得と API 登録
// 端末の Expo Go では受信できないため、開発ビルド/内部配布APKでの利用を前提とする。
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushDevice } from '../api/misc';
import { navigationRef } from '../navigation/navigationRef';

// 遷移できたかを呼び出し元へ伝える。呼び出し元はtrueのときだけ
// 通知responseをクリアすること（navigation未準備で消してしまうと復旧できない）
export function navigateToStockItem(itemId?: string): boolean {
  if (!navigationRef.isReady()) return false;
  try {
    navigationRef.navigate('StocksTab', {
      screen: 'StockList',
      params: itemId ? { highlightItemId: itemId } : {},
    });
    return true;
  } catch {
    // Ignore notification taps while the target navigator is unavailable.
    return false;
  }
}

// 成功時はExpo Push Tokenを返す（設定画面のテスト送信で、現在のtokenの再取得・
// 再登録を兼ねて呼べるようにするため）。許可が得られない等の場合はnull
export async function registerForPushNotifications(): Promise<string | null> {
  // 通知の表示方法（アプリ起動中でもバナーを出す）
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '在庫アラート',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId as string | undefined;
  if (!projectId) return null;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return token;
}
