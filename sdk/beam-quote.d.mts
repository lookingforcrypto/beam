// Type declarations for beam-quote.mjs, used by the TypeScript web preview.
export type IntegerInput = bigint | number | string;
export interface CurveReserves {
  virtualTokenReserves: IntegerInput;
  virtualQuoteReserves: IntegerInput;
  realTokenReserves: IntegerInput;
  realQuoteReserves: IntegerInput;
}
export interface PreviewCurve extends CurveReserves {
  complete: boolean;
  creator: string;
  creatorFeeBps: IntegerInput;
}
export declare class QuoteError extends RangeError {
  readonly code: string;
  constructor(code: string, message?: string);
}
export declare function buyQuote(curve: CurveReserves, amount: IntegerInput): bigint;
export declare function sellQuote(curve: CurveReserves, amount: IntegerInput): bigint;
export declare function tokensForQuote(curve: CurveReserves, quote: IntegerInput): bigint;
export declare function fee(amount: IntegerInput, basisPoints: IntegerInput): bigint;
export declare function maxSolCostWithSlippage(totalCost: IntegerInput, slippageBps: IntegerInput): bigint;
export declare function minSolOutputWithSlippage(netOutput: IntegerInput, slippageBps: IntegerInput): bigint;
