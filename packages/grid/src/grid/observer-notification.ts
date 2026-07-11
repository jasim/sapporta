export type ObserverErrorReporter = (error: unknown) => void;

export type ObserverList<Args extends readonly unknown[]> = {
  subscribe(observer: (...args: Args) => void): () => void;
  notify(...args: Args): void;
  clear(): void;
  size(): number;
};

type ObserverRegistration<Args extends readonly unknown[]> = {
  readonly observer: (...args: Args) => void;
  active: boolean;
};

// Public observers must not be able to interrupt the state transition that
// notified them. Reporting is best-effort for the same reason: an app reporter,
// the host's global reporter, and console.error are all outside grid control.
export function reportObserverError(
  error: unknown,
  onObserverError?: ObserverErrorReporter,
): void {
  if (onObserverError) {
    try {
      onObserverError(error);
      return;
    } catch {
      // Continue to the environment fallback with the original observer error.
    }
  }

  try {
    const reportError = globalThis.reportError;
    if (typeof reportError === "function") {
      try {
        reportError.call(globalThis, error);
        return;
      } catch {
        // Continue to the final guarded fallback.
      }
    }
  } catch {
    // Access to an environment reporter can itself be user-defined and throw.
  }

  try {
    console.error(error);
  } catch {
    // Observer reporting must never escape into the notifying grid command.
  }
}

export function createObserverList<Args extends readonly unknown[]>(
  onObserverError?: ObserverErrorReporter,
): ObserverList<Args> {
  const registrations: Array<ObserverRegistration<Args>> = [];

  return {
    subscribe(observer) {
      const registration: ObserverRegistration<Args> = {
        observer,
        active: true,
      };
      registrations.push(registration);

      return () => {
        if (!registration.active) return;
        registration.active = false;
        const index = registrations.indexOf(registration);
        if (index >= 0) registrations.splice(index, 1);
      };
    },

    notify(...args) {
      // A notification turn observes registrations present at its start. An
      // unsubscribe during delivery can still suppress a later registration;
      // a new registration waits until the next turn.
      for (const registration of registrations.slice()) {
        if (!registration.active) continue;
        try {
          registration.observer(...args);
        } catch (error) {
          reportObserverError(error, onObserverError);
        }
      }
    },

    clear() {
      for (const registration of registrations) {
        registration.active = false;
      }
      registrations.length = 0;
    },

    size() {
      return registrations.length;
    },
  };
}
