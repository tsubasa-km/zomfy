import { HARNESS_METHODS, TODO_NOTIFICATIONS } from "@acp-harness/protocol";
import { TodoStore } from "../todo-store.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerTodoHandlers({ handle, broadcast }: HandlerContext): void {
  const todos = new TodoStore();
  const changed = async () => broadcast(TODO_NOTIFICATIONS.todosChanged, await todos.list());

  handle(HARNESS_METHODS.todosList, async () => todos.list());
  handle(HARNESS_METHODS.todoAdd, async (p) => {
    const item = await todos.add(p);
    await changed();
    return item;
  });
  handle(HARNESS_METHODS.todoUpdate, async (p) => {
    const item = await todos.update(p.id, p.patch ?? {});
    await changed();
    return item;
  });
  handle(HARNESS_METHODS.todoRemove, async (p) => {
    await todos.remove(p.id);
    await changed();
    return {};
  });
}
