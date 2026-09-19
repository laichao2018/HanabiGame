const BASE = import.meta.env.VITE_API_URL ?? "";
export const token = { get: () => localStorage.getItem("hanabi_token"), set: (v: string) => localStorage.setItem("hanabi_token", v), clear: () => localStorage.removeItem("hanabi_token") };
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "请求失败"); return body as T;
}
export const socketUrl = BASE || window.location.origin;
