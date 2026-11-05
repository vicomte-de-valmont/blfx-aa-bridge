# BLFX-AA Bridge

A Foundry VTT module for D&D 5e that plays one animation per item use. It uses Boss Loot's BLFX as the main animation engine and falls back on Automated Animations (AA) where BLFX has nothing. BLFX is not included: you need your own copy of BLFX Animation Editor Premium.

## Install

In Foundry's setup screen, go to **Add-on Modules → Install Module** and paste this into **Manifest URL**:

```
https://github.com/vicomte-de-valmont/blfx-aa-bridge/releases/latest/download/module.json
```

## Order

The first rule that applies decides who animates:

1. **CAT/GPS:** CPR items with a CAT animation, and Gambit's Premades items with Play Animation on.
2. **Hand-made BLFX animation** on the item.
3. **Customized AA item config**, only if that setting is on.
4. **BLFX Custom Auto-Rec**, then **BLFX built-in auto-rec**.
5. **AA auto-rec.**

The bridge asks BLFX's own lookup at runtime, so entries added by BLFX updates take over from AA with nothing to maintain.

## Recommended settings

| Module | Setting | Value |
|---|---|---|
| CAT | CAT Animations | On & Override |
| BLFX | BLFX Auto Recognition | On |
| AA | Disable Automatic Recognition | Off |

## Bridge settings

- **GPS item with Play Animation off falls back** (default on): lets BLFX, then AA, animate that item instead of leaving it silent.
- **Customized AA item beats BLFX auto-rec** (default off).
- **Debug log** (default off): writes the engine chosen for each item use to the browser console.

## Limits

- It only handles item use. Conditions and effects can still animate twice, so pick either BLFX's Status Condition Animation or AA's Active Effects auto-rec for those.
- A hand-made BLFX animation on an item that CAT or GPS also animates plays alongside them. Set the CAT animation to None, or untick Play Animation.
- It reads BLFX's internal `BlfxMacroExecutor.js`, which is not a public API. If a BLFX update changes it, the GM gets a warning and AA plays alongside BLFX until the bridge is updated.

## Development

```bash
npm test
```
