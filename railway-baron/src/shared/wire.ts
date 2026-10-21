/**
 * Between a player and the game server: JSON over a WebSocket. The server owns the
 * game; clients send what they want to do and get the whole room back (`state`) after
 * every change, shaped for them: the baron sees the secret, the rescuers don't. The
 * first `state` after joining says which room and seat is yours.
 */
export type ClientFrame =
  /** Make a new room and be its baron. Needs the access code. */
  | { k: "create"; code: string; name: string; token: string }
  /** Join an existing room as a rescuer, or come back to your seat (same token). */
  | { k: "join"; room: string; name: string; token: string }
  | { k: "pet"; pet: PetKind }
  /** Baron: the robot checks it's a person, place or thing before taking it. */
  | { k: "secret"; answer: string; notes: string }
  | { k: "start" }
  | { k: "propose"; text: string }
  /** Back (or stop backing) a proposed question. */
  | { k: "back"; id: number; on: boolean }
  | { k: "withdraw"; id: number }
  | { k: "taunt"; taunt: Taunt }
  /** Back to the lobby for another round. */
  | { k: "again" };

export type ServerFrame =
  | { k: "state"; view: RoomView }
  /** Something you asked for didn't happen; `fatal` means the connection is closing. */
  | { k: "error"; message: string; fatal?: boolean }
  | { k: "taunt"; from: string; taunt: Taunt };

export type Role = "baron" | "rescuer";
export type Phase = "lobby" | "playing" | "won" | "lost";
export type PetKind = "snake" | "lobster" | "sunfish";
export const PETS: readonly PetKind[] = ["snake", "lobster", "sunfish"];
export type Taunt = "laugh" | "twirl" | "tophat";
export const TAUNTS: readonly Taunt[] = ["laugh", "twirl", "tophat"];

/** What the robot said to a question. `refused` (not a yes/no question) and `error` don't count. */
export type Reply = "yes" | "no" | "unsure" | "refused" | "correct" | "wrong" | "error";

export interface Member {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
}

export interface Proposal {
  id: number;
  text: string;
  by: string;
  backers: string[];
}

export interface Asked {
  /** Which question this was (1 to 20); 0 for ones that didn't count. */
  n: number;
  text: string;
  by: string;
  reply: Reply;
  /** Whether the question's words name the answer (only a guess that does can win). */
  named?: boolean;
  /** The model call behind it: live for the baron, for everyone once the round's over. */
  brain?: Brain;
}

/** One model call, exactly as sent and received, for the robot's brain panel. */
export interface Brain {
  model: string;
  request: unknown;
  response: unknown;
  ms: number;
  cost?: number;
}

export interface SecretView {
  answer: string;
  notes: string;
  category: string;
  /** What the robot read up on (the intro of a Wikipedia article), if it found anything. */
  facts?: string;
  source?: { title: string; url: string };
  brain?: Brain;
}

export interface RoomView {
  room: string;
  you: string;
  role: Role;
  phase: Phase;
  members: Member[];
  pet: PetKind;
  /** The baron has set an answer the robot accepted. */
  ready: boolean;
  /** The answer: for the baron, and for everyone once the round's over. */
  secret?: SecretView;
  /** Baron only: why the robot turned down the last answer. */
  rejected?: { answer: string; reason: string; brain?: Brain };
  /** The robot is checking the answer or thinking about a question. */
  thinking: boolean;
  proposals: Proposal[];
  asked: Asked[];
  questionsLeft: number;
  /** How long until the train arrives, as of when this was sent. */
  msLeft: number;
  roundMs: number;
  outcome?: "freed" | "train" | "questions";
  /** The robot has stopped answering for the day (the server's daily budget is spent). */
  onStrike: boolean;
}

export const NAME_MAX = 24;
export const QUESTION_MAX = 160;
export const ANSWER_MAX = 60;
export const NOTES_MAX = 200;
/** Room codes are made by the server and can't be guessed. */
export const ROOM_PATTERN = /^[a-z0-9]{10}$/;
/** A client's private token, which gets it back into its seat after a reconnect. */
export const TOKEN_PATTERN = /^[A-Za-z0-9]{16,40}$/;
