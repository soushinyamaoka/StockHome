export function isAuthRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const axiosError = error as { isAxiosError?: unknown; response?: unknown };
  if (axiosError.isAxiosError !== true) return false;
  const response = axiosError.response;
  if (typeof response !== 'object' || response === null) return false;
  const status = (response as { status?: unknown }).status;
  return status === 401 || status === 403;
}
