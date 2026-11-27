// The dev feedback overlay (docs/specs/dev-feedback-overlay.md): pin elements and draw over the
// page, each with a comment, then send one bundle the dev server saves for agents. Loaded only by
// the dev server (see install.tsx), never in a production build.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, MessageSquarePlus, MousePointer2, MoveUpRight, Pencil, Send, Square, Trash2, X } from "lucide-react";
import { getStroke } from "perfect-freehand";
import { domToPng } from "modern-screenshot";
import { getElementAtPoint, getElementContext, getElementSelector, isElementGrabbable, type ReactGrabElementContext } from "react-grab/primitives";
import { WINDOW_ROLE } from "@/lib/window-role";
import {
  FEEDBACK_ENDPOINT,
  type FeedbackBox,
  type FeedbackContext,
  type FeedbackDrawing,
  type FeedbackFrame,
  type FeedbackPin,
  type FeedbackResponse,
  type FeedbackSource,
  type Point,
} from "./bundle";

type Tool = "select" | "stroke" | "arrow" | "rect";
type SendState = { phase: "idle" | "sending" | "sent" } | { phase: "failed"; error: string };

interface ElementMark {
  n: number;
  kind: "element";
  element: Element;
  /** Where the element was when pinned, for when it leaves the page. */
  box: FeedbackBox;
  context: Promise<ReactGrabElementContext | null>;
  comment: string;
}
interface DrawingMark {
  n: number;
  kind: FeedbackDrawing["kind"];
  points: Point[];
  comment: string;
}
type Mark = ElementMark | DrawingMark;

/** The one colour that means "feedback": the frame, the marks and the active tool. */
const INK = "#ec4899";
/** Marked on everything that stays out of the screenshot. */
const CHROME = { "data-feedback-chrome": "" } as const;

const boxOf = (element: Element): FeedbackBox => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

const sourceOf = (file: string | null | undefined, line?: number | null, column?: number | null): FeedbackSource | null =>
  file ? { file, line: line ?? null, column: column ?? null } : null;

interface FiberLike {
  type?: unknown;
  return?: FiberLike | null;
  _debugStack?: { stack?: string } | null;
}

/** React keeps the fiber on the DOM node; its parents lead to the components that rendered it. */
function fiberOf(element: Element): FiberLike | undefined {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  return key ? (element as unknown as Record<string, FiberLike | undefined>)[key] : undefined;
}

/**
 * The module paths behind the element's owner stack, keyed by `<file name>:<line>:<column>` as
 * they appear in the served code. Vite's source maps name a source by its file name alone, so
 * react-grab's frames say `ChatList.tsx`; React's own `_debugStack` still has the module's URL.
 */
function modulePaths(element: Element): Map<string, string> {
  const paths = new Map<string, string>();
  for (let fiber = fiberOf(element); fiber; fiber = fiber.return ?? undefined) {
    for (const match of (fiber._debugStack?.stack ?? "").matchAll(/(https?:\/\/[^\s()]+?):(\d+):(\d+)/g)) {
      const path = match[1]!.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
      const name = path.slice(path.lastIndexOf("/") + 1);
      paths.set(`${name}:${match[2]}:${match[3]}`, path);
      if (!paths.has(name)) paths.set(name, path);
      else if (paths.get(name) !== path) paths.set(name, "");
    }
  }
  return paths;
}

/** A frame's file with its directory, when react-grab gave the file name alone. */
function framePath(frame: { fileName?: string; source?: string }, paths: Map<string, string>): string | undefined {
  const file = frame.fileName;
  if (!file || file.includes("/")) return file;
  const at = /\(([^()]+):(\d+):(\d+)\)\s*$/.exec(frame.source ?? "");
  return (at && paths.get(`${at[1]}:${at[2]}:${at[3]}`)) || paths.get(file) || file;
}

