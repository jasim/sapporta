import type { Location } from "react-router-dom";

/**
 * Keeps sign-in redirects inside the application. A value that leaves the app,
 * such as a full URL or a protocol-relative path, falls back to the home page.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/**
 * Reads the page a visitor asked for before being sent to sign in, so signing
 * in returns them to it. `AuthGate` records that page when it redirects; a
 * visitor who opened the sign-in page directly lands on the home page.
 */
export function signInRedirectPath(state: unknown): string {
  if (!state || typeof state !== "object" || !("from" in state)) return "/";
  const from = (state as { from: unknown }).from;
  if (!from || typeof from !== "object") return "/";
  const { pathname, search, hash } = from as Partial<Location>;
  if (typeof pathname !== "string") return "/";
  return safeRedirectPath(
    `${pathname}${typeof search === "string" ? search : ""}${
      typeof hash === "string" ? hash : ""
    }`,
  );
}
