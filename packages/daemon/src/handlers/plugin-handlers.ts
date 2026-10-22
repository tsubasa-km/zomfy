import { HARNESS_METHODS, PLUGIN_NOTIFICATIONS } from "@acp-harness/protocol";
import { PluginStore } from "../plugin-store.ts";
import { pluginPanels } from "../plugin-panel-server.ts";
import type { HandlerContext } from "./handler-context.ts";

/** Plugins live on this computer's daemon (desktop asks the local host only). */
export function registerPluginHandlers({ handle, broadcast }: HandlerContext): void {
  const plugins = new PluginStore();
  handle(HARNESS_METHODS.pluginsList, async () => plugins.list());
  handle(HARNESS_METHODS.pluginSetEnabled, async (p) => {
    const snapshot = await plugins.setEnabled(p.pluginKey, p.enabled, p.consentFingerprint);
    broadcast(PLUGIN_NOTIFICATIONS.pluginsChanged, snapshot);
    return snapshot;
  });
  handle(HARNESS_METHODS.pluginPanelRead, async (p) => ({
    path: pluginPanels.issue(await plugins.readPanel(p.pluginKey, p.panelId), {
      scheme: p.theme?.scheme === "dark" ? "dark" : "light",
      tokensCss: typeof p.theme?.tokensCss === "string" ? p.theme.tokensCss.slice(0, 8192) : "",
    }),
  }));
}
