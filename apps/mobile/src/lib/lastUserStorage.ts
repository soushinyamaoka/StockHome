import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser } from '../api/auth';

const LAST_USER_KEY = 'stockhome.auth.lastUser.v1';
const REQUIRED_STRING_FIELDS = ['id', 'email', 'name', 'householdId', 'householdName', 'role'] as const;

export async function loadLastUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!REQUIRED_STRING_FIELDS.every((field) => typeof (parsed as Record<string, unknown>)[field] === 'string')) return null;
    return parsed as AuthUser;
  } catch {
    return null;
  }
}

export async function saveLastUser(user: AuthUser): Promise<void> {
  try { await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(user)); } catch { /* cache is optional */ }
}

export async function clearLastUser(): Promise<void> {
  try { await AsyncStorage.removeItem(LAST_USER_KEY); } catch { /* cache is optional */ }
}
