import { useId, useMemo, useState } from "react";
import type { Token } from "./data";
import {
  SAMPLE_CURVE_CONFIG,
  SLIPPAGE_CHOICES_BPS,
  TOKEN_DECIMALS,
  formatPercentBps,
  formatSol,
  formatTokens,
  parseUnits,
  previewBuy,
  previewSell,
  sampleCurveAtProgress,
  summarizeCurve,
  type TicketError,
} from "./tradePreview";
import "./tradePanel.css";

type Side = "buy" | "sell";

const QUICK_BUYS = ["0.1", "0.5", "1", "5"];
const QUICK_SELLS = ["1000000", "10000000", "50000000"];

const ERROR_COPY: Record<TicketError, string> = {
  "enter-amount": "Enter an amount to preview.",
  "too-small": "That amount is too small to buy or sell any tokens.",
  "curve-complete":
    "This sample curve is complete; its next step is Raydium migration.",
  "exceeds-circulating":
    "That is more than has been bought from this sample curve.",
};

/**
 * Pre-PumpSwap style trade ticket. Every number is a local estimate on a
 * sample curve; the submit button stays disabled.
 */
export function TradePanel({ token }: { token: Token }) {
  const id = useId();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);

  const curve = useMemo(
    () => sampleCurveAtProgress(token.progress),
    [token.progress],
  );
  const summary = useMemo(() => summarizeCurve(curve), [curve]);
  const units = parseUnits(amount, side === "buy" ? 9 : TOKEN_DECIMALS);
  const result =
    amount.trim() === ""
      ? null
      : units === null
        ? null
        : side === "buy"
          ? previewBuy(curve, units, slippageBps)
          : previewSell(curve, units, slippageBps);

  const switchSide = (next: Side) => {
    setSide(next);
    setAmount("");
  };

  return (
    <section className="trade-panel" aria-labelledby={`${id}-title`}>
      <div className="trade-panel-head">
        <h3 id={`${id}-title`}>Trade preview</h3>
        <span className="trade-sample-tag">Sample curve · not live</span>
      </div>

      <div className="trade-tabs" role="tablist" aria-label="Trade side">
        {(["buy", "sell"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            id={`${id}-tab-${value}`}
            aria-selected={side === value}
            aria-controls={`${id}-ticket`}
            className={`trade-tab trade-tab-${value}${side === value ? " active" : ""}`}
            onClick={() => switchSide(value)}
          >
            {value === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div
        className="trade-ticket"
        id={`${id}-ticket`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${side}`}
      >
        <label className="trade-amount">
          <span>
            {side === "buy" ? "Amount (SOL)" : `Amount (${token.symbol})`}
          </span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={side === "buy" ? "0.0" : "0"}
            aria-invalid={amount.trim() !== "" && units === null}
          />
        </label>
        <div className="trade-quick" aria-label="Quick amounts">
          <button type="button" onClick={() => setAmount("")}>
            reset
          </button>
          {(side === "buy" ? QUICK_BUYS : QUICK_SELLS).map((value) => (
            <button type="button" key={value} onClick={() => setAmount(value)}>
              {side === "buy"
                ? `${value} SOL`
                : formatTokens(BigInt(value) * 10n ** BigInt(TOKEN_DECIMALS))}
            </button>
          ))}
        </div>

        <fieldset className="trade-slippage">
          <legend>Max slippage</legend>
          {SLIPPAGE_CHOICES_BPS.map((bps) => (
            <label key={bps}>
              <input
                type="radio"
                name={`${id}-slippage`}
                checked={slippageBps === bps}
                onChange={() => setSlippageBps(bps)}
              />
              <span>{formatPercentBps(BigInt(bps))}</span>
            </label>
          ))}
        </fieldset>

        <div className="trade-result" aria-live="polite">
          {amount.trim() !== "" && units === null ? (
            <p className="trade-error">
              Use a plain number, e.g. {side === "buy" ? "0.5" : "1000000"}.
            </p>
          ) : result === null ? (
            <p className="trade-hint">
              Estimates use the program's curve math on a sample curve.
            </p>
          ) : !result.ok ? (
            <p className="trade-error">{ERROR_COPY[result.error]}</p>
          ) : result.side === "buy" ? (
            <dl>
              <div>
                <dt>You receive about</dt>
                <dd>
                  {formatTokens(result.tokensOut)} {token.symbol}
                </dd>
              </div>
              <div>
                <dt>Minimum after slippage</dt>
                <dd>
                  {formatTokens(result.minTokensOut)} {token.symbol}
                </dd>
              </div>
              <div>
                <dt>Into the curve</dt>
                <dd>{formatSol(result.curveQuote)}</dd>
              </div>
              <div>
                <dt>Beam fee (0.50%, selected policy)</dt>
                <dd>{formatSol(result.fee.total)}</dd>
              </div>
              <div className="trade-total">
                <dt>Total spend</dt>
                <dd>{formatSol(result.totalSpend)}</dd>
              </div>
              {result.fillsCurve && (
                <p className="trade-note">
                  This buys every remaining token and completes the sample
                  curve.
                </p>
              )}
            </dl>
          ) : (
            <dl>
              <div>
                <dt>Curve pays</dt>
                <dd>{formatSol(result.grossOutput)}</dd>
              </div>
              <div>
                <dt>Beam fee (0.50%, selected policy)</dt>
                <dd>{formatSol(result.fee.total)}</dd>
              </div>
              <div className="trade-total">
                <dt>You receive about</dt>
                <dd>{formatSol(result.netOutput)}</dd>
              </div>
              <div>
                <dt>Minimum after slippage</dt>
                <dd>{formatSol(result.minSolOutput)}</dd>
              </div>
            </dl>
          )}
          {result?.ok && (
            <details className="trade-fees">
              <summary>Fee breakdown</summary>
              <ul>
                <li>
                  Creator-selected wallet (0.35%):{" "}
                  {formatSol(result.fee.creator)}
                </li>
                <li>
                  Other community uses (0.07%):{" "}
                  {formatSol(result.fee.communityAfterCreator)}
                </li>
                <li>Treasury (0.05%): {formatSol(result.fee.treasury)}</li>
                <li>Founder (0.03%): {formatSol(result.fee.founder)}</li>
              </ul>
              <p>
                This is the owner-selected allocation, not live routing. The
                retained program still collects through the inherited fee path.
                Network fees are not included.
              </p>
            </details>
          )}
        </div>

        <button type="button" className="btn btn-primary trade-submit" disabled>
          Trading not live yet
        </button>
      </div>

      <div className="trade-curve" aria-label="Bonding curve">
        <div className="trade-curve-bar" aria-hidden="true">
          <span style={{ width: `${Number(summary.progressBps) / 100}%` }} />
        </div>
        <p>
          Bonding curve progress:{" "}
          <strong>{formatPercentBps(summary.progressBps)}</strong>
        </p>
        {summary.complete ? (
          <p>
            This sample curve is complete. Beam's selected, not-yet-merged path
            migrates its liquidity to Raydium AMM v4 and burns the LP Beam
            receives. That migration is not active in this preview.
          </p>
        ) : (
          <p>
            There are {formatTokens(summary.tokensAvailable)} {token.symbol}{" "}
            still available for sale in the bonding curve, and{" "}
            {formatSol(summary.solInCurve)} in it. Buying the rest takes about{" "}
            {formatSol(summary.solToComplete)} plus fees. When the curve sells
            out, Beam's selected, not-yet-merged path migrates its liquidity to
            Raydium AMM v4 and burns the LP Beam receives. That migration is not
            active in this preview.
          </p>
        )}
        <p className="trade-config-note">
          Sample configuration:{" "}
          {formatSol(SAMPLE_CURVE_CONFIG.initialVirtualSolReserves)} virtual,{" "}
          {formatTokens(SAMPLE_CURVE_CONFIG.initialRealTokenReserves)} tokens
          for sale. Beam's launch reserves are not configured yet.
        </p>
      </div>
    </section>
  );
}
