import { describe, expect, it } from "vitest";
import type { NavLink } from "@sapporta/shared/contracts";
import { resolveLink, resolveLinks } from "./resolve-link";

describe("resolveLink", () => {
  const row = { id: 7, customer_id: "cust-1", region: "west", empty: null };

  it("resolves table links into equality-filtered table URLs", () => {
    const link: NavLink = {
      kind: "table",
      table: "invoices",
      bind: { customer_id: "customer_id" },
    };
    const resolved = resolveLink(link, { values: row });
    expect(resolved).not.toBeNull();
    expect(resolved!.href).toContain("/tables/invoices?");
    expect(decodeURIComponent(resolved!.href)).toContain("customer_id");
    expect(decodeURIComponent(resolved!.href)).toContain("cust-1");
    expect(resolved!.label).toBe("Open invoices");
    expect(resolved!.icon).toBe("drill-into");
    expect(resolved!.target).toBe("_self");
  });

  it("uses the table display label when available", () => {
    const link: NavLink = {
      kind: "table",
      table: "invoices",
      bind: { customer_id: "customer_id" },
    };
    const resolved = resolveLink(link, {
      values: row,
      tableLabel: (t) => (t === "invoices" ? "Invoices" : undefined),
    });
    expect(resolved!.label).toBe("Open Invoices");
  });

  it("supports composite binds", () => {
    const link: NavLink = {
      kind: "table",
      table: "invoices",
      bind: { customer_id: "customer_id", region: "region" },
    };
    const href = resolveLink(link, { values: row })!.href;
    expect(decodeURIComponent(href)).toContain("cust-1");
    expect(decodeURIComponent(href)).toContain("west");
  });

  it("returns null when any bound source value is missing", () => {
    const link: NavLink = {
      kind: "table",
      table: "invoices",
      bind: { customer_id: "empty" },
    };
    expect(resolveLink(link, { values: row })).toBeNull();
    expect(
      resolveLink(
        { ...link, bind: { customer_id: "not_a_column" } },
        { values: row },
      ),
    ).toBeNull();
  });

  it("resolves report names under /reports and keeps absolute paths", () => {
    const named: NavLink = {
      kind: "report",
      report: "aging",
      bind: { customer: "customer_id" },
    };
    expect(resolveLink(named, { values: row })!.href).toBe(
      "/reports/aging?customer=cust-1",
    );

    const absolute: NavLink = {
      kind: "report",
      report: "/finance/aging",
      bind: { customer: "customer_id" },
    };
    const resolved = resolveLink(absolute, { values: row })!;
    expect(resolved.href).toBe("/finance/aging?customer=cust-1");
    expect(resolved.icon).toBe("report");
  });

  it("substitutes url placeholders and appends bound query params", () => {
    const link: NavLink = {
      kind: "url",
      href: "/customers/{customer_id}/timeline",
      bind: { region: "region" },
    };
    expect(resolveLink(link, { values: row })!.href).toBe(
      "/customers/cust-1/timeline?region=west",
    );
  });

  it("returns null when a url placeholder value is missing", () => {
    const link: NavLink = { kind: "url", href: "/x/{empty}" };
    expect(resolveLink(link, { values: row })).toBeNull();
  });

  it("defaults external urls to a new tab", () => {
    const external = resolveLink(
      { kind: "url", href: "https://example.com/{customer_id}" },
      { values: row },
    )!;
    expect(external.target).toBe("_blank");
    expect(external.icon).toBe("external");

    const internal = resolveLink(
      { kind: "url", href: "/somewhere/{customer_id}" },
      { values: row },
    )!;
    expect(internal.target).toBe("_self");
  });

  it("honors explicit label, icon, and target", () => {
    const resolved = resolveLink(
      {
        kind: "table",
        table: "invoices",
        bind: { customer_id: "customer_id" },
        label: "Invoices for customer",
        icon: "drill-up",
        target: "_blank",
      },
      { values: row },
    )!;
    expect(resolved.label).toBe("Invoices for customer");
    expect(resolved.icon).toBe("drill-up");
    expect(resolved.target).toBe("_blank");
  });
});

describe("resolveLinks", () => {
  it("drops unresolvable links and deduplicates identical destinations", () => {
    const row = { customer_id: "cust-1", missing: null };
    const links: NavLink[] = [
      {
        kind: "table",
        table: "invoices",
        bind: { customer_id: "customer_id" },
      },
      {
        kind: "table",
        table: "invoices",
        bind: { customer_id: "customer_id" },
      },
      { kind: "table", table: "invoices", bind: { customer_id: "missing" } },
    ];
    const resolved = resolveLinks(links, { values: row });
    expect(resolved).toHaveLength(1);
  });
});
