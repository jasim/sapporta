import { ApiError } from "../../platform/http";
import { fetchProjectInfo, fetchSchema } from "../api/schema";
import { useSchemaStore } from "../state/schema-store";

function apiErrorMessage(err: ApiError): string {
  if (err.body && typeof err.body === "object" && "error" in err.body) {
    const body = err.body as { error: string };
    return `${err.status}: ${body.error}`;
  }
  return `${err.status}: ${JSON.stringify(err.body)}`;
}

export async function loadSchema(opts?: { force?: boolean }) {
  const store = useSchemaStore.getState();
  if (!opts?.force && (store.loaded || store.loading)) return;

  store.setLoading(true);
  try {
    const res = await fetchSchema();
    store.setTables(res.tables);
  } catch (err) {
    if (err instanceof ApiError) {
      store.setError(apiErrorMessage(err));
    } else {
      store.setError(
        err instanceof Error ? err.message : "Failed to load schema",
      );
    }
  }
}

export async function loadProjectInfo() {
  const info = await fetchProjectInfo();
  useSchemaStore.getState().setProjectInfo(info);
}
