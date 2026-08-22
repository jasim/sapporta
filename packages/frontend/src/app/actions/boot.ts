/**
 * The metadata loaders decode `/api/meta/*` against the shared table schema,
 * so they carry the schema decoders and the validation library with them. Boot
 * only reaches for them once a session settles, so they are loaded on demand
 * and stay out of the first script the browser runs.
 */
function metadataActions() {
  return import("../../schema-catalog/actions/metadata");
}

/**
 * Start fetching the metadata module while the session request is still in
 * flight, so the schema request does not wait on it afterwards.
 */
export function prefetchAdminMetadata(): void {
  void metadataActions().catch(() => undefined);
}

export function loadAdminMetadata(): void {
  void metadataActions().then(({ loadProjectInfo, loadSchema }) => {
    void loadSchema();
    void loadProjectInfo();
  });
}
