import type { TableDef } from "./table.js";

export interface RegistryEntry {
  def: TableDef;
}

/**
 * Mutable, in-memory registry of table schemas shared across a project's runtime.
 * The dynamic router queries this on each request to resolve table names to
 * schemas. Stable insertion order is preserved for sidebar display.
 */
export class SchemaRegistry {
  private entries = new Map<string, RegistryEntry>();
  private order: string[] = [];
  private listeners: Array<(name: string) => void> = [];

  /** Register a table definition. Re-registering the same name replaces in
   *  place and keeps the original ordering position. */
  register(def: TableDef): void {
    const name = def.sqlName;
    this.entries.set(name, { def });
    if (!this.order.includes(name)) {
      this.order.push(name);
    }
    this.notify(name);
  }

  unregister(name: string): void {
    if (this.entries.delete(name)) {
      this.order = this.order.filter((n) => n !== name);
      this.notify(name);
    }
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** All table definitions, in stable insertion order. */
  all(): TableDef[] {
    return this.order
      .filter((name) => this.entries.has(name))
      .map((name) => this.entries.get(name)!.def);
  }

  /** All entries, in stable insertion order. */
  allEntries(): RegistryEntry[] {
    return this.order
      .filter((name) => this.entries.has(name))
      .map((name) => this.entries.get(name)!);
  }

  onChange(listener: (name: string) => void): void {
    this.listeners.push(listener);
  }

  private notify(name: string): void {
    for (const listener of this.listeners) {
      listener(name);
    }
  }
}
