/**
 * Tōkaidō Shinkansen destinations from Tokyo with plausible (made-up) fares.
 * Unreserved fare per adult; a reserved seat costs a surcharge on top.
 */
export interface Destination {
  id: string;
  ja: string;
  en: string;
  unreserved: number;
}

export const DESTINATIONS: Destination[] = [
  { id: "shinagawa", ja: "品川", en: "Shinagawa", unreserved: 880 },
  { id: "shin-yokohama", ja: "新横浜", en: "Shin-Yokohama", unreserved: 2280 },
  { id: "shizuoka", ja: "静岡", en: "Shizuoka", unreserved: 5940 },
  { id: "nagoya", ja: "名古屋", en: "Nagoya", unreserved: 10560 },
  { id: "kyoto", ja: "京都", en: "Kyoto", unreserved: 12650 },
  { id: "shin-osaka", ja: "新大阪", en: "Shin-Osaka", unreserved: 13320 },
];

export const RESERVED_SURCHARGE = 1090;

export type SeatType = "unreserved" | "reserved";

export const SEATS: Record<SeatType, { ja: string; en: string }> = {
  unreserved: { ja: "自由席", en: "Unreserved" },
  reserved: { ja: "指定席", en: "Reserved" },
};

export function destination(id: string): Destination {
  const d = DESTINATIONS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown destination ${id}`);
  return d;
}

export function fare(destinationId: string, seat: SeatType, passengers: number): number {
  const base = destination(destinationId).unreserved + (seat === "reserved" ? RESERVED_SURCHARGE : 0);
  return base * passengers;
}

export interface Ticket {
  destination: string;
  seat: SeatType;
  passengers: number;
  fare: number;
}
