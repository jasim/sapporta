import {
  loadProjectInfo,
  loadSchema,
} from "../../schema-catalog/actions/metadata";

export function loadAdminMetadata(): void {
  void loadSchema();
  void loadProjectInfo();
}

export { loadProjectInfo, loadSchema };
