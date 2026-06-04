export const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";

const API_BASE = `${API_ORIGIN}/api`;

export function getApiBase(): string {
  return API_BASE;
}
