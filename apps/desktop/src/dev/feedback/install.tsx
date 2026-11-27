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
createRoot(host).render(<FeedbackOverlay host={host} />);
