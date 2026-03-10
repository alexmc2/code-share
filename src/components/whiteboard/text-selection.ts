/**
 * Selection save/restore for contentEditable elements.
 *
 * Selections are stored as flat character offsets into the combined text content
 * of the container (text nodes contribute their length, <br> contributes 1 for '\n').
 * This makes them resilient to DOM restructuring (e.g., after we re-render the model to DOM).
 */

export interface FlatSelection {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Read the current browser Selection relative to a container element and
 * return it as flat character offsets, or null if there's no selection in
 * the container.
 */
export function saveFlatSelection(
  container: HTMLElement,
): FlatSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer)) return null;

  const start = nodeOffsetToFlat(container, range.startContainer, range.startOffset);
  const end = nodeOffsetToFlat(container, range.endContainer, range.endOffset);

  if (start === null || end === null) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore a flat selection in a container element.
 */
export function restoreFlatSelection(
  container: HTMLElement,
  flatSel: FlatSelection,
): void {
  const start = flatToNodeOffset(container, flatSel.start);
  const end = flatToNodeOffset(container, flatSel.end);
  if (!start || !end) return;

  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------------------------------------------------------------------
// Internal: DOM (node, offset) → flat offset
// ---------------------------------------------------------------------------

/** Count characters in a subtree. Text nodes = text length, <br> = 1. */
function charCount(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) {
    return (n.textContent ?? '').length;
  }
  if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
    return 1;
  }
  let count = 0;
  for (const child of Array.from(n.childNodes)) {
    count += charCount(child);
  }
  return count;
}

/**
 * Convert a DOM (node, offset) pair to a flat character offset within a container.
 *
 * For text nodes, offset is a character index within the text.
 * For element nodes, offset is a child index.
 */
function nodeOffsetToFlat(
  container: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  // Count all chars before `node` within the container
  let pos = charsBeforeNode(container, node);
  if (pos === null) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    // Offset is a character position within the text node
    pos += offset;
  } else {
    // Offset is a child index — count chars in children [0, offset)
    for (let i = 0; i < offset && i < node.childNodes.length; i++) {
      pos += charCount(node.childNodes[i]);
    }
  }

  return pos;
}

/**
 * Count all characters that appear before a given node within a container.
 * Returns null if the node is not found in the container.
 */
function charsBeforeNode(container: HTMLElement, target: Node): number | null {
  if (target === container) return 0;

  let pos = 0;

  function walk(n: Node): boolean {
    if (n === target) return true;

    if (n.nodeType === Node.TEXT_NODE) {
      pos += (n.textContent ?? '').length;
      return false;
    }

    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
      pos += 1;
      return false;
    }

    for (const child of Array.from(n.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  }

  return walk(container) ? pos : null;
}

// ---------------------------------------------------------------------------
// Internal: flat offset → DOM (node, offset)
// ---------------------------------------------------------------------------

/**
 * Resolve a flat character offset back to a (node, offset) pair.
 */
function flatToNodeOffset(
  container: HTMLElement,
  targetOffset: number,
): { node: Node; offset: number } | null {
  let remaining = targetOffset;

  function walk(n: Node): { node: Node; offset: number } | null {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? '').length;
      if (remaining <= len) {
        return { node: n, offset: remaining };
      }
      remaining -= len;
      return null;
    }

    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
      if (remaining === 0) {
        // Position before this <br>
        const parent = n.parentNode!;
        const idx = Array.from(parent.childNodes).indexOf(n as ChildNode);
        return { node: parent, offset: idx };
      }
      remaining -= 1;
      return null;
    }

    if (n.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(n.childNodes)) {
        const result = walk(child);
        if (result) return result;
      }
    }

    return null;
  }

  const result = walk(container);
  if (result) return result;

  // If we exhausted the tree, place at the end
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  while (walker.nextNode()) {
    lastText = walker.currentNode as Text;
  }
  if (lastText) {
    return { node: lastText, offset: lastText.length };
  }
  return { node: container, offset: container.childNodes.length };
}
