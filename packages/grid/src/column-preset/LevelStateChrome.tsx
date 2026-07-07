import type { GridPath } from "../grid/types/identity";
import { decomposePath } from "../grid/types/identity";
import { shouldRenderEmpty } from "../grid/react/EmptyLevel";
import { levelStatusBandModel } from "../grid/react/LevelStatusBand";
import {
  useGridRuntime,
  useLevelSourceState,
  usePhantoms,
} from "../grid/react/GridRuntimeProvider";
import styles from "./sapporta-preset.module.css";

export function PresetLevelStatusBand({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  const state = useLevelSourceState(path);
  const levelName = runtime.schemaAt(path).name;
  const model = levelStatusBandModel(state, levelName);
  if (!model) return null;
  const depth = gridPathDepth(path);

  if (model.kind === "loading") {
    return (
      <div
        className={styles.levelStatus}
        data-grid-depth={depth}
        data-grid-part="level-status"
        data-grid-path={path}
        data-grid-status="loading"
        role="status"
        aria-live="polite"
      >
        <span className={styles.levelStatusText}>{model.text}</span>
      </div>
    );
  }

  return (
    <div
      className={styles.levelStatus}
      data-grid-depth={depth}
      data-grid-part="level-status"
      data-grid-path={path}
      data-grid-status="error"
      role="alert"
    >
      <span className={styles.levelStatusText}>{model.text}</span>
      <button
        className={styles.levelStatusRetry}
        type="button"
        data-grid-part="level-status-retry"
        onClick={() => {
          void runtime.sourceFor(path).query?.refetch?.();
        }}
      >
        Retry
      </button>
    </div>
  );
}

export function PresetEmptyLevel({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  const state = useLevelSourceState(path);
  const phantoms = usePhantoms(path);
  if (!shouldRenderEmpty(state, phantoms.length)) return null;
  const levelName = runtime.schemaAt(path).name;

  return (
    <div
      className={styles.levelEmpty}
      data-grid-depth={gridPathDepth(path)}
      data-grid-part="level-empty"
      data-grid-path={path}
      role="status"
      aria-live="polite"
    >
      No {levelName}.
    </div>
  );
}

function gridPathDepth(path: GridPath): number {
  return decomposePath(path).edges.length;
}
