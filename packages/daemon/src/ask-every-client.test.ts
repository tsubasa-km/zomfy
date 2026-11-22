import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CHAT_META, PERMISSION_ASK_META, PERMISSION_ASK_NOTIFICATIONS, type PermissionAskResolved } from "@zomfy/protocol";
import { AskEveryClient } from "./ask-every-client.ts";

// Every window and phone is asked at once; the first answer wins and the others hear it was answered.

interface FakeClient {
  client: acp.AgentContext;
  asked: acp.RequestPermissionRequest[];
  answer: (response: acp.RequestPermissionResponse) => void;
  refuse: () => void;
  close: () => void;
  closed: Promise<void>;
}

function fakeClient(): FakeClient {
  const asked: acp.RequestPermissionRequest[] = [];
  let answer: (r: acp.RequestPermissionResponse) => void = () => undefined;
  let refuse: () => void = () => undefined;
  let close: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => (close = resolve));
  const client = {
    request: (_method: string, params: acp.RequestPermissionRequest) =>
      new Promise((resolve, reject) => {
        asked.push(params);
        answer = resolve;
        refuse = () => reject(new Error("This window does not answer approvals"));
      }),
  } as unknown as acp.AgentContext;
  return {
    client,
    asked,
    answer: (r) => answer(r),
    refuse: () => refuse(),
    close: () => close(),
    closed,
  };
}

function setup(clients: FakeClient[], waitMs = 60_000) {
  const notes: PermissionAskResolved[] = [];
  const asks = new AskEveryClient({
    clients: () => clients.map((c) => c.client),
    closed: (client) => clients.find((c) => c.client === client)?.closed ?? Promise.resolve(),
    broadcast: (method, params) => {
      if (method === PERMISSION_ASK_NOTIFICATIONS.resolved) notes.push(params as PermissionAskResolved);
    },
    waitMs,
  });
  return { asks, notes };
}

const request: acp.RequestPermissionRequest = {
  sessionId: "s1",
  toolCall: { toolCallId: "t1", title: "Run ls" },
  options: [
    { kind: "allow_once", name: "Allow", optionId: "allow" },
    { kind: "reject_once", name: "Deny", optionId: "deny" },
  ],
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test("every client is asked at once, with the same ask id", async () => {
  const a = fakeClient();
  const b = fakeClient();
  const { asks } = setup([a, b]);
  void asks.ask(request);
  await tick();
  expect(a.asked).toHaveLength(1);
  expect(b.asked).toHaveLength(1);
  const id = a.asked[0]!._meta?.[PERMISSION_ASK_META.askId];
  expect(typeof id).toBe("string");
  expect(b.asked[0]!._meta?.[PERMISSION_ASK_META.askId]).toBe(id);
});

test("the first answer wins and the others are told it was answered", async () => {
  const a = fakeClient();
  const b = fakeClient();
  const { asks, notes } = setup([a, b]);
  const outcome = asks.ask(request);
  await tick();
  b.answer({ outcome: { outcome: "selected", optionId: "deny" } });
  a.answer({ outcome: { outcome: "selected", optionId: "allow" } });
  const { response, unanswered } = await outcome;
  expect(unanswered).toBe(false);
  expect(response.outcome).toEqual({ outcome: "selected", optionId: "deny" });
  await tick();
  expect(notes).toEqual([{ sessionId: "s1", askId: a.asked[0]!._meta![PERMISSION_ASK_META.askId] as string, optionId: "deny" }]);
});

test("a question's answers travel with the resolved notice", async () => {
  const a = fakeClient();
  const { asks, notes } = setup([a]);
  const outcome = asks.ask(request);
  await tick();
  a.answer({ outcome: { outcome: "selected", optionId: "answer" }, _meta: { [CHAT_META.answers]: { answers: { "Which?": "Blue" } } } });
  await outcome;
  expect(notes[0]?.answers).toEqual({ "Which?": "Blue" });
});

test("a client that cannot answer asks, or closes, leaves the ask to the others", async () => {
  const dashboard = fakeClient();
  const leaving = fakeClient();
  const main = fakeClient();
  const { asks } = setup([dashboard, leaving, main]);
  const outcome = asks.ask(request);
  await tick();
  dashboard.refuse();
  leaving.close();
  await tick();
  main.answer({ outcome: { outcome: "selected", optionId: "allow" } });
  expect((await outcome).response.outcome).toEqual({ outcome: "selected", optionId: "allow" });
});

test("a window that drops its card does not cancel the ask for a phone still showing it", async () => {
  const window = fakeClient();
  const phone = fakeClient();
  const { asks } = setup([window, phone]);
  const outcome = asks.ask(request);
  await tick();
  window.answer({ outcome: { outcome: "cancelled" } });
  await tick();
  phone.answer({ outcome: { outcome: "selected", optionId: "allow" } });
  expect((await outcome).response.outcome).toEqual({ outcome: "selected", optionId: "allow" });
});

test("a cancel stands when nobody else holds the ask", async () => {
  const window = fakeClient();
  const { asks } = setup([window]);
  const outcome = asks.ask(request);
  await tick();
  window.answer({ outcome: { outcome: "cancelled" } });
  expect(await outcome).toEqual({ response: { outcome: { outcome: "cancelled" } }, unanswered: false });
});

test("a client that connects while an ask waits is asked too", async () => {
  const late = fakeClient();
  const list: FakeClient[] = [];
  const { asks } = setup(list);
  const outcome = asks.ask(request);
  list.push(late);
  asks.connected(late.client);
  await tick();
  expect(late.asked).toHaveLength(1);
  late.answer({ outcome: { outcome: "selected", optionId: "allow" } });
  expect((await outcome).response.outcome).toEqual({ outcome: "selected", optionId: "allow" });
});

test("with nobody to ask, it is denied after the wait", async () => {
  const { asks, notes } = setup([], 20);
  const { response, unanswered } = await asks.ask(request);
  expect(unanswered).toBe(true);
  expect(response.outcome).toEqual({ outcome: "cancelled" });
  expect(notes).toHaveLength(1);
});

test("stopping the turn withdraws the ask from every client", async () => {
  const a = fakeClient();
  const { asks, notes } = setup([a]);
  const abort = new AbortController();
  const outcome = asks.ask(request, abort.signal);
  await tick();
  abort.abort();
  expect((await outcome).response.outcome).toEqual({ outcome: "cancelled" });
  expect(notes[0]?.optionId).toBeNull();
  expect(asks.waiting()).toHaveLength(0);
});
