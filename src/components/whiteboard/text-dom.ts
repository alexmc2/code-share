import type { TextRun } from './types';
import { normaliseRuns } from './text-model';

// ---------------------------------------------------------------------------
// Model → DOM
// ---------------------------------------------------------------------------

/**
 * Build DOM content for a contentEditable element from runs.
 * Structure: spans for styled text, <br> for newlines.
 * Trailing newline gets an extra <br> so the cursor can sit on the empty last line.
 */
export function renderRunsToDOM(
  container: HTMLElement,
  runs: TextRun[],
  defaultSize: number,
): void {
  container.innerHTML = '';

  // We render into a single flat sequence of spans and <br>s.
  // Each run may contain newlines, which we split into spans + <br>.
  for (const run of runs) {
    const parts = run.text.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        container.appendChild(document.createElement('br'));
      }
      const text = parts[p];
      if (text.length > 0) {
        const span = document.createElement('span');
        applyRunStyleToElement(span, run, defaultSize);
        span.textContent = text;
        container.appendChild(span);
      }
    }
  }

  // If the content ends with a newline (last run text ends with \n),
  // add a trailing <br> so the cursor can sit on the empty last line.
  const plainText = runs.map((r) => r.text).join('');
  if (plainText.endsWith('\n')) {
    container.appendChild(document.createElement('br'));
  }

  // If the container is completely empty, add a <br> so it's focusable
  if (container.childNodes.length === 0) {
    container.appendChild(document.createElement('br'));
  }
}

function applyRunStyleToElement(
  el: HTMLElement,
  run: TextRun,
  defaultSize: number,
): void {
  const size = run.size ?? defaultSize;
  el.style.fontSize = `${size}px`;
  el.style.lineHeight = '1.2';
  if (run.colour) el.style.color = run.colour;
  el.style.fontWeight = run.bold ? 'bold' : 'normal';
  el.style.fontStyle = run.italic ? 'italic' : 'normal';
  el.style.fontFamily = run.fontFamily || 'sans-serif';
  // Prevent browser from adding extra whitespace
  el.style.whiteSpace = 'pre-wrap';
}

// ---------------------------------------------------------------------------
// DOM → Model
// ---------------------------------------------------------------------------

/**
 * Extract TextRun[] from a contentEditable element's DOM.
 * Walks child nodes, treating <br> as '\n' and preserving effective text styles
 * from the containing DOM element.
 */
export interface RunDefaults {
  size: number;
  colour: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}

export function extractRunsFromDOM(
  container: HTMLElement,
  defaults: RunDefaults,
): TextRun[] {
  const runs: TextRun[] = [];

  function makeDefaultRun(text: string): TextRun {
    return {
      text,
      colour: defaults.colour,
      size: defaults.size,
      fontFamily: defaults.fontFamily || 'sans-serif',
      bold: defaults.bold || undefined,
      italic: defaults.italic || undefined,
    };
  }

  if (container.childNodes.length === 0) {
    return [makeDefaultRun('')];
  }

  if (
    container.childNodes.length === 1 &&
    container.firstChild instanceof HTMLBRElement &&
    !container.textContent
  ) {
    return [makeDefaultRun('')];
  }

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        // Preserve the effective style from the containing element so
        // contentEditable-generated tags like <strong>/<em> survive commit.
        const parent = node.parentElement;
        if (parent) {
          runs.push(extractRunFromElement(parent, text, defaults));
        } else {
          runs.push(makeDefaultRun(text));
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      runs.push(makeDefaultRun('\n'));
      return;
    }

    if (el.tagName === 'DIV' || el.tagName === 'P') {
      // Block elements inserted by browser on Enter
      // Add a newline before block content (unless it's the first child)
      const isFirst =
        el.parentElement === container && el === container.firstElementChild;
      if (!isFirst) {
        // Only add newline if the previous run doesn't already end with one
        const lastRun = runs[runs.length - 1];
        if (!lastRun || !lastRun.text.endsWith('\n')) {
          runs.push(makeDefaultRun('\n'));
        }
      }
      // Process children of the block
      for (const child of Array.from(el.childNodes)) {
        processNode(child);
      }
      return;
    }

    if (el.tagName === 'SPAN') {
      // Process direct text children of the span.
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent ?? '';
          if (text.length > 0) {
            runs.push(extractRunFromElement(el, text, defaults));
          }
        } else {
          processNode(child);
        }
      }
      return;
    }

    // For any other element, recurse
    for (const child of Array.from(el.childNodes)) {
      processNode(child);
    }
  }

  for (const child of Array.from(container.childNodes)) {
    processNode(child);
  }

  // Strip trailing newline that's just the sentinel <br>
  // (we add an extra <br> at the end in renderRunsToDOM for cursor positioning)
  if (runs.length > 0) {
    const lastRun = runs[runs.length - 1];
    if (lastRun.text === '\n' && container.lastElementChild?.tagName === 'BR') {
      // Check if this is our sentinel: the <br> right before the final <br>
      const brs = container.querySelectorAll('br');
      if (brs.length >= 2) {
        const secondToLast = brs[brs.length - 2];
        const lastNode = container.lastChild;
        if (
          lastNode instanceof HTMLBRElement &&
          secondToLast !== lastNode
        ) {
          // The last <br> is the sentinel — remove the trailing \n
          runs.pop();
        }
      }
    }
  }

  return normaliseRuns(runs);
}

function extractRunFromElement(
  el: HTMLElement,
  text: string,
  defaults: RunDefaults,
): TextRun {
  const style = window.getComputedStyle(el);
  const run: TextRun = { text };

  // Font size
  const fontSize = parseFloat(style.fontSize);
  run.size =
    Number.isFinite(fontSize) && fontSize > 0 ? fontSize : defaults.size;

  // Colour
  const colour = style.color;
  if (colour) {
    run.colour = rgbToHex(colour) || defaults.colour;
  } else {
    run.colour = defaults.colour;
  }

  // Bold
  run.bold =
    style.fontWeight === 'bold' ||
    parseInt(style.fontWeight, 10) >= 700 ||
    undefined;

  // Italic
  run.italic = style.fontStyle === 'italic' || undefined;

  // Font family
  const family = style.fontFamily?.replace(/['"]/g, '').trim();
  run.fontFamily = family || defaults.fontFamily || 'sans-serif';

  return run;
}

/**
 * Convert CSS color value (potentially rgb(r,g,b)) to hex #rrggbb.
 */
function rgbToHex(color: string): string | null {
  if (color.startsWith('#')) return color;
  const match = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (!match) return null;
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return (
    '#' +
    [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
}
