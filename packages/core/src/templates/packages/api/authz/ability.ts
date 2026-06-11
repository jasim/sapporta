import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { AppAbility, AppAuthFacts } from "./types.js";

/**
 * Defines what this requester may do.
 *
 * No rule means no access. Generated table routes ask for actions such as
 * `read`, `create`, and `export` on the table name. Custom routes can use
 * feature subjects such as `quote_publication` or `public_api_sample` and then
 * apply their own row predicates through `auth.rowSecurity`.
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
    // This allows owner actions; row security still limits database rows to the
    // request's trusted ownership facts.
    can("manage", "all");
  }

  return build();
}
