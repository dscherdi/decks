export type DiffOpType = "equal" | "add" | "remove";

export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/**
 * Lightweight word-level diff (LCS over whitespace-delimited tokens). No
 * external dependency. Whitespace is kept as part of tokens so reconstructed
 * text round-trips. Used to render before/after field proposals.
 */
export function wordDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // LCS length table.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(ops, "equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(ops, "remove", a[i]);
      i++;
    } else {
      push(ops, "add", b[j]);
      j++;
    }
  }
  while (i < n) push(ops, "remove", a[i++]);
  while (j < m) push(ops, "add", b[j++]);
  return ops;
}

function push(ops: DiffOp[], type: DiffOpType, text: string): void {
  const last = ops[ops.length - 1];
  if (last && last.type === type) {
    last.text += text;
  } else {
    ops.push({ type, text });
  }
}

/** Split into alternating word / whitespace tokens, preserving both. */
function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}
