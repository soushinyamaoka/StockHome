import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

// NavigationContainerがまだmountされていない間に通知タップを受けた場合、
// navigateToStockItemは何もできない。呼び出し側がresponseをクリアせず
// 保持できるよう、準備完了を待って通知できるようにする（onReadyから呼ぶ）
type ReadyListener = () => void;
const readyListeners = new Set<ReadyListener>();

export function onNavigationReady(listener: ReadyListener): () => void {
  if (navigationRef.isReady()) {
    listener();
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

export function notifyNavigationReady(): void {
  const listeners = [...readyListeners];
  readyListeners.clear();
  listeners.forEach((listener) => listener());
}
