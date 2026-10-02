import BN from "bn.js";

import {
  buildCurve,
  buildCurveWithMarketCap,
  buildCurveWithTwoSegments,
  buildCurveWithLiquidityWeights,
  buildCurveWithMidPrice,
  buildCurveWithCustomSqrtPrices,
  createSqrtPrices
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const CURVE_MODES = Object.freeze({
  0: "STANDARD_QUOTE_THRESHOLD",
  1: "MARKET_CAP",
  2: "TWO_SEGMENT",
  3: "LIQUIDITY_WEIGHTS",
  4: "MID_PRICE",
  5: "CUSTOM_PRICES"
});

export function getCurveModeName(mode) {
  return CURVE_MODES[Number(mode)] ??
    "UNKNOWN";
}

function requireNumber(
  value,
  field,
  options = {}
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    throw new Error(
      `${field} must be a finite number.`
    );
  }

  if (
    options.positive &&
    n <= 0
  ) {
    throw new Error(
      `${field} must be > 0.`
    );
  }

  return n;
}

function requirePercent(
  value,
  field
) {
  const n =
    requireNumber(
      value,
      field
    );

  if (n < 0 || n > 100) {
    throw new Error(
      `${field} must be between 0 and 100.`
    );
  }

  return n;
}

function requireArray(
  value,
  field,
  minLength = 1
) {
  if (
    !Array.isArray(value) ||
    value.length < minLength
  ) {
    throw new Error(
      `${field} must contain at least ${minLength} item(s).`
    );
  }

  return value;
}

/*
 * Removes CurveGuard-only / builder-specific fields.
 *
 * The returned object contains the fields shared by
 * Meteora buildCurve* helpers:
 *
 * token
 * fee
 * migration
 * liquidityDistribution
 * lockedVesting
 * activationType
 */
function getCommonParams(dbc) {
  const {
    buildCurveMode,
    feeClaimer,
    leftoverReceiver,

    percentageSupplyOnMigration,
    migrationQuoteThreshold,

    initialMarketCap,
    migrationMarketCap,

    midPrice,

    liquidityWeights,

    prices,
    sqrtPrices,

    ...common
  } = dbc;

  return common;
}

function normalizeWeights(
  weights
) {
  return requireArray(
    weights,
    "liquidityWeights"
  ).map((x, i) => {
    const n =
      requireNumber(
        x,
        `liquidityWeights[${i}]`,
        { positive: true }
      );

    return n;
  });
}

function normalizeHumanPrices(
  prices
) {
  const out =
    requireArray(
      prices,
      "prices",
      2
    ).map((x, i) =>
      requireNumber(
        x,
        `prices[${i}]`,
        { positive: true }
      )
    );

  for (
    let i = 1;
    i < out.length;
    i++
  ) {
    if (
      out[i] <= out[i - 1]
    ) {
      throw new Error(
        "prices must be strictly ascending."
      );
    }
  }

  return out;
}

function normalizeRawSqrtPrices(
  values
) {
  const list =
    requireArray(
      values,
      "sqrtPrices",
      2
    );

  const out =
    list.map((x, i) => {
      try {
        return BN.isBN(x)
          ? x
          : new BN(String(x));
      } catch {
        throw new Error(
          `sqrtPrices[${i}] is not a valid integer.`
        );
      }
    });

  for (
    let i = 1;
    i < out.length;
    i++
  ) {
    if (
      out[i].lte(out[i - 1])
    ) {
      throw new Error(
        "sqrtPrices must be strictly ascending."
      );
    }
  }

  return out;
}

/*
 * Universal CurveGuard -> Meteora builder dispatcher.
 */
