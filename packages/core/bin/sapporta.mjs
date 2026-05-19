#!/usr/bin/env node
// Entry point for the `sapporta` CLI.
//
// For local monorepo development, set SAPPORTA_DEV_MODE_PACKAGE_ROOT to the
// monorepo root so create-project writes link: specs instead of version pins.

await import("@sapporta/server/cli");
