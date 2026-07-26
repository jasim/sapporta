import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { AppAbility, AppAuthFacts } from "./types.js";

/**
 * Defines what this requester may do.
 *
 * No rule means no access. Generated table routes ask for actions such as
 * `read`, `create`, and `export` on the table name. Custom routes can use
 * subjects such as `quote_publication`. Row access is defined separately in
 * `request-data-authority.ts`.
 */
export function buildAbility(ctx: AppAuthFacts): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // PUBLIC: this sample route is intentionally available to anonymous visitors.
  // Do not add real data subjects here unless the feature is meant to be public.
  can("read", "public_api_sample");

  if (ctx.principal.kind === "user") {
    can("read", "hello");
    can("read", "agent_access_token");
    can("create", "agent_access_token");
    can("delete", "agent_access_token");
  }

  if (
    ctx.principal.kind === "user" &&
    ctx.principal.membership.roles.includes("owner")
  ) {
    // `manage all` below would also include this unrestricted access subject.
    // Keep the explicit grant so the owner role's raw system access is visible.
    can("manage", "sapporta_unrestricted_access");

    // This allows owner actions; row security still limits database rows to the
    // request's trusted ownership facts.
    can("manage", "all");
  }

  return build();
}
