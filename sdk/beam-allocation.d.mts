export declare const TOTAL_FEE_BPS: bigint;
export declare const COMMUNITY_NOMINAL_BPS: bigint;
export declare const TREASURY_NOMINAL_BPS: bigint;
export declare const FOUNDER_NOMINAL_BPS: bigint;
export declare const CREATOR_SELECTED_BPS: bigint;
export type IntegerInput = bigint | number | string;
export interface BeamFeeAllocation {
  total: bigint;
  community: bigint;
  treasury: bigint;
  founder: bigint;
  creator: bigint;
  communityAfterCreator: bigint;
}
export declare function allocateBeamFee(quoteAmount: IntegerInput): BeamFeeAllocation;
