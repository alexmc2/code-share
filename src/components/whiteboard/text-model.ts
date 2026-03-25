import type { DrawOp, TextRun } from './types';

/** Style properties that can vary per run. */
export interface RunStyle {
  colour?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
}

/** Default style values used when a run field is undefined. */
export const DEFAULT_STYLE: Required<RunStyle> = {
  colour: '#000000',
  size: 24,
  bold: false,
  italic: false,
  fontFamily: 'sans-serif',
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Returns true if two runs have identical formatting (ignoring text). */
function sameStyle(a: TextRun, b: TextRun): boolean {
  return (
    (a.colour ?? undefined) === (b.colour ?? undefined) &&
    (a.size ?? undefined) === (b.size ?? undefined) &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    (a.fontFamily ?? undefined) === (b.fontFamily ?? undefined)
  );
}

/**
 * Merge adjacent runs with identical formatting and remove empty runs
 * (except preserve at least one run so the model is never empty).
 */
export function normaliseRuns(runs: TextRun[]): TextRun[] {
  if (runs.length === 0) return [{ text: '' }];

  const merged: TextRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && sameStyle(prev, run)) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }

  // Remove truly empty runs, but keep at least one
  const nonEmpty = merged.filter((r) => r.text.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [{ ...merged[0], text: '' }];
}

// ---------------------------------------------------------------------------
// Legacy conversion
// ---------------------------------------------------------------------------

/** Convert a legacy flat-field text DrawOp into a runs-based model. */
export function legacyOpToRuns(op: DrawOp): TextRun[] {
  const text = op.text ?? '';
  const run: TextRun = { text };
  if (op.colour) run.colour = op.colour;
  if (op.size) run.size = op.size;
  if (op.bold) run.bold = true;
  if (op.italic) run.italic = true;
  if (op.fontFamily) run.fontFamily = op.fontFamily;
  return [run];
}

/** Get runs from a DrawOp, converting legacy format if needed. */
export function getOpRuns(op: DrawOp): TextRun[] {
  if (op.runs && op.runs.length > 0) return op.runs;
  return legacyOpToRuns(op);
}

// ---------------------------------------------------------------------------
// Flat-text helpers
// ---------------------------------------------------------------------------

/** Concatenate all run texts into a single flat string. */
export function runsToPlainText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** Total character count across all runs. */
export function runsTotalLength(runs: TextRun[]): number {
  let n = 0;
  for (const r of runs) n += r.text.length;
  return n;
}

// ---------------------------------------------------------------------------
// Selection-based transforms
// ---------------------------------------------------------------------------

/**
 * Split runs at the given character offset, returning [before, after].
 * Offset is in flat-text space (0 = start of first run).
 */
export function splitRunsAt(
  runs: TextRun[],
  offset: number,
): [TextRun[], TextRun[]] {
  const before: TextRun[] = [];
  const after: TextRun[] = [];
  let pos = 0;

  for (const run of runs) {
    const runEnd = pos + run.text.length;
    if (runEnd <= offset) {
      before.push({ ...run });
    } else if (pos >= offset) {
      after.push({ ...run });
    } else {
      // Split within this run
      const splitIdx = offset - pos;
      before.push({ ...run, text: run.text.slice(0, splitIdx) });
      after.push({ ...run, text: run.text.slice(splitIdx) });
    }
    pos = runEnd;
  }

  return [before, after];
}

/**
 * Extract the runs covering [start, end) in flat-text space.
 * Returns [before, selected, after] — each normalised.
 */
export function extractRange(
  runs: TextRun[],
  start: number,
  end: number,
): [TextRun[], TextRun[], TextRun[]] {
  const [beforeAndSelected, after] = splitRunsAt(runs, end);
  const [before, selected] = splitRunsAt(beforeAndSelected, start);
  return [before, selected, after];
}

/**
 * Apply a partial style to runs in the range [start, end).
 * Returns the full updated run array (normalised).
 */
export function applyStyleToRange(
  runs: TextRun[],
  start: number,
  end: number,
  style: Partial<RunStyle>,
): TextRun[] {
  if (start >= end) return normaliseRuns(runs);

  const [before, selected, after] = extractRange(runs, start, end);

  const styled = selected.map((run) => ({
    ...run,
    ...style,
    // Clean up falsy toggles
    bold: style.bold !== undefined ? style.bold || undefined : run.bold,
    italic: style.italic !== undefined ? style.italic || undefined : run.italic,
  }));

  return normaliseRuns([...before, ...styled, ...after]);
}

/**
 * Get the resolved style at a caret position (used for toolbar state display).
 * If the caret is between runs, uses the run to the left (or the first run).
 */
export function getStyleAtOffset(
  runs: TextRun[],
  offset: number,
): Required<RunStyle> {
  let pos = 0;
  let lastRun: TextRun = runs[0] ?? {};

  for (const run of runs) {
    const runEnd = pos + run.text.length;
    if (offset <= runEnd) {
      // If offset is at the start of this run and there's a previous run,
      // prefer the previous run's style (typing continues previous style)
      if (offset === pos && pos > 0) {
        break; // lastRun is already the previous run
      }
      lastRun = run;
      break;
    }
    lastRun = run;
    pos = runEnd;
  }

  return {
    colour: lastRun.colour ?? DEFAULT_STYLE.colour,
    size: lastRun.size ?? DEFAULT_STYLE.size,
    bold: !!lastRun.bold,
    italic: !!lastRun.italic,
    fontFamily: lastRun.fontFamily ?? DEFAULT_STYLE.fontFamily,
  };
}

/**
 * Check whether all runs in [start, end) have a given boolean style set.
 * Used to decide whether a toggle should turn the style on or off.
 */
export function allInRangeHaveStyle(
  runs: TextRun[],
  start: number,
  end: number,
  key: 'bold' | 'italic',
): boolean {
  if (start >= end) return false;
  const [, selected] = extractRange(runs, start, end);
  return selected.length > 0 && selected.every((r) => !!r[key]);
}

/**
 * Insert text at the given offset, inheriting the style from the surrounding run.
 * Returns the updated runs (normalised).
 */
export function insertTextAt(
  runs: TextRun[],
  offset: number,
  text: string,
): TextRun[] {
  const [before, after] = splitRunsAt(runs, offset);
  // Inherit style from the run just before the insertion point
  const styleSource = before.length > 0 ? before[before.length - 1] : after[0];
  const newRun: TextRun = {
    text,
    colour: styleSource?.colour,
    size: styleSource?.size,
    bold: styleSource?.bold,
    italic: styleSource?.italic,
    fontFamily: styleSource?.fontFamily,
  };
  return normaliseRuns([...before, newRun, ...after]);
}

/**
 * Delete the range [start, end) from the runs.
 * Returns the updated runs (normalised).
 */
export function deleteRange(
  runs: TextRun[],
  start: number,
  end: number,
): TextRun[] {
  const [before, , after] = extractRange(runs, start, end);
  return normaliseRuns([...before, ...after]);
}
