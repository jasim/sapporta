#!/usr/bin/env node
// Entry point for the `sapporta` CLI.
//
// To use packages from a monorepo checkout, set SAPPORTA_PACKAGE_ROOT to the
// monorepo root so create-project writes link: specs instead of version pins.

await import("@sapporta/server/cli");
