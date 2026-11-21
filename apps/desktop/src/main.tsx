// First: renames legacy storage keys before the stores below read theirs.
import "./lib/migrate-legacy-storage";
import React from "react";
import ReactDOM from "react-dom/client";
import { WINDOW_ROLE } from "./lib/window-role";
import { installLinkRouting } from "./lib/link-routing";
import { followLanguageChanges } from "./i18n/i18n";
import { STORAGE_KEY } from "./stores/settings-store";
import { ErrorBoundary, ViewError } from "./components/ErrorBoundary";

// Both roots show links (chats, panels), and the webview has no opener of its own.
installLinkRouting();
followLanguageChanges(STORAGE_KEY);

// Pop-outs (the dashboard, a workspace) load only their own root, so the app shell's startup work does not run twice.
const Root =
  WINDOW_ROLE === "dashboard"
    ? React.lazy(() => import("./components/DashboardWindow"))
    : WINDOW_ROLE === "workspace"
      ? React.lazy(() => import("./components/WorkspaceWindow"))
      : React.lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* A render error shows what broke instead of a blank window. */}
    <ErrorBoundary fallback={(error, reset) => <div className="flex h-screen bg-background text-foreground"><ViewError error={error} onRetry={reset} whole /></div>}>
      <React.Suspense fallback={null}>
        <Root />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
