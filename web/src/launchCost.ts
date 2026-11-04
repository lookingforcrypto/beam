// Estimated lamports to launch a native-SOL token with `create_v2`.
//
// Every constant below is observed, not assumed: tests/legacy-trade-runtime
// (`tests/launch_cost.rs`) runs the real handler in a local bank and checks
// that the creator's debit is exactly the rent-exempt minimum of the three
// accounts it creates, that the mint is 318 bytes plus the UTF-8 lengths of
// name, symbol and URI, and that the curve and its token account are 166 and
// 170 bytes. web/tests/launchCost.test.ts compares this module with those
// observations. Rent uses Solana's default parameters; network fees use the
// default 5,000 lamports per signature and exclude priority fees.

const encoder = new TextEncoder();
const utf8Bytes = (value: string) => encoder.encode(value).length;

/** Default Rent: 3,480 lamports per byte-year, exempt at two years. */
export const RENT_LAMPORTS_PER_BYTE = 6_960n;
export const ACCOUNT_STORAGE_OVERHEAD = 128n;
/** Token-2022 mint with metadata pointer (234) + metadata TLV fixed part (84). */
export const MINT_FIXED_BYTES = 318;
export const CURVE_BYTES = 166;
export const CURVE_TOKEN_ACCOUNT_BYTES = 170;
export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** The creator and the new mint keypair sign the launch. */
export const LAUNCH_SIGNATURES = 2n;

export const CREATE_V2_LIMITS = { name: 32, symbol: 13, uri: 200 } as const;

export function rentExemptLamports(bytes: number): bigint {
  return (ACCOUNT_STORAGE_OVERHEAD + BigInt(bytes)) * RENT_LAMPORTS_PER_BYTE;
}

export type LaunchCost = {
  mintBytes: number;
  mintRent: bigint;
  curveRent: bigint;
  curveTokenAccountRent: bigint;
  accountRent: bigint;
  networkFee: bigint;
  total: bigint;
};

export function launchCostForBytes(
  nameBytes: number,
  symbolBytes: number,
  uriBytes: number,
): LaunchCost | null {
  if (
    ![nameBytes, symbolBytes, uriBytes].every(
      (n) => Number.isInteger(n) && n >= 0,
    ) ||
    nameBytes > CREATE_V2_LIMITS.name ||
    symbolBytes > CREATE_V2_LIMITS.symbol ||
    uriBytes > CREATE_V2_LIMITS.uri
  )
    return null;
  const mintBytes = MINT_FIXED_BYTES + nameBytes + symbolBytes + uriBytes;
  const mintRent = rentExemptLamports(mintBytes);
  const curveRent = rentExemptLamports(CURVE_BYTES);
  const curveTokenAccountRent = rentExemptLamports(CURVE_TOKEN_ACCOUNT_BYTES);
  const accountRent = mintRent + curveRent + curveTokenAccountRent;
  const networkFee = LAUNCH_SIGNATURES * LAMPORTS_PER_SIGNATURE;
  return {
    mintBytes,
    mintRent,
    curveRent,
    curveTokenAccountRent,
    accountRent,
    networkFee,
    total: accountRent + networkFee,
  };
}

export function launchCost(
  name: string,
  symbol: string,
  uri: string,
): LaunchCost | null {
  return launchCostForBytes(utf8Bytes(name), utf8Bytes(symbol), utf8Bytes(uri));
}

/** e.g. 7_551_600n -> "0.0075516 SOL". */
export function lamportsToSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} SOL` : `${whole} SOL`;
}
