import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CURVE_BYTES,
  CURVE_TOKEN_ACCOUNT_BYTES,
  launchCost,
  launchCostForBytes,
  lamportsToSol,
  rentExemptLamports,
} from "../src/launchCost.ts";

const fixtureBytes = readFileSync(
  new URL(
    "../../tests/legacy-trade-runtime/fixtures/launch-cost.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(fixtureBytes.toString());
const receipt = JSON.parse(
  readFileSync(
    new URL(
      "../../tests/legacy-trade-runtime/fixtures/launch-cost.receipt.json",
      import.meta.url,
    ),
  ).toString(),
);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("fixture and in-tree producer match the receipt", () => {
  assert.equal(sha(fixtureBytes), receipt.stdoutSha256);
  const producer = readFileSync(
    new URL(
      "../../tests/legacy-trade-runtime/tests/launch_cost.rs",
      import.meta.url,
    ),
  );
  assert.equal(sha(producer), receipt.producerSha256);
});

test("the estimate equals every observed create_v2 creator debit", () => {
  assert.ok(fixture.cases.length >= 5);
  for (const c of fixture.cases) {
    const cost = launchCostForBytes(c.nameBytes, c.symbolBytes, c.uriBytes);
    assert.ok(cost, JSON.stringify(c));
    assert.equal(cost.mintBytes, c.mintDataLength);
    assert.equal(cost.mintRent, BigInt(c.mintLamports));
    assert.equal(cost.curveRent, BigInt(c.curveLamports));
    assert.equal(
      cost.curveTokenAccountRent,
      BigInt(c.curveTokenAccountLamports),
    );
    assert.equal(cost.accountRent, BigInt(c.creatorDebitLamports));
    assert.equal(cost.total, cost.accountRent + 10_000n);
  }
});

test("lengths are UTF-8 bytes and limits match CreateV2", () => {
  // "Beam 🚀" is 9 UTF-8 bytes and "Ü" is 2, as in the observed fixture case.
  assert.equal(
    launchCost("Beam 🚀", "Ü", "ipfs://bafy")?.accountRent,
    launchCostForBytes(9, 2, 11)?.accountRent,
  );
  assert.ok(launchCostForBytes(32, 13, 200));
  assert.equal(launchCostForBytes(33, 1, 0), null);
  assert.equal(launchCostForBytes(1, 14, 0), null);
  assert.equal(launchCostForBytes(1, 1, 201), null);
  assert.equal(launchCostForBytes(-1, 1, 0), null);
  assert.equal(launchCost("x".repeat(33), "A", ""), null);
});

test("rent and formatting helpers", () => {
  assert.equal(rentExemptLamports(0), 890_880n);
  assert.equal(rentExemptLamports(CURVE_BYTES), 2_046_240n);
  assert.equal(rentExemptLamports(CURVE_TOKEN_ACCOUNT_BYTES), 2_074_080n);
  assert.equal(lamportsToSol(7_551_600n), "0.0075516 SOL");
  assert.equal(lamportsToSol(1_000_000_000n), "1 SOL");
  assert.equal(lamportsToSol(10_000n), "0.00001 SOL");
  const max = launchCostForBytes(32, 13, 200);
  assert.ok(max && max.accountRent < 10_000_000n, "under 0.01 SOL of rent");
});
