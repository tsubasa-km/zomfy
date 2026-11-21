import { HARNESS_METHODS, LSP_NOTIFICATIONS } from "@zomfy/protocol";
import { LanguageServerManager } from "../lsp-manager.ts";
import type { HandlerContext } from "./handler-context.ts";

/** `_harness/lsp/*`: the window's editor talking to language servers on this host. */
export function registerLspHandlers({ handle, broadcast, workspaceRoot }: HandlerContext): void {
  const manager = new LanguageServerManager({
    workspaceRoot,
    send: (event) => broadcast(LSP_NOTIFICATIONS.lspEvent, event),
  });
  handle(HARNESS_METHODS.lspOpen, (p) => manager.open(p));
  // Not `async`: the message must reach the server before this handler yields, or a change could
  // overtake the one sent before it.
  handle(HARNESS_METHODS.lspNotify, (p) => {
    manager.notify(p);
    return Promise.resolve({});
  });
  handle(HARNESS_METHODS.lspRequest, (p) => manager.request(p));
  handle(HARNESS_METHODS.lspCancel, async (p) => {
    manager.cancel(p);
    return {};
  });
  handle(HARNESS_METHODS.lspRespond, async (p) => {
    manager.respond(p);
    return {};
  });
  handle(HARNESS_METHODS.lspKeepAlive, async (p) => {
    manager.keepAlive(p.clientId);
    return {};
  });
  handle(HARNESS_METHODS.lspReadExternal, (p) => manager.readExternal(p));
  handle(HARNESS_METHODS.lspServers, (p) => manager.servers(p.workspaceId));
  handle(HARNESS_METHODS.lspSetServer, (p) => manager.setServer(p));
}
