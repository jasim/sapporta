import { organization } from "better-auth/plugins";

export const projectAuthBasePath = "/api/auth";

/**
 * Better Auth includes this prefix in every auth cookie name. Browsers scope
 * localhost cookies without separating ports, so a distinct prefix prevents
 * Sapporta projects on different development ports from replacing one
 * another's sessions. Keep the value stable to preserve active sessions.
 */
export const projectAuthCookiePrefix = "%%SAPPORTA:AUTH_COOKIE_PREFIX%%";

export const projectAuthDrizzleAdapterConfig = {
  provider: "sqlite",
  camelCase: true,
} as const;

export function createProjectAuthEmailAndPasswordOptions(
  requireEmailVerification: boolean,
  sendResetPassword: (data: {
    user: { email: string; name?: string | null };
    url: string;
    token: string;
  }) => Promise<void>,
) {
  return {
    enabled: true,
    requireEmailVerification,
    sendResetPassword,
  };
}

/**
 * The account fields this project keeps beyond Better Auth's own.
 *
 * `timeZone` is the calendar the person signing up keeps, sent by the browser
 * with the sign-up request. It is the value the first workspace this account
 * creates starts on, and that is the whole of its job: nothing displays it and
 * nothing groups by it, because a day belongs to the workspace's calendar
 * rather than to any one reader's. It is required, so an account cannot come
 * into being without one and no workspace has to guess.
 */
export const projectAuthUserOptions = {
  additionalFields: {
    timeZone: {
      type: "string",
      required: true,
      input: true,
    },
  },
} as const;

export function createProjectAuthPlugins() {
  return [
    organization({
      schema: {
        organization: {
          additionalFields: {
            /**
             * The zone this workspace reads and groups days in, as an IANA id.
             *
             * An id rather than a fixed offset: an offset such as `+05:30`
             * describes one instant, and a report describes a range that can
             * contain the moment the offset changes. An id also survives a tz
             * rule change, which a number does not.
             *
             * Not nullable and with no "automatic" state: a workspace whose
             * zone were unset would make every day-grouped number ambiguous,
             * and there is no sensible fallback — the server's `TZ` is an
             * accident of deployment and the reader's browser is the
             * per-reader answer a workspace calendar exists to replace. The
             * `UTC` default is what a workspace created without a zone gets,
             * and it is a real choice, displayed like any other.
             */
            timeZone: {
              type: "string",
              required: true,
              defaultValue: "UTC",
              input: false,
            },
          },
        },
      },
    }),
  ];
}
