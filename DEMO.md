# CurveGuard Competition Demo

## Suggested 90-Second Demo

### 1. Introduction

CurveGuard is a pre-launch stress lab for Meteora Dynamic Bonding Curve configurations.

### 2. Browser UI

Show the upload area and the six built-in curve presets.

Explain:

A developer can upload an existing DBC configuration or instantly test one of six curve-building modes.

### 3. Select Liquidity Weights

Choose:

Liquidity Weights
Mode 3

Click Analyze Curve.

### 4. Dashboard

Show:

- Pipeline PASS
- Curve Type
- Config Risk
- Launch Stress
- Sequential Dynamic
- Dynamic Fee Range
- Max Volatility
- Dump Drawdown
- Precision Advisor

Explain:

The dashboard combines configuration validation, launch-state stress, persistent sequential simulation, dynamic-fee behavior and A/B comparison.

### 5. Safety

Scroll to Safety & Source Integrity.

Show that:

- the original config remains unchanged
- analysis uses a dry-run copy
- no transaction is created
- no transaction is signed
- no transaction is submitted

### 6. Builder Summary

Show:

Curve points: 16
Dynamic fee: ENABLED

Explain:

This demo uses Meteora's Liquidity Weights curve mode.

### 7. Developer Recommendations

Show the difference between setup and behavioral findings:

SETUP - Configure the fee claimer
SETUP - Configure the leftover receiver

REVIEW - Migration Pressure execution impact
REVIEW - Oversized Whale execution impact

Explain:

The behavioral recommendations are generated from actual stress-test findings rather than hard-coded demo text.

### 8. Closing

CurveGuard turns a DBC configuration into a repeatable workflow:

Configure -> Stress Test -> Understand -> Adjust -> Re-run
