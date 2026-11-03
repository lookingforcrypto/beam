import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  allocateBeamFee, TOTAL_FEE_BPS, COMMUNITY_NOMINAL_BPS, TREASURY_NOMINAL_BPS, FOUNDER_NOMINAL_BPS, CREATOR_SELECTED_BPS,
} from './beam-allocation.mjs';

const bytes = readFileSync(new URL('./fixtures/allocation.json', import.meta.url));
const fixture = JSON.parse(bytes);
const receipt = JSON.parse(readFileSync(new URL('./fixtures/allocation.receipt.json', import.meta.url)));

test('fixture bytes match the recorded Rust producer receipt', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.stdoutSha256);
  const source = readFileSync(new URL('./tools/generate-allocation-fixtures.rs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), receipt.sourceSha256);
});

test('constants match beam_economics', () => {
  assert.deepEqual(
    [fixture.totalBps, fixture.communityBps, fixture.treasuryBps, fixture.founderBps].map(BigInt),
    [TOTAL_FEE_BPS, COMMUNITY_NOMINAL_BPS, TREASURY_NOMINAL_BPS, FOUNDER_NOMINAL_BPS],
  );
  assert.equal(CREATOR_SELECTED_BPS, 35n);
});

test('total, community, treasury and founder match beam_economics::allocate', () => {
  assert.ok(fixture.cases.length >= 60);
  for (const c of fixture.cases) {
    assert.equal(c.error, undefined);
    const a = allocateBeamFee(c.quoteAmount);
    assert.deepEqual(
      { total: a.total, community: a.community, treasury: a.treasury, founder: a.founder },
      { total: BigInt(c.total), community: BigInt(c.community), treasury: BigInt(c.treasury), founder: BigInt(c.founder) },
      c.quoteAmount,
    );
  }
});

test('creator reservation follows docs/ECONOMICS.md step 4 and conserves every lamport', () => {
  for (const c of fixture.cases) {
    const n = BigInt(c.quoteAmount);
    const a = allocateBeamFee(n);
    const cap = (n * 35n) / 10_000n;
    assert.equal(a.creator, a.community < cap ? a.community : cap, c.quoteAmount);
    assert.equal(a.creator + a.communityAfterCreator, a.community);
    assert.equal(a.creator + a.communityAfterCreator + a.treasury + a.founder, a.total);
  }
  // The ECONOMICS illustrations.
  const hundred = allocateBeamFee(100_000_000_000n);
  assert.deepEqual(
    [hundred.total, hundred.creator, hundred.communityAfterCreator, hundred.treasury, hundred.founder],
    [500_000_000n, 350_000_000n, 70_000_000n, 50_000_000n, 30_000_000n],
  );
  const dust = allocateBeamFee(1);
  assert.deepEqual([dust.total, dust.creator, dust.community], [1n, 0n, 1n]);
});

test('inputs are strict u64 integers', () => {
  for (const bad of [-1, 1.5, '01', 2n ** 64n, null]) assert.throws(() => allocateBeamFee(bad));
});
