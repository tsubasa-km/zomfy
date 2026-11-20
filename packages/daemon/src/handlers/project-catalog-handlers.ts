import { HARNESS_METHODS, PROJECT_CATALOG_NOTIFICATIONS } from "@acp-harness/protocol";
import { ProjectCatalogStore } from "../project-catalog.ts";
import type { HandlerContext } from "./handler-context.ts";

const store = new ProjectCatalogStore();

export function registerProjectCatalogHandlers({ handle, broadcast }: HandlerContext): void {
  const reply = async (result: ReturnType<ProjectCatalogStore["sync"]>) => {
    const { catalog, changed } = await result;
    if (changed) broadcast(PROJECT_CATALOG_NOTIFICATIONS.projectCatalogChanged, catalog);
    return catalog;
  };
  handle(HARNESS_METHODS.projectCatalogList, () => store.list());
  handle(HARNESS_METHODS.projectCatalogSync, (p) => reply(store.sync(p.hostId, p.projectIds)));
  handle(HARNESS_METHODS.projectCatalogPlace, (p) => reply(store.place(p.to, p.location)));
  handle(HARNESS_METHODS.projectCatalogDetach, (p) => reply(store.detach(p.location)));
  handle(HARNESS_METHODS.projectCatalogRename, (p) => reply(store.rename(p.id, p.name)));
}
