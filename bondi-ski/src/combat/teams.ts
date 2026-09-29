/** Free-for-all, or two teams (Tribes: Ascend's team deathmatch). */
export type GameType = "ffa" | "teams";
export type TeamId = 0 | 1;

/** The two teams: named for the beaches at either end of the walk. */
export const TEAMS: readonly { name: string; colour: string }[] = [
  { name: "Bondi", colour: "#4fb3ff" },
  { name: "Bronte", colour: "#ff8a3d" },
];

/** The game type in the page's link (`?teams=1`), which a room's invite link carries. */
export function gameTypeFromUrl(): GameType {
  try {
    return new URLSearchParams(location.search).get("teams") === "1" ? "teams" : "ffa";
  } catch {
    return "ffa";
  }
}

/** The winner id `Match` uses for a team. */
export function teamWinner(t: TeamId): string {
  return `team:${t}`;
}
