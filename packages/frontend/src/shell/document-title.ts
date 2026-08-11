import { useEffect, useRef, type MutableRefObject } from "react";
import { useSchemaStore } from "../schema-catalog/state/schema-store";

/**
 * The browser tab mirrors the current screen as "<page> – <app name>", so
 * history entries and open tabs stay tellable apart. Screens declare their
 * part with `usePageTitle`; `PageHeader` does this automatically from its
 * `title` prop, so most screens need nothing extra.
 *
 * Declarations form a stack: the most recent one shows, and unmounting
 * restores the one before it. A drawer or panel can therefore take over the
 * title while it is open without the underlying page losing its own.
 *
 * The app name comes from the loaded project info when available, and
 * otherwise stays what index.html shipped with.
 */

interface TitleEntry {
  id: number;
  text: string;
}

let entries: readonly TitleEntry[] = [];
let nextEntryId = 1;
let bootTitle: string | null = null;
let unsubscribeProjectName: (() => void) | null = null;

function appName(): string {
  return useSchemaStore.getState().name ?? bootTitle ?? "";
}

function composedTitle(): string {
  const page = entries.at(-1)?.text;
  const app = appName();
  if (!page) return app;
  if (!app || page === app) return page;
  return `${page} – ${app}`;
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (bootTitle === null) bootTitle = document.title;
  if (unsubscribeProjectName === null) {
    // The project name usually loads after the first screen renders, and it
    // can change when a project is renamed; recompose when it arrives.
    unsubscribeProjectName = useSchemaStore.subscribe((state, previous) => {
      if (state.name !== previous.name) apply();
    });
  }
  const next = composedTitle();
  if (next && document.title !== next) document.title = next;
}

function removeEntry(idRef: MutableRefObject<number | null>): void {
  if (idRef.current === null) return;
  const id = idRef.current;
  idRef.current = null;
  entries = entries.filter((entry) => entry.id !== id);
  apply();
}

/**
 * Show `title` in the browser tab while the calling component is mounted.
 * Pass `false` (or `undefined`) to declare nothing — useful when a component
 * takes over the title only under some conditions.
 */
export function usePageTitle(title?: string | false | null): void {
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    if (!title) {
      removeEntry(idRef);
      return;
    }
    if (idRef.current === null) {
      idRef.current = nextEntryId++;
      entries = [...entries, { id: idRef.current, text: title }];
    } else {
      // Update in place so a title change does not jump past a declaration
      // that mounted later.
      entries = entries.map((entry) =>
        entry.id === idRef.current ? { ...entry, text: title } : entry,
      );
    }
    apply();
  }, [title]);

  useEffect(() => {
    return () => removeEntry(idRef);
  }, []);
}

/** Forget all title declarations and the captured boot title. For tests. */
export function resetPageTitles(): void {
  entries = [];
  nextEntryId = 1;
  bootTitle = null;
  unsubscribeProjectName?.();
  unsubscribeProjectName = null;
}
