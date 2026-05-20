import {
  loadProjectInfo,
  loadReports,
  loadSchema,
} from "@/schema-catalog/actions/metadata";

export function loadAdminMetadata(): void {
  void loadSchema();
  void loadReports();
  void loadProjectInfo();
}

export { loadProjectInfo, loadReports, loadSchema };
