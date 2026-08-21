import type { CellEditorProps } from "../../core/types/schema";
import { presetRuntime } from "../preset";

export function parseForCommit(props: CellEditorProps, raw: string): unknown {
  const runtime = presetRuntime(props.column);
  return runtime?.valueCodec.parse ? runtime.valueCodec.parse(raw, props) : raw;
}
