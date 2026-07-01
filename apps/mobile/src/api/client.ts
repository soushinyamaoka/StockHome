import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_PORT = 4002;

function resolveBaseUrl(): string {
  // 起動モード。'local' のときは VPS 設定を無視し、Expo 開発サーバのホスト
  //（= PC の LAN IP）自動判定にフォールバックする。
  const target = process.env.EXPO_PUBLIC_API_TARGET;

  // VPS の API URL は Git 管理外の apps/mobile/.env（EXPO_PUBLIC_API_BASE_URL）から読む。
  // VPS の IP をリポジトリにコミットしないため。新しい PC では .env.example をコピーして設定する。
  // local モードでは無視して LAN 自動判定に回す。
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (target !== 'local' && envUrl) {
    return envUrl;
  }

  // 後方互換: app.json extra.apiBaseUrl があれば使う（現在は未設定）
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  const explicit = target === 'local' ? undefined : extra?.apiBaseUrl;
  if (explicit && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).expoGoConfig?.debuggerHost ??
    (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const host = String(hostUri).split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:${API_PORT}`;
    }
  }
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${API_PORT}`;
  }
  return explicit ?? `http://localhost:${API_PORT}`;
}

export const api = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: 15000,
});

const TOKEN_KEY = 'stockhome.token';
const isWeb = Platform.OS === 'web';

async function persistToken(token: string) {
  if (isWeb) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function removeToken() {
  if (isWeb) {
    window.localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

async function readToken(): Promise<string | null> {
  if (isWeb) {
    return window.localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setStoredToken(token: string | null) {
  if (token) {
    await persistToken(token);
  } else {
    await removeToken();
  }
}

export async function getStoredToken(): Promise<string | null> {
  return readToken();
}

api.interceptors.request.use(async (config) => {
  const token = await getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
