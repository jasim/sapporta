import { ApiError } from "@/platform/http";
import { fetchReports } from "@/schema-catalog/api/report-metadata";
import { fetchProjectInfo, fetchSchema } from "@/schema-catalog/api/schema";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";

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

export async function loadReports() {
  try {
    const res = await fetchReports();
    useSchemaStore.getState().setReports(res.reports);
  } catch {
    // Reports endpoint may not exist - non-fatal for table-only projects.
  }
}

export async function loadProjectInfo() {
  const info = await fetchProjectInfo();
  useSchemaStore.getState().setSlug(info.slug);
}