function componentName(element: Element): string | null {
  let fiber = fiberOf(element);
  while (fiber) {
    const type = fiber.type as { displayName?: string; name?: string } | string | undefined;
    if (typeof type === "function" || (type && typeof type === "object")) {
      const name = (type as { displayName?: string; name?: string }).displayName ?? (type as { name?: string }).name;
      if (name) return name;
    }
    fiber = fiber.return ?? undefined;
  }
  return null;
}

/** Where a mark's number sits. */
function anchorOf(mark: Mark): Point {
  if (mark.kind === "element") return [mark.box.x, mark.box.y];
  // At the start, so an arrow's head and a stroke's end stay visible.
  const first = mark.points[0]!;
  const last = mark.points[mark.points.length - 1]!;
  if (mark.kind === "rect") return [Math.min(first[0], last[0]), Math.min(first[1], last[1])];
  return first;
}

/** The area a mark covers, which its comment box keeps clear of. */
function extentOf(mark: Mark): FeedbackBox {
  if (mark.kind === "element") return mark.box;
  const xs = mark.points.map(([x]) => x);
  const ys = mark.points.map(([, y]) => y);
  const pad = 8;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + 2 * pad, height: Math.max(...ys) - Math.min(...ys) + 2 * pad };
}

/** A spot for a box of `size` beside `area` that stays on screen; next to the mark's number when none fits. */
function placeBeside(area: FeedbackBox, size: { width: number; height: number }, element: boolean, [x, y]: Point): { left: number; top: number } {
  const gap = 10;
  const margin = 8;
  const right = { left: area.x + area.width + gap, top: area.y };
  const left = { left: area.x - gap - size.width, top: area.y };
  const below = { left: area.x, top: area.y + area.height + gap };
  const above = { left: area.x, top: area.y - gap - size.height };
  const fits = (spot: { left: number; top: number }) =>
    spot.left >= margin && spot.top >= margin && spot.left + size.width <= innerWidth - margin && spot.top + size.height <= innerHeight - margin;
  const clamp = (spot: { left: number; top: number }) => ({
    left: Math.min(Math.max(margin, spot.left), innerWidth - size.width - margin),
    top: Math.min(Math.max(margin, spot.top), innerHeight - size.height - margin),
  });
  const spots = element ? [below, above, right, left] : [right, left, below, above];
  const spot = spots.find(fits);
  return spot ? spot : clamp({ left: x + 16, top: y - 4 });
}

