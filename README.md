# CurveGuard

**Pre-Launch Stress Lab for Meteora Dynamic Bonding Curve (DBC)**

CurveGuard is developer tooling for inspecting and stress-testing a Meteora DBC configuration before launch.

## Competition Edition

The browser interface lets a user:

1. Upload a .json or .jsonc DBC config, or select a built-in demo.
2. Click Analyze Curve.
3. Receive a unified stress-test dashboard.

No wallet or private key is required.

## Supported Curve Modes

| Mode | Curve Type |
|---|---|
| 0 | Standard Quote Threshold |
| 1 | Market Cap |
| 2 | Two Segment |
| 3 | Liquidity Weights |
| 4 | Mid Price |
| 5 | Custom Prices |

## Analysis Pipeline

DBC Config
-> Config Inspector
-> Precision Advisor
-> Universal Meteora Curve Builder
-> Launch-State Stress Test
-> Sequential Base-Fee Simulation
-> Sequential Dynamic-Fee Simulation
-> A/B Comparison
-> Developer Recommendations
-> HTML + JSON Report

## Key Features

- Six Meteora DBC curve-building modes
- Precision Advisor
- Launch-state stress testing
- Persistent sequential market simulation
- Dynamic-fee volatility simulation
- Base vs Dynamic A/B comparison
- Structured Developer Recommendations
- Browser upload interface
- Six built-in demo presets

## Quick Start

Install dependencies:

    npm install

Start Competition Edition:

    npm run web

Then open:

    http://127.0.0.1:8787

Direct analysis:

    npm run analyze -- config/dbc_config.jsonc

## Safety

CurveGuard Competition Edition:

- does not require a wallet
- does not require private keys
- does not create transactions
- does not sign transactions
- does not submit transactions
- analyzes a dry-run copy
- verifies that the source configuration remains unchanged

## Testing

- 6/6 Universal Curve Builder modes
- 4/4 Precision Advisor fixtures
- 12/12 sequential stress combinations
- 6/6 launch-stress modes
- end-to-end One-Click Analyzer

## Important Limitation

CurveGuard is an engineering and pre-launch diagnostic tool.
It is not an official Meteora protocol rating, financial advice, or a prediction of token performance.

## Built for Meteora DBC

CurveGuard was built as developer tooling around Meteora Dynamic Bonding Curve to help builders configure, stress-test, understand, adjust and re-test launch configurations before deployment.
