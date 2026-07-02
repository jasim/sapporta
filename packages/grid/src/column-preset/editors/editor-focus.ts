import type { CellEditorStart } from "../../grid/types/schema";

type EditorInputControl = HTMLInputElement | HTMLTextAreaElement;

const TEXT_SELECTION_INPUT_TYPES = new Set([
  "",
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

// Apply grid edit-start semantics to input-like editors: a typed edit has
// already replaced the cell value with the typed seed, so the cursor belongs
// after that seed; explicit edit starts select the value for overwrite.
export function focusEditorInput(
  node: EditorInputControl,
  editStart: CellEditorStart,
): void {
  node.focus();

  if (editStart.trigger === "type") {
    if (supportsTextSelection(node)) {
      const end = node.value.length;
      node.setSelectionRange(end, end);
    }
    return;
  }

  node.select();
}

function supportsTextSelection(node: EditorInputControl): boolean {
  return (
    node instanceof HTMLTextAreaElement ||
    TEXT_SELECTION_INPUT_TYPES.has(node.type)
  );
}
