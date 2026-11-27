// The dev feedback bundle (docs/specs/dev-feedback-overlay.md): what the overlay sends and how the
// dev server writes it down. Pure, so both the browser overlay and the Vite plugin import it.

export type Point = [number, number];

export interface FeedbackBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FeedbackSource {
  file: string;
  line: number | null;
  column: number | null;
}

export interface FeedbackFrame {
  name: string | null;
  source: FeedbackSource | null;
}

export interface FeedbackPin {
  n: number;
  kind: "element";
  comment: string;
  selector: string | null;
  component: string | null;
  source: FeedbackSource | null;
  /** The owner stack, innermost first. */
  stack: FeedbackFrame[];
  tag: string;
  text: string;
  box: FeedbackBox;
  styles: string;
}

export interface FeedbackDrawing {
  n: number;
  kind: "stroke" | "arrow" | "rect";
  comment: string;
  /** A stroke's points; an arrow's start and end; a rectangle's two opposite corners. */
  points: Point[];
}

export interface FeedbackContext {
  at: string;
  url: string;
  title: string;
  theme: "light" | "dark";
  viewport: { width: number; height: number; dpr: number };
  windowRole: string;
  selectedTabs: string[];
  focused: string | null;
}

export interface FeedbackPayload {
  context: FeedbackContext;
  pins: FeedbackPin[];
  drawings: FeedbackDrawing[];
}

export interface FeedbackRequest {
  payload: FeedbackPayload;
  /** `data:image/png;base64,...` */
  screenshot: string;
}

export interface FeedbackResponse {
  dir: string;
  summary: string;
}

export const FEEDBACK_ENDPOINT = "/__zomfy-feedback";

