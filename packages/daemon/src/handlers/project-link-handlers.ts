import { HARNESS_METHODS, PROJECT_LINK_NOTIFICATIONS, type ProjectLink } from "@acp-harness/protocol";
import { ProjectLinkStore } from "../project-link-store.ts";
import type { HandlerContext } from "./handler-context.ts";

const links = new ProjectLinkStore();

export function registerProjectLinkHandlers({ handle, broadcast }: HandlerContext): void {
  const changed = (list: ProjectLink[]) => {
    broadcast(PROJECT_LINK_NOTIFICATIONS.projectLinksChanged, list);
    return list;
  };
  handle(HARNESS_METHODS.projectLinksList, () => links.list());
  handle(HARNESS_METHODS.projectLinkSave, async (p) => changed(await links.save(p.link)));
  handle(HARNESS_METHODS.projectLinkRemove, async (p) => changed(await links.remove(p.id)));
}
