import { ErrorCode, OperationError } from "../../introspect/types.js";

export type InitSetupStep =
  | "npm-registry-preflight"
  | "scaffold-write"
  | "pnpm-install"
  | "sqlite-native-bindings"
  | "migration-generate"
  | "migration-apply"
  | "atomic-publish";

export class InitSetupError extends OperationError {
  constructor(
    public readonly step: InitSetupStep,
    message: string,
    code: string = ErrorCode.INIT_SETUP_FAILED,
  ) {
    super(message, code);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
