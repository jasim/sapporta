import type { ProtoRow } from "../types";

// Periodic data such as "balance brought forward / balance carried forward"
// shows up as bracket rows around contiguous groups. Consumers express that
// shape directly in the input today: a TreeNode with `kind: 'opening' |
// 'closing' | 'subtotal'` is emitted as the corresponding bracket ProtoRow
// by `buildDataRows`. This stage is the seam where future grouping logic
// would synthesize brackets from level options.
export function withOpeningClosing(rows: ProtoRow[]): ProtoRow[] {
  return rows;
}
