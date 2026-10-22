import React from "react";
import ReactDOM from "react-dom/client";
import { WINDOW_ROLE } from "./lib/window-role";

// The dashboard pop-out loads only its own root, so the app shell's startup work does not run twice.
const Root = WINDOW_ROLE === "dashboard" ? React.lazy(() => import("./components/DashboardWindow")) : React.lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>,
);
