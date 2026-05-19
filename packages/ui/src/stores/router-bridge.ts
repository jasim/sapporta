import type { NavigateFunction } from "react-router-dom";

let _navigate: NavigateFunction | null = null;

export function setNavigate(fn: NavigateFunction) {
  _navigate = fn;
}

export function getNavigate(): NavigateFunction {
  if (!_navigate) {
    throw new Error("Router bridge not initialized — call setNavigate() first");
  }
  return _navigate;
}
