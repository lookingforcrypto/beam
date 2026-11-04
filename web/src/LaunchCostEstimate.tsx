import "./launchCost.css";
import { launchCost, lamportsToSol } from "./launchCost";

/**
 * Live estimate of what a create_v2 launch would cost the creator, from
 * rent measured in a local test bank. The preview never creates a token.
 */
export function LaunchCostEstimate({
  name,
  symbol,
  uri,
}: {
  name: string;
  symbol: string;
  uri: string;
}) {
  const cost = launchCost(name, symbol, uri);
  return (
    <div className="launch-cost" aria-live="polite">
      <strong>Estimated launch cost</strong>
      {cost ? (
        <>
          <p>
            <span className="launch-cost-total">
              {lamportsToSol(cost.accountRent)}
            </span>{" "}
            in account rent, plus about {lamportsToSol(cost.networkFee)} in
            network fees (two signatures; priority fees extra).
          </p>
          <ul>
            <li>
              Token mint with on-mint metadata ({cost.mintBytes} bytes):{" "}
              {lamportsToSol(cost.mintRent)}
            </li>
            <li>Bonding curve account: {lamportsToSol(cost.curveRent)}</li>
            <li>
              Curve token account: {lamportsToSol(cost.curveTokenAccountRent)}
            </li>
          </ul>
          <p className="launch-cost-note">
            Rent stays in the new accounts; it is not a Beam fee. Measured from
            create_v2 in a local test bank with default rent. This preview does
            not create a token.
          </p>
        </>
      ) : (
        <p>Shorten the name, symbol or URI to see an estimate.</p>
      )}
    </div>
  );
}
