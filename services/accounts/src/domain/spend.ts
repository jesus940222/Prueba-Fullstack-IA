import { Money } from "./money";
import type { MovementRecord } from "./records";

export function movementBalance(movements: readonly MovementRecord[]): string {
  let cents = 0n;
  for (const movement of movements) {
    const amount = Money.parse(movement.amount).cents;
    cents += movement.direction === "in" ? amount : -amount;
  }
  return Money.fromCents(cents).format();
}

export function commercialSpend(movements: readonly MovementRecord[], dayKey: string, recordedDay: (instant: string) => string): string {
  return movements
    .filter((movement) => movement.type === "purchase" && movement.direction === "out" && recordedDay(movement.recordedAt) === dayKey)
    .reduce((total, movement) => total.add(Money.parse(movement.amount)), Money.zero())
    .format();
}