/** A folder name that sorts by time and is valid on every OS: `2026-11-27T09-30-12-345Z`. */
export function bundleFolderName(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

const posix = (path: string) => path.replace(/\\/g, "/");

/**
 * Turns a source location as the browser sees it (`http://localhost:1433/src/App.tsx?t=1`,
 * `/src/App.tsx`, `/@fs/C:/repo/x.tsx`, an absolute path) into a path relative to the repository.
 */
export function repoRelativePath(file: string, viteRoot: string, repoRoot: string): string {
  let path = file.replace(/^file:\/\//i, "").replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {}
  path = posix(path);
  const fromFs = path.startsWith("/@fs/");
  if (fromFs) path = path.slice("/@fs".length);
  path = path.replace(/^\/(?=[a-z]:\/)/i, "");
  const vite = posix(viteRoot).replace(/\/$/, "");
  const absolute = fromFs || /^[a-z]:\//i.test(path) || path.toLowerCase().startsWith(`${vite.toLowerCase()}/`);
  if (!absolute && path.startsWith("/")) path = `${vite}${path}`;
  const root = posix(repoRoot).replace(/\/$/, "");
  return path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : path;
}

/** Rewrites every source path in the payload relative to the repository. */
export function withRepoPaths(payload: FeedbackPayload, viteRoot: string, repoRoot: string): FeedbackPayload {
  const fix = (source: FeedbackSource | null): FeedbackSource | null => (source ? { ...source, file: repoRelativePath(source.file, viteRoot, repoRoot) } : null);
  return {
    ...payload,
    pins: payload.pins.map((pin) => ({ ...pin, source: fix(pin.source), stack: pin.stack.map((frame) => ({ ...frame, source: fix(frame.source) })) })),
  };
}

export function formatSource(source: FeedbackSource | null): string | null {
  if (!source) return null;
  return [source.file, source.line, source.column].filter((part) => part !== null && part !== undefined).join(":");
}

const round = (value: number) => Math.round(value);
const point = ([x, y]: Point) => `(${round(x)}, ${round(y)})`;

function drawingShape(drawing: FeedbackDrawing): string {
  const first = drawing.points[0] ?? [0, 0];
  const last = drawing.points[drawing.points.length - 1] ?? first;
  if (drawing.kind === "arrow") return `arrow from ${point(first)} to ${point(last)}`;
  if (drawing.kind === "rect") {
    const x = Math.min(first[0], last[0]);
    const y = Math.min(first[1], last[1]);
    return `rectangle at ${point([x, y])}, ${round(Math.abs(last[0] - first[0]))}×${round(Math.abs(last[1] - first[1]))}`;
  }
  return `freehand stroke from ${point(first)} to ${point(last)} (${drawing.points.length} points)`;
}

function boxText(box: FeedbackBox): string {
  return `${round(box.width)}×${round(box.height)} at (${round(box.x)}, ${round(box.y)})`;
}

const quote = (text: string) => (text ? `"${text.replace(/\s+/g, " ").trim()}"` : "(none)");

/** The marks in number order, pins and drawings together. */
function marksInOrder(payload: FeedbackPayload): Array<FeedbackPin | FeedbackDrawing> {
  return [...payload.pins, ...payload.drawings].sort((a, b) => a.n - b.n);
}

export function buildFeedbackMarkdown(payload: FeedbackPayload, dir: string): string {
  const { context } = payload;
  const lines: string[] = [
    `# UI feedback ${context.at}`,
    "",
    `Screenshot: \`${posix(dir)}/screenshot.png\` (viewport ${context.viewport.width}×${context.viewport.height} CSS px at ${context.viewport.dpr}× scale; the numbered marks below are drawn on it, coordinates are CSS px from the viewport's top-left).`,
    "",
    "## Page",
    "",
    `- URL: ${context.url}`,
    `- Title: ${context.title || "(none)"}`,
    `- Window: ${context.windowRole}, theme ${context.theme}`,
    `- Selected tabs: ${context.selectedTabs.length ? context.selectedTabs.map((tab) => `"${tab}"`).join(", ") : "(none)"}`,
    `- Focused: ${context.focused ? `\`${context.focused}\`` : "(nothing)"}`,
  ];
  for (const mark of marksInOrder(payload)) {
    lines.push("");
    if (mark.kind === "element") {
      lines.push(`## ${mark.n}. Element: ${mark.comment || "(no comment)"}`, "");
      lines.push(`- Component: ${mark.component ? `\`${mark.component}\`` : "(unknown)"}${mark.source ? ` at \`${formatSource(mark.source)}\`` : ""}`);
      const owners = mark.stack.filter((frame) => frame.name || frame.source).slice(0, 8);
      if (owners.length) lines.push(`- Owners: ${owners.map((frame) => `${frame.name ?? "?"}${frame.source ? ` (\`${formatSource(frame.source)}\`)` : ""}`).join(" < ")}`);
      lines.push(`- Selector: ${mark.selector ? `\`${mark.selector}\`` : "(none)"}`);
      lines.push(`- Tag: \`<${mark.tag}>\`, box ${boxText(mark.box)}`);
      lines.push(`- Text: ${quote(mark.text)}`);
      if (mark.styles.trim()) lines.push("- Styles:", "", "```css", mark.styles.trim().slice(0, 2000), "```");
    } else {
      lines.push(`## ${mark.n}. Drawing: ${mark.comment || "(no comment)"}`, "");
      lines.push(`- Shape: ${drawingShape(mark)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The short Markdown the overlay puts on the clipboard, to paste into the chat with the lead agent. */
export function buildFeedbackSummary(payload: FeedbackPayload, dir: string): string {
  const lines = [`UI feedback: \`${posix(dir)}\` (read \`feedback.md\` and look at \`screenshot.png\`)`];
  for (const mark of marksInOrder(payload)) {
    const where =
      mark.kind === "element"
        ? [mark.component ? `\`${mark.component}\`` : `\`<${mark.tag}>\``, formatSource(mark.source) ? `\`${formatSource(mark.source)}\`` : null].filter(Boolean).join(" ")
        : drawingShape(mark);
    lines.push(`${mark.n}. ${where}: ${mark.comment || "(no comment)"}`);
  }
  return lines.join("\n");
}
