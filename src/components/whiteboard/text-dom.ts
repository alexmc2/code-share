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
 * Walks child nodes, treating <br> as '\n' and <span> as styled runs.
 * Text nodes outside spans inherit defaults.
 */
export function extractRunsFromDOM(
  container: HTMLElement,
  defaultSize: number,
  defaultColour: string,
  defaultFontFamily: string = 'sans-serif',
): TextRun[] {
  const runs: TextRun[] = [];

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        // Inherit style from parent span if available
        const parent = node.parentElement;
        if (parent && parent !== container && parent.tagName === 'SPAN') {
          runs.push(extractRunFromSpan(parent, text, defaultSize, defaultColour));
        } else {
          runs.push({
            text,
            colour: defaultColour,
            size: defaultSize,
            fontFamily: defaultFontFamily,
          });
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      runs.push({ text: '\n', colour: defaultColour, size: defaultSize, fontFamily: defaultFontFamily });
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
          runs.push({ text: '\n', colour: defaultColour, size: defaultSize, fontFamily: defaultFontFamily });
        }
      }
      // Process children of the block
      for (const child of Array.from(el.childNodes)) {
        processNode(child);
      }
      return;
    }

    if (el.tagName === 'SPAN') {
      // Process direct text children of the span
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent ?? '';
          if (text.length > 0) {
            runs.push(extractRunFromSpan(el, text, defaultSize, defaultColour));
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

function extractRunFromSpan(
  span: HTMLElement,
  text: string,
  defaultSize: number,
  defaultColour: string,
): TextRun {
  const style = span.style;
  const run: TextRun = { text };

  // Font size
  const fontSize = parseFloat(style.fontSize);
  run.size = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : defaultSize;

  // Colour
  const colour = style.color;
  if (colour) {
    run.colour = rgbToHex(colour) || defaultColour;
  } else {
    run.colour = defaultColour;
  }

  // Bold
  run.bold = style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700 || undefined;

  // Italic
  run.italic = style.fontStyle === 'italic' || undefined;

  // Font family
  const family = style.fontFamily?.replace(/['"]/g, '').trim();
  if (family) run.fontFamily = family;

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