export function buildCurveFromConfig(
  dbc
) {
  if (
    !dbc ||
    typeof dbc !== "object"
  ) {
    throw new Error(
      "dbcConfig is missing."
    );
  }

  const mode =
    Number(
      dbc.buildCurveMode ?? 0
    );

  if (
    !Number.isInteger(mode) ||
    mode < 0 ||
    mode > 5
  ) {
    throw new Error(
      `Unsupported buildCurveMode=${dbc.buildCurveMode}. Expected 0..5.`
    );
  }

  const common =
    getCommonParams(dbc);

  switch (mode) {

    /*
     * Standard single-segment DBC:
     * migration quote threshold +
     * percentage supply at migration.
     */
    case 0: {
      const percentageSupplyOnMigration =
        requirePercent(
          dbc.percentageSupplyOnMigration,
          "percentageSupplyOnMigration"
        );

      const migrationQuoteThreshold =
        requireNumber(
          dbc.migrationQuoteThreshold,
          "migrationQuoteThreshold",
          { positive: true }
        );

      return buildCurve({
        ...common,
        percentageSupplyOnMigration,
        migrationQuoteThreshold
      });
    }

    /*
     * Build from initial and migration
     * market capitalisation.
     */
    case 1: {
      const initialMarketCap =
        requireNumber(
          dbc.initialMarketCap,
          "initialMarketCap",
          { positive: true }
        );

      const migrationMarketCap =
        requireNumber(
          dbc.migrationMarketCap,
          "migrationMarketCap",
          { positive: true }
        );

      if (
        migrationMarketCap <=
        initialMarketCap
      ) {
        throw new Error(
          "migrationMarketCap must be greater than initialMarketCap."
        );
      }

      return buildCurveWithMarketCap({
        ...common,
        initialMarketCap,
        migrationMarketCap
      });
    }

    /*
     * Two-segment curve.
     */
    case 2: {
      const initialMarketCap =
        requireNumber(
          dbc.initialMarketCap,
          "initialMarketCap",
          { positive: true }
        );

      const migrationMarketCap =
        requireNumber(
          dbc.migrationMarketCap,
          "migrationMarketCap",
          { positive: true }
        );

      const percentageSupplyOnMigration =
        requirePercent(
          dbc.percentageSupplyOnMigration,
          "percentageSupplyOnMigration"
        );

      if (
        migrationMarketCap <=
        initialMarketCap
      ) {
        throw new Error(
          "migrationMarketCap must be greater than initialMarketCap."
        );
      }

      return buildCurveWithTwoSegments({
        ...common,
        initialMarketCap,
        migrationMarketCap,
        percentageSupplyOnMigration
      });
    }

    /*
     * Multi-segment curve controlled
     * by liquidity weights.
     */
    case 3: {
      const initialMarketCap =
        requireNumber(
          dbc.initialMarketCap,
          "initialMarketCap",
          { positive: true }
        );

      const migrationMarketCap =
        requireNumber(
          dbc.migrationMarketCap,
          "migrationMarketCap",
          { positive: true }
        );

      if (
        migrationMarketCap <=
        initialMarketCap
      ) {
        throw new Error(
          "migrationMarketCap must be greater than initialMarketCap."
        );
      }

      const liquidityWeights =
        normalizeWeights(
          dbc.liquidityWeights
        );

      if (
        liquidityWeights.length !== 16
      ) {
        throw new Error(
          "LIQUIDITY_WEIGHTS mode requires exactly 16 liquidityWeights."
        );
      }

      return buildCurveWithLiquidityWeights({
        ...common,
        initialMarketCap,
        migrationMarketCap,
        liquidityWeights
      });
    }

    /*
     * Two-segment curve with an
     * explicitly selected mid price.
     */
    case 4: {
      const initialMarketCap =
        requireNumber(
          dbc.initialMarketCap,
          "initialMarketCap",
          { positive: true }
        );

      const migrationMarketCap =
        requireNumber(
          dbc.migrationMarketCap,
          "migrationMarketCap",
          { positive: true }
        );

      const midPrice =
        requireNumber(
          dbc.midPrice,
          "midPrice",
          { positive: true }
        );

      const percentageSupplyOnMigration =
        requirePercent(
          dbc.percentageSupplyOnMigration,
          "percentageSupplyOnMigration"
        );

      if (
        migrationMarketCap <=
        initialMarketCap
      ) {
        throw new Error(
          "migrationMarketCap must be greater than initialMarketCap."
        );
      }

      const supply =
        requireNumber(
          dbc.token?.totalTokenSupply,
          "token.totalTokenSupply",
          { positive: true }
        );

      const initialPrice =
        initialMarketCap / supply;

      const migrationPrice =
        migrationMarketCap / supply;

      if (
        midPrice <= initialPrice ||
        midPrice >= migrationPrice
      ) {
        throw new Error(
          `midPrice must be between ${initialPrice} and ${migrationPrice}.`
        );
      }

      return buildCurveWithMidPrice({
        ...common,
        initialMarketCap,
        migrationMarketCap,
        midPrice,
        percentageSupplyOnMigration
      });
    }

    /*
     * Fully custom price segmentation.
     *
     * CurveGuard accepts either:
     *
     * 1. human-readable "prices"
     * 2. raw integer "sqrtPrices"
     *
     * Human prices are converted through
     * Meteora's own createSqrtPrices().
     */
    case 5: {
      let sqrtPrices;

      if (
        Array.isArray(
          dbc.sqrtPrices
        )
      ) {
        sqrtPrices =
          normalizeRawSqrtPrices(
            dbc.sqrtPrices
          );

      } else {
        const prices =
          normalizeHumanPrices(
            dbc.prices
          );

        sqrtPrices =
          createSqrtPrices(
            prices,
            dbc.token.tokenBaseDecimal,
            dbc.token.tokenQuoteDecimal
          );
      }

      let liquidityWeights;

      if (
        dbc.liquidityWeights !==
        undefined
      ) {
        liquidityWeights =
          normalizeWeights(
            dbc.liquidityWeights
          );

        if (
          liquidityWeights.length !==
          sqrtPrices.length - 1
        ) {
          throw new Error(
            "For CUSTOM_PRICES, liquidityWeights.length must equal sqrtPrices.length - 1."
          );
        }
      }

      return buildCurveWithCustomSqrtPrices({
        ...common,
        sqrtPrices,
        ...(liquidityWeights
          ? { liquidityWeights }
          : {})
      });
    }

    default:
      throw new Error(
        `Unhandled buildCurveMode=${mode}.`
      );
  }
}