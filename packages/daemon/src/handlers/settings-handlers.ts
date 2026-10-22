import { HARNESS_METHODS, SETTINGS_NOTIFICATIONS } from "@acp-harness/protocol";
import { claudeCliStatus, updateClaudeCli } from "../claude-executable.ts";
import { loadHostSettings, updateHostSettings } from "../host-settings.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerSettingsHandlers({ handle, broadcast }: HandlerContext): void {
  handle(HARNESS_METHODS.settingsGet, async () => loadHostSettings());
  handle(HARNESS_METHODS.settingsUpdate, async (p) => {
    const next = await updateHostSettings(p.patch ?? {});
    broadcast(SETTINGS_NOTIFICATIONS.settingsChanged, next);
    return next;
  });
  handle(HARNESS_METHODS.claudeCliStatus, async () => claudeCliStatus());
  handle(HARNESS_METHODS.claudeCliUpdate, async () => updateClaudeCli());
}
