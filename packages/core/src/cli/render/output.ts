import { ErrorCode, OperationError } from "../../errors.js";
import { formatTable } from "../format.js";
import { ApiRequestError } from "../http-client.js";
import type { CliCommandResult } from "../commands/types.js";
import type {
  ApiTokenSource,
  ApiUrlSource,
  OutputFormat,
} from "../runtime-config.js";

export function renderCommandResult(
  result: CliCommandResult,
  format: OutputFormat,
): void {
  if (format === "json") {
    console.log(JSON.stringify(result.raw ?? resultToJsonEnvelope(result)));
    return;
  }

  if (result.message) {
    console.log(result.message);
  }

  if (!result.tableOutputHandled) {
    console.log(result.data.length > 0 ? formatTable(result.data) : "(empty)");
  }

  if (result.additionalOutput) {
    console.log(result.additionalOutput);
  }
}

const API_URL_SOURCES: Record<ApiUrlSource, string> = {
  flag: "API URL from --api-url",
  env: "API URL from SAPPORTA_API_URL",
  project: "API URL from SAPPORTA_API_PORT in this project's .env.development",
  default:
    "API URL from the built-in default — set SAPPORTA_API_URL or pass --api-url",
};

const API_TOKEN_SOURCES: Record<ApiTokenSource, string> = {
  flag: "API token from --api-token",
  env: "API token from SAPPORTA_API_TOKEN",
  none: "No API token sent — set SAPPORTA_API_TOKEN or pass --api-token",
};

interface FailedTarget {
  requestUrl: string;
  apiUrl: string;
  apiUrlSource: ApiUrlSource;
  apiTokenSource: ApiTokenSource;
}

export function renderCommandError(err: unknown, format: OutputFormat): never {
  const code = err instanceof OperationError ? err.code : ErrorCode.INTERNAL;
  const message = err instanceof Error ? err.message : String(err);
  const target = unconfirmedTarget(err);

  if (format === "json") {
    console.log(
      JSON.stringify({
        ok: false as const,
        error: message,
        code,
        ...(target ? { target } : {}),
      }),
    );
  } else {
    console.error(`Error: ${message}`);
    if (target) {
      console.error(`  Requested ${target.requestUrl}`);
      console.error(`  ${API_URL_SOURCES[target.apiUrlSource]}`);
      console.error(`  ${API_TOKEN_SOURCES[target.apiTokenSource]}`);
    }
  }

  process.exit(err instanceof OperationError ? 1 : 2);
}

/**
 * The deployment to name, when the failure leaves it in question.
 *
 * A failure the app answered for itself settles which server was reached, so
 * repeating the URL on every such error would bury the message.
 * Only an unconfirmed target will render any extra lines.
 */
function unconfirmedTarget(err: unknown): FailedTarget | undefined {
  if (!(err instanceof ApiRequestError) || err.targetConfirmed)
    return undefined;
  return {
    requestUrl: err.requestUrl,
    apiUrl: err.target.apiUrl,
    apiUrlSource: err.target.apiUrlSource,
    apiTokenSource: err.target.apiTokenSource,
  };
}

function resultToJsonEnvelope(result: CliCommandResult): unknown {
  return {
    ok: true,
    data: result.data,
    ...(result.message ||
    result.additionalOutput ||
    result.tableOutputHandled !== undefined
      ? {
          meta: {
            ...(result.message ? { message: result.message } : {}),
            ...(result.additionalOutput
              ? { additionalOutput: result.additionalOutput }
              : {}),
            ...(result.tableOutputHandled !== undefined
              ? { tableOutputHandled: result.tableOutputHandled }
              : {}),
          },
        }
      : {}),
  };
}