function strokePath(points: Point[]): string {
  const outline = getStroke(points, { size: 5, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
  if (outline.length < 2) return "";
  const [head, ...rest] = outline;
  const d = [`M ${head![0]} ${head![1]} Q`];
  for (let i = 0; i < rest.length; i++) {
    const [x0, y0] = rest[i]!;
    const [x1, y1] = rest[(i + 1) % rest.length]!;
    d.push(`${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`);
  }
  return `${d.join(" ")} Z`;
}

function Shape({ kind, points }: { kind: DrawingMark["kind"]; points: Point[] }) {
  if (points.length < 2) return null;
  const [x1, y1] = points[0]!;
  const [x2, y2] = points[points.length - 1]!;
  if (kind === "stroke") return <path d={strokePath(points)} fill={INK} />;
  if (kind === "rect") {
    return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={4} fill={`${INK}14`} stroke={INK} strokeWidth={3} />;
  }
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 14;
  const wing = (side: number): string => `${x2 - head * Math.cos(angle + side * 0.45)},${y2 - head * Math.sin(angle + side * 0.45)}`;
  return (
    <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1={x1} y1={y1} x2={x2 - (head / 2) * Math.cos(angle)} y2={y2 - (head / 2) * Math.sin(angle)} />
      <polygon points={`${x2},${y2} ${wing(1)} ${wing(-1)}`} fill={INK} />
    </g>
  );
}

function scrollUnder(x: number, y: number, dx: number, dy: number): void {
  let element: Element | null = getElementAtPoint(x, y);
  while (element) {
    const style = getComputedStyle(element);
    const canY = dy !== 0 && element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(style.overflowY);
    const canX = dx !== 0 && element.scrollWidth > element.clientWidth && /(auto|scroll)/.test(style.overflowX);
    if (canX || canY) {
      element.scrollBy(dx, dy);
      return;
    }
    element = element.parentElement;
  }
}

function pageContext(host: HTMLElement): FeedbackContext {
  const outside = (element: Element) => !host.contains(element);
  const focused = document.activeElement;
  return {
    at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    windowRole: WINDOW_ROLE,
    selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .filter(outside)
      .map((tab) => (tab.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
    focused: focused && focused !== document.body && outside(focused) ? getElementSelector(focused) : null,
  };
}

async function pinOf(mark: ElementMark): Promise<FeedbackPin> {
  const context = await mark.context;
  const live = mark.element.isConnected;
  const paths = live ? modulePaths(mark.element) : new Map<string, string>();
  const frames = (context?.stack ?? []).filter((frame) => !frame.isIgnoreListed && !(frame.fileName ?? "").includes("node_modules"));
  const stack: FeedbackFrame[] = frames.map((frame) => ({
    name: frame.functionName ?? null,
    source: sourceOf(framePath(frame, paths), frame.lineNumber, frame.columnNumber),
  }));
  // react-grab's own source is the nearest frame with a file; take the same frame with its path.
  const nearest = frames.find((frame) => frame.fileName && frame.fileName === context?.filePath && frame.lineNumber === context?.lineNumber);
  return {
    n: mark.n,
    kind: "element",
    comment: mark.comment.trim(),
    selector: context?.selector ?? (live ? getElementSelector(mark.element) : null),
    // The component in the app's own code that rendered it, not a library's wrapper (Radix's PopperAnchor).
    component: nearest?.functionName ?? context?.componentName ?? componentName(mark.element),
    source: sourceOf(nearest ? framePath(nearest, paths) : context?.filePath, context?.lineNumber, context?.columnNumber),
    stack,
    tag: mark.element.tagName.toLowerCase(),
    text: ((mark.element as HTMLElement).innerText ?? mark.element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    box: live ? boxOf(mark.element) : mark.box,
    styles: context?.styles ?? "",
  };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className="zf-tool">
      {children}
    </button>
  );
}

export function FeedbackOverlay({ host }: { host: HTMLElement }) {
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<{ box: FeedbackBox; name: string | null } | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [send, setSend] = useState<SendState>({ phase: "idle" });
  const [, setLayout] = useState(0);
  const counter = useRef(0);

  const marksRef = useRef(marks);
  marksRef.current = marks;
  // Pins follow their element while the layout moves.
  const elementMarks = marks.some((mark) => mark.kind === "element");
  useEffect(() => {
    if (!active || !elementMarks) return;
    let frame = 0;
    let last = "";
    const loop = () => {
      let signature = "";
      for (const mark of marksRef.current) {
        if (mark.kind !== "element" || !mark.element.isConnected) continue;
        mark.box = boxOf(mark.element);
        signature += `${mark.box.x},${mark.box.y},${mark.box.width},${mark.box.height};`;
      }
      if (signature !== last) {
        last = signature;
        setLayout((tick) => tick + 1);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active, elementMarks]);

  const addMark = useCallback((mark: Omit<ElementMark, "n" | "comment"> | Omit<DrawingMark, "n" | "comment">) => {
    const n = ++counter.current;
    setMarks((current) => [...current, { ...mark, n, comment: "" } as Mark]);
    setOpen(n);
  }, []);

  const clear = useCallback(() => {
    setMarks([]);
    setOpen(null);
    counter.current = 0;
  }, []);

  const pick = (event: ReactPointerEvent): Element | null =>
    getElementAtPoint(event.clientX, event.clientY, { filter: (candidate) => isElementGrabbable(candidate) && !host.contains(candidate) });

  const onPointerMove = (event: ReactPointerEvent) => {
    if (tool === "select") {
      const element = pick(event);
      setHover(element ? { box: boxOf(element), name: componentName(element) } : null);
    } else if (draft) {
      const point: Point = [event.clientX, event.clientY];
      setDraft(tool === "stroke" ? [...draft, point] : [draft[0]!, point]);
    }
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    // Keeps the focus in the comment box the click is about to open.
    event.preventDefault();
    setOpen(null);
    if (tool === "select") {
      const element = pick(event);
      if (element) addMark({ kind: "element", element, box: boxOf(element), context: getElementContext(element).catch(() => null) });
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    setDraft([[event.clientX, event.clientY]]);
  };

  const onPointerUp = () => {
    if (!draft || tool === "select") return;
    const first = draft[0]!;
    const last = draft[draft.length - 1]!;
    const long = Math.hypot(last[0] - first[0], last[1] - first[1]) > 6;
    setDraft(null);
    if (long) addMark({ kind: tool, points: draft });
  };

  const sendBundle = async () => {
    if (!marks.length || send.phase === "sending") return;
    setHover(null);
    setOpen(null);
    setSend({ phase: "sending" });
    try {
      await nextFrame();
      await nextFrame();
      const screenshot = await domToPng(document.documentElement, {
        width: innerWidth,
        height: innerHeight,
        scale: Math.min(devicePixelRatio, 2),
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        filter: (node) => !(node instanceof Element && node.hasAttribute("data-feedback-chrome")),
      });
      const pins = await Promise.all(marks.filter((mark): mark is ElementMark => mark.kind === "element").map(pinOf));
      const drawings: FeedbackDrawing[] = marks
        .filter((mark): mark is DrawingMark => mark.kind !== "element")
        .map((mark) => ({ n: mark.n, kind: mark.kind, comment: mark.comment.trim(), points: mark.points.map(([x, y]) => [Math.round(x), Math.round(y)] as Point) }));
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { context: pageContext(host), pins, drawings }, screenshot }),
      });
      const body = (await response.json()) as FeedbackResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `The dev server answered ${response.status}.`);
      await copyText(body.summary).catch(() => {});
      console.info(`[feedback] saved to ${body.dir}\n${body.summary}`);
      (window as unknown as { __zomfyFeedback?: FeedbackResponse }).__zomfyFeedback = body;
      clear();
      setSend({ phase: "sent" });
      setTimeout(() => setSend((current) => (current.phase === "sent" ? { phase: "idle" } : current)), 1600);
    } catch (error) {
      setSend({ phase: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  // Escape closes the open comment, then leaves feedback mode.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      if (open !== null) setOpen(null);
      else setActive(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, open]);

  useEffect(() => {
    if (!active) {
      setHover(null);
      setDraft(null);
      setOpen(null);
    }
  }, [active]);

  const openMark = marks.find((mark) => mark.n === open) ?? null;

  return (
    <>
      {active && (
        <>
          <div {...CHROME} className="zf-frame" />
          <div
            className="zf-capture"
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onWheel={(event) => scrollUnder(event.clientX, event.clientY, event.deltaX, event.deltaY)}
          />
          <svg className="zf-marks">
            {marks.map((mark) =>
              mark.kind === "element" ? (
                <rect key={mark.n} x={mark.box.x} y={mark.box.y} width={mark.box.width} height={mark.box.height} rx={3} fill="none" stroke={INK} strokeWidth={2} />
              ) : (
                <Shape key={mark.n} kind={mark.kind} points={mark.points} />
              ),
            )}
            {draft && tool !== "select" && <Shape kind={tool} points={draft} />}
          </svg>
          {hover && tool === "select" && (
            <div {...CHROME} className="zf-hover" style={{ left: hover.box.x, top: hover.box.y, width: hover.box.width, height: hover.box.height }}>
              <div className="zf-hover-box" />
              {hover.name && (
                <span className="zf-hover-name" style={hover.box.y > 22 ? { bottom: "100%", marginBottom: 3 } : { top: "100%", marginTop: 3 }}>
                  {hover.name}
                </span>
              )}
            </div>
          )}
          {marks.map((mark) => {
            const [x, y] = anchorOf(mark);
            return (
              <button
                key={mark.n}
                type="button"
                title={mark.comment || undefined}
                aria-label={`Mark ${mark.n}`}
                onClick={() => setOpen(open === mark.n ? null : mark.n)}
                className="zf-pin"
                style={{ left: Math.min(Math.max(x - 11, 2), innerWidth - 24), top: Math.min(Math.max(y - 11, 2), innerHeight - 24) }}
              >
                {mark.n}
              </button>
            );
          })}
          {openMark && (
            <CommentBox
              key={openMark.n}
              mark={openMark}
              onChange={(comment) => setMarks((current) => current.map((mark) => (mark.n === openMark.n ? { ...mark, comment } : mark)))}
              onClose={() => setOpen(null)}
              onRemove={() => {
                setMarks((current) => current.filter((mark) => mark.n !== openMark.n));
                setOpen(null);
              }}
            />
          )}
        </>
      )}
      <div {...CHROME} className="zf-dock">
        <div className="zf-toolbar">
          <ToolButton label={active ? "Leave feedback mode" : "Feedback mode"} active={active} onClick={() => setActive((on) => !on)}>
            {active ? <X size={16} /> : <MessageSquarePlus size={16} />}
            {!active && marks.length > 0 && <span className="zf-count">{marks.length}</span>}
          </ToolButton>
          {active && (
            <>
              <span className="zf-divider" />
              <ToolButton label="Select elements" active={tool === "select"} onClick={() => setTool("select")}>
                <MousePointer2 size={16} />
              </ToolButton>
              <ToolButton label="Draw" active={tool === "stroke"} onClick={() => setTool("stroke")}>
                <Pencil size={16} />
              </ToolButton>
              <ToolButton label="Arrow" active={tool === "arrow"} onClick={() => setTool("arrow")}>
                <MoveUpRight size={16} />
              </ToolButton>
              <ToolButton label="Rectangle" active={tool === "rect"} onClick={() => setTool("rect")}>
                <Square size={16} />
              </ToolButton>
              <span className="zf-divider" />
              <ToolButton label="Clear" disabled={!marks.length} onClick={clear}>
                <Trash2 size={16} />
              </ToolButton>
              <button
                type="button"
                title="Send"
                aria-label="Send"
                data-phase={send.phase}
                disabled={!marks.length && send.phase !== "sent"}
                onClick={() => void sendBundle()}
                className="zf-tool zf-send"
              >
                {send.phase === "sent" ? <Check size={16} /> : send.phase === "failed" ? <X size={16} /> : <Send size={16} />}
              </button>
            </>
          )}
        </div>
        {active && send.phase === "failed" && (
          <span role="alert" className="zf-error" title={send.error}>
            {send.error}
          </span>
        )}
      </div>
    </>
  );
}

function CommentBox({ mark, onChange, onClose, onRemove }: { mark: Mark; onChange: (comment: string) => void; onClose: () => void; onRemove: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [x, y] = anchorOf(mark);
  const area = extentOf(mark);
  const areaKey = `${area.x},${area.y},${area.width},${area.height}`;
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    setPosition(placeBeside(area, { width: box?.width ?? 240, height: box?.height ?? 64 }, mark.kind === "element", [x, y]));
  }, [areaKey, x, y]);
  // Focus once it is placed: a hidden box cannot take the focus.
  const placed = position !== null;
  useEffect(() => {
    if (placed) input.current?.focus();
  }, [placed]);
  return (
    <div
      {...CHROME}
      ref={ref}
      className="zf-comment"
      style={{ left: position?.left ?? x + 16, top: position?.top ?? y, visibility: position ? "visible" : "hidden" }}
    >
      <span className="zf-number">
        {mark.n}
      </span>
      <textarea
        ref={input}
        rows={2}
        aria-label={`Comment on mark ${mark.n}`}
        value={mark.comment}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <button type="button" title="Remove" aria-label={`Remove mark ${mark.n}`} onClick={onRemove} className="zf-remove">
        <X size={14} />
      </button>
    </div>
  );
}
