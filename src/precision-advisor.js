import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

function clone(value) {
  return structuredClone(value);
}

function unitsToTokenNumber(
  units,
  decimals
) {
  const scale =
    10n ** BigInt(decimals);

  const whole =
    units / scale;

  const fraction =
    units % scale;

  if (fraction === 0n) {
    return Number(
      whole.toString()
    );
  }

  const fractionText =
    fraction
      .toString()
      .padStart(
        decimals,
        "0"
      )
      .replace(
        /0+$/,
        ""
      );

  return Number(
    `${whole.toString()}.${fractionText}`
  );
}

function tokenNumberToUnits(
  value,
  decimals
) {
  const text =
    Number(value || 0)
      .toFixed(decimals);

  const [
    whole,
    fraction = ""
  ] = text.split(".");

  const scale =
    10n ** BigInt(decimals);

  return (
    BigInt(whole || "0") *
      scale +
    BigInt(
      fraction
        .padEnd(decimals, "0")
        .slice(0, decimals) ||
      "0"
    )
  );
}

function tryBuild(
  dbc,
  leftover
) {
  const candidate =
    clone(dbc);

  candidate.token =
    clone(candidate.token);

  candidate.token.leftover =
    leftover;

  try {
    const built =
      buildCurveFromConfig(
        candidate
      );

    return {
      ok: true,
      built
    };

  } catch (err) {
    return {
      ok: false,

      error:
        err?.message ||
        String(err)
    };
  }
}

function isPrecisionError(
  message
) {
  return String(
    message || ""
  ).includes(
    "leftOverDelta must be less than totalLeftover"
  );
}

/*
 * Finds the smallest leftover,
 * measured in actual base-token units,
 * that makes the Meteora builder pass.
 *
 * It NEVER mutates the supplied config.
 */
export function advisePrecisionBuffer(
  dbc,
  options = {}
) {
  const mode =
    Number(
      dbc?.buildCurveMode ?? 0
    );

  const decimals =
    Number(
      dbc?.token
        ?.tokenBaseDecimal
    );

  const supply =
    Number(
      dbc?.token
        ?.totalTokenSupply
    );

  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    return {
      status:
        "INVALID_CONFIG",

      mode,

      modeName:
        getCurveModeName(mode),

      error:
        "Invalid tokenBaseDecimal."
    };
  }

  if (
    !Number.isFinite(supply) ||
    supply <= 0
  ) {
    return {
      status:
        "INVALID_CONFIG",

      mode,

      modeName:
        getCurveModeName(mode),

      error:
        "Invalid totalTokenSupply."
    };
  }

  const originalLeftover =
    Number(
      dbc?.token?.leftover ?? 0
    );

  /*
   * First respect exactly what
   * the user supplied.
   */
  const originalTest =
    tryBuild(
      dbc,
      originalLeftover
    );

  if (originalTest.ok) {
    return {
      status:
        "NO_BUFFER_NEEDED",

      mode,

      modeName:
        getCurveModeName(mode),

      originalLeftover,

      recommendedLeftover:
        originalLeftover,

      addedLeftover:
        0,

      percentageOfSupply:
        supply > 0
          ? (
              originalLeftover /
              supply
            ) * 100
          : 0
    };
  }

  /*
   * Precision Advisor only handles
   * this specific Meteora rounding
   * condition.
   *
   * Other builder errors must remain
   * visible and must not be hidden.
   */
  if (
    !isPrecisionError(
      originalTest.error
    )
  ) {
    return {
      status:
        "NON_PRECISION_ERROR",

      mode,

      modeName:
        getCurveModeName(mode),

      originalLeftover,

      error:
        originalTest.error
    };
  }

  const originalUnits =
    tokenNumberToUnits(
      originalLeftover,
      decimals
    );

  /*
   * Never automatically recommend
   * more than this percentage of
   * total supply.
   *
   * Default: 0.01%
   */
  const maxPercentOfSupply =
    Number(
      options.maxPercentOfSupply
      ?? 0.01
    );

  const scale =
    10n ** BigInt(decimals);

  const supplyUnits =
    BigInt(
      Math.trunc(supply)
    ) * scale;

  const ppm =
    BigInt(
      Math.max(
        1,
        Math.round(
          maxPercentOfSupply *
          10000
        )
      )
    );

  /*
   * percent -> parts per million.
   *
   * Example:
   * 0.01% = 100 ppm.
   */
  const maxAddedUnits =
    supplyUnits *
    ppm /
    1_000_000n;

  let low =
    originalUnits;

  let high =
    originalUnits + 1n;

  let passingHigh =
    null;

  /*
   * Exponential search.
   */
  while (
    high - originalUnits <=
    maxAddedUnits
  ) {
    const candidate =
      unitsToTokenNumber(
        high,
        decimals
      );

    const result =
      tryBuild(
        dbc,
        candidate
      );

    if (result.ok) {
      passingHigh =
        high;

      break;
    }

    if (
      !isPrecisionError(
        result.error
      )
    ) {
      return {
        status:
          "NON_PRECISION_ERROR",

        mode,

        modeName:
          getCurveModeName(mode),

        originalLeftover,

        error:
          result.error
      };
    }

    low =
      high;

    high =
      originalUnits +
      (
        high -
        originalUnits
      ) * 2n;
  }

  if (
    passingHigh === null
  ) {
    return {
      status:
        "BUFFER_TOO_LARGE",

      mode,

      modeName:
        getCurveModeName(mode),

      originalLeftover,

      maxPercentOfSupply,

      error:
        "Required precision buffer exceeded CurveGuard advisory safety limit."
    };
  }

  /*
   * Binary-search down to one
   * smallest token unit.
   */
  let left =
    low + 1n;

  let right =
    passingHigh;

  while (
    left < right
  ) {
    const mid =
      (
        left +
        right
      ) >> 1n;

    const candidate =
      unitsToTokenNumber(
        mid,
        decimals
      );

    const result =
      tryBuild(
        dbc,
        candidate
      );

    if (result.ok) {
      right =
        mid;
    } else {
      if (
        !isPrecisionError(
          result.error
        )
      ) {
        return {
          status:
            "NON_PRECISION_ERROR",

          mode,

          modeName:
            getCurveModeName(mode),

          originalLeftover,

          error:
            result.error
        };
      }

      left =
        mid + 1n;
    }
  }

  const recommendedUnits =
    left;

  const recommendedLeftover =
    unitsToTokenNumber(
      recommendedUnits,
      decimals
    );

  const addedLeftover =
    recommendedLeftover -
    originalLeftover;

  /*
   * Final verification.
   */
  const finalCheck =
    tryBuild(
      dbc,
      recommendedLeftover
    );

  if (!finalCheck.ok) {
    return {
      status:
        "ADVISOR_INTERNAL_ERROR",

      mode,

      modeName:
        getCurveModeName(mode),

      originalLeftover,

      recommendedLeftover,

      error:
        finalCheck.error
    };
  }

  return {
    status:
      "PRECISION_BUFFER_RECOMMENDED",

    mode,

    modeName:
      getCurveModeName(mode),

    originalLeftover,

    recommendedLeftover,

    addedLeftover,

    smallestTokenUnit:
      unitsToTokenNumber(
        1n,
        decimals
      ),

    recommendedBaseUnits:
      recommendedUnits
        .toString(),

    percentageOfSupply:
      (
        recommendedLeftover /
        supply
      ) * 100,

    configWasModified:
      false
  };
}