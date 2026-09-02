// Expo Push トークンの取得と API 登録
// 端末の Expo Go では受信できないため、開発ビルド/内部配布APKでの利用を前提とする。
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushDevice } from '../api/misc';

export async function registerForPushNotifications(): Promise<boolean> {
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
  if (status !== 'granted') return false;

  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId as string | undefined;
  if (!projectId) return false;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return true;
}
