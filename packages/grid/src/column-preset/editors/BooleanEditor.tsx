import { useEffect } from "react";
import type { CellEditorProps } from "../../grid/types/schema";

export function BooleanEditor(props: CellEditorProps) {
  useEffect(() => {
    props.commit(!Boolean(props.value));
  }, []);
  return null;
}
