import { AccountsError } from "./accounts-error";

const PATTERN = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/;

export class Money {
  private constructor(readonly cents: bigint) {}

  static parse(value: string): Money {
    if (!PATTERN.test(value)) {
      throw new AccountsError("VALIDATION_ERROR", "El importe no es un decimal MXN válido", [{ field: "amount", code: "invalid" }]);
    }
    const [whole, fraction] = value.split(".");
    return new Money(BigInt(whole ?? "0") * 100n + BigInt(fraction ?? "0"));
  }

  static zero(): Money {
    return new Money(0n);
  }

  static fromCents(cents: bigint): Money {
    if (cents < 0n) {
      throw new AccountsError("BUSINESS_RULE", "El saldo no alcanza");
    }
    return new Money(cents);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    if (other.cents > this.cents) {
      throw new AccountsError("BUSINESS_RULE", "El saldo no alcanza");
    }
    return new Money(this.cents - other.cents);
  }

  compare(other: Money): number {
    if (this.cents < other.cents) {
      return -1;
    }
    if (this.cents > other.cents) {
      return 1;
    }
    return 0;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  format(): string {
    const whole = this.cents / 100n;
    const fraction = (this.cents % 100n).toString().padStart(2, "0");
    return `${whole.toString()}.${fraction}`;
  }
}
