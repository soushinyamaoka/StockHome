import { api } from './client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  householdId: string;
  householdName: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  const res = await api.post('/api/auth/login', { email, password });
  return res.data;
}

export async function registerRequest(input: {
  email: string;
  password: string;
  name: string;
  householdName?: string;
}): Promise<AuthResponse> {
  const res = await api.post('/api/auth/register', input);
  return res.data;
}

export async function fetchMe(): Promise<{ user: AuthUser }> {
  const res = await api.get('/api/auth/me');
  return res.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/api/auth/change-password', { currentPassword, newPassword });
}
