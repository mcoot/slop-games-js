import { joinRoom, selfId } from "trystero/nostr";
import { isNetMessage, type NetMessage } from "./protocol";
import type { Transport } from "./transport";

/**
 * Racing over the internet: WebRTC data channels straight between players, with the
 * handshake done through public Nostr relays (Trystero), so the static site needs no
 * server of its own. Peers only ever see each other's race messages.
 */
const APP_ID = "slop-games.spearritt.dev/bondi-ski";

export function trysteroTransport(room: string): Transport {
  const r = joinRoom({ appId: APP_ID }, room);
  const action = r.makeAction<NetMessage>("race");
  const known = new Set<string>();
  const joinFns: ((id: string) => void)[] = [];
  const leaveFns: ((id: string) => void)[] = [];
  r.onPeerJoin = (id: string) => {
    known.add(id);
    for (const fn of joinFns) fn(id);
  };
  r.onPeerLeave = (id: string) => {
    known.delete(id);
    for (const fn of leaveFns) fn(id);
  };
  const messageFns: ((from: string, m: NetMessage) => void)[] = [];
  action.onMessage = (data: unknown, { peerId }: { peerId: string }) => {
    if (isNetMessage(data)) for (const fn of messageFns) fn(peerId, data);
  };
  return {
    selfId,
    peerIds: () => [...known],
    send(message, to) {
      void action.send(message, to ? { target: to } : undefined);
    },
    onMessage: (fn) => messageFns.push(fn),
    onPeerJoin: (fn) => joinFns.push(fn),
    onPeerLeave: (fn) => leaveFns.push(fn),
    leave: () => void r.leave(),
  };
}
