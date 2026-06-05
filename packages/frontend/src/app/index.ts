// Startup-safe exports only. Heavy admin routes live under routes/* subpaths.
export { loadAdminMetadata } from "./actions/boot";
export { navigateToReport, navigateToTable } from "./actions/navigation";
export { BootLoader } from "./boot/BootLoader";
export { HomeRedirect } from "./boot/HomeRedirect";
export { NotFoundView } from "./boot/NotFoundView";
export { getNavigate, setNavigate } from "./router/router-bridge";
export { AppShell, type AppShellProps } from "@/shell/components/AppShell";
