// Which screen ("view") the person is marking (docs/specs/dev-feedback-overlay.md): marks made on
// one view share a screenshot; moving to another screen, or opening a dialog, menu or popover,
// starts another. Nothing here touches the DOM until called, so tests can import `sameView`.
import type { FeedbackBox } from "./bundle";

/** A coarse fingerprint of what is on screen: the app's topmost element at a grid of points, and the open layers. */
export interface ViewPrint {
  url: string;
  cells: number[];
  /** Open dialogs, menus, listboxes and popovers, by element. */
  layers: number[];
}

const COLUMNS = 8;
const ROWS = 6;
/** The share of grid points that must show the same element for two prints to be one view. */
const SAME_CELLS = 0.75;
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

const ids = new WeakMap<Element, number>();
let nextId = 1;
function idOf(element: Element): number {
  let id = ids.get(element);
  if (!id) {
    id = nextId++;
    ids.set(element, id);
  }
  return id;
}

/**
 * Runs `test` with the body's `pointer-events: none` (set by an open Radix modal) lifted, so
 * `elementsFromPoint` sees everything that is on screen.
 */
export function withPointerEvents<T>(test: () => T): T {
  const body = document.body;
  const blocked = getComputedStyle(body).pointerEvents === "none";
  const inline = body.style.pointerEvents;
  if (blocked) body.style.pointerEvents = "auto";
  try {
    return test();
  } finally {
    if (blocked) body.style.pointerEvents = inline;
  }
}

export function viewPrint(host: Element): ViewPrint {
  return withPointerEvents(() => {
    const cells: number[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const x = ((column + 0.5) * innerWidth) / COLUMNS;
        const y = ((row + 0.5) * innerHeight) / ROWS;
        const element = document.elementsFromPoint(x, y).find((candidate) => !host.contains(candidate));
        cells.push(element ? idOf(element) : 0);
      }
    }
    const layers = [...document.querySelectorAll(LAYERS)].filter((layer) => !host.contains(layer) && onScreen(layer, host)).map(idOf).sort((a, b) => a - b);
    return { url: location.href, cells, layers };
  });
}

/** Whether two prints are the same screen: same URL, same open layers, and mostly the same elements. */
export function sameView(a: ViewPrint, b: ViewPrint): boolean {
  if (a.url !== b.url || a.cells.length !== b.cells.length || a.layers.join() !== b.layers.join()) return false;
  const same = a.cells.filter((cell, index) => cell === b.cells[index]).length;
  return same >= a.cells.length * SAME_CELLS;
}

/**
 * Whether an element can be seen: on the page, inside the viewport, not hidden, and not covered by
 * another screen (a page the app shows over it keeps it in the DOM). A hover-only button counts.
 */
export function onScreen(element: Element, host?: Element): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
  if (typeof element.checkVisibility === "function" && !element.checkVisibility({ visibilityProperty: true })) return false;
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, innerWidth);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, innerHeight);
  const points: Array<[number, number]> = [
    [(left + right) / 2, (top + bottom) / 2],
    [left + (right - left) * 0.2, top + (bottom - top) * 0.2],
    [left + (right - left) * 0.8, top + (bottom - top) * 0.2],
    [left + (right - left) * 0.2, top + (bottom - top) * 0.8],
    [left + (right - left) * 0.8, top + (bottom - top) * 0.8],
  ];
  return withPointerEvents(() =>
    points.some(([x, y]) => {
      const hit = document.elementsFromPoint(x, y).find((candidate) => !host?.contains(candidate));
      // An element with pointer-events: none of its own is skipped by the hit test, which then lands on its parent.
      return !!hit && hit !== document.body && hit !== document.documentElement && (element.contains(hit) || hit.contains(element));
    }),
  );
}

/** A PNG of `box` (CSS px) and a margin around it, cut from a viewport screenshot. */
export async function cropImage(screenshot: string, box: FeedbackBox, viewportWidth: number, margin = 24): Promise<string> {
  const image = new Image();
  image.src = screenshot;
  await image.decode();
  const scale = image.naturalWidth / viewportWidth;
  const x = Math.max(0, Math.floor((box.x - margin) * scale));
  const y = Math.max(0, Math.floor((box.y - margin) * scale));
  const width = Math.min(image.naturalWidth - x, Math.ceil((box.width + 2 * margin) * scale));
  const height = Math.min(image.naturalHeight - y, Math.ceil((box.height + 2 * margin) * scale));
  if (width <= 0 || height <= 0) throw new Error("The element is outside the screenshot.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}
