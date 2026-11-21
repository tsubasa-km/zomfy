import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { ConnectionClients } from "./connection-clients.ts";

// A request's ctx.client is a new object each time; it must still count as its window's client,
// or an ask to that window looks like one to a closed window and is sent again.

const clientOf = (cx: object) => ({ cx }) as unknown as acp.AgentContext;

test("a request's client maps to the client its connection made", () => {
  const clients = new ConnectionClients();
  const cx = {};
  const connected = clientOf(cx);
  clients.add(connected);
  expect(clients.canonical(clientOf(cx))).toBe(connected);
  expect(clients.canonical(clientOf(cx))).toBe(connected);
});

test("other connections, and closed ones, keep their own client", () => {
  const clients = new ConnectionClients();
  const a = clientOf({});
  const cx = {};
  const b = clientOf(cx);
  clients.add(a);
  clients.add(b);
  const other = clientOf({});
  expect(clients.canonical(other)).toBe(other);
  clients.delete(b);
  const late = clientOf(cx);
  expect(clients.canonical(late)).toBe(late);
});
