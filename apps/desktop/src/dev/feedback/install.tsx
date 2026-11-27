// Mounts the dev feedback overlay in a root of its own (docs/specs/dev-feedback-overlay.md).
// main.tsx imports this only when `import.meta.env.DEV`, so production builds leave it out.
import { createRoot } from "react-dom/client";
import { FeedbackOverlay } from "./FeedbackOverlay";
import "./feedback.css";

const host = document.createElement("div");
host.id = "zomfy-feedback";
// react-grab's hit testing skips this subtree.
host.setAttribute("data-react-grab-ignore", "");
document.body.appendChild(host);

// The overlay must work while a Radix dialog, menu or popover is open, which is when the person
// wants to point at one. Those layers listen on the document: DismissableLayer closes on a
// pointerdown or focusin outside it, FocusScope pulls the focus back on focusin/focusout. Events
// from the overlay stop at its root (bubble phase, so the overlay's own handlers still run).
for (const type of ["pointerdown", "mousedown", "touchstart", "focusin", "focusout", "click", "contextmenu"]) {
  host.addEventListener(type, (event) => event.stopPropagation());
}
// Focus leaving a trapped dialog for the overlay fires focusout on the dialog's element, outside
// the overlay; a capture listener on the window, ahead of the document's, keeps it from Radix.
window.addEventListener(
  "focusout",
  (event) => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) event.stopImmediatePropagation();
  },
  true,
);
// A modal hides its siblings; the overlay stays usable.
new MutationObserver(() => {
  if (host.hasAttribute("inert")) host.removeAttribute("inert");
  if (host.getAttribute("aria-hidden") === "true") host.removeAttribute("aria-hidden");
}).observe(host, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });

createRoot(host).render(<FeedbackOverlay host={host} />);
