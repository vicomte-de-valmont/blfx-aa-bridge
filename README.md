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

## Order for effects and conditions

This applies when an effect starts on a token:

1. **CAT/GPS:** the effect has a CAT animation, or its source item is animated by CAT or GPS.
2. **BLFX** has an effect animation for the source item.
3. **BLFX Status Condition Animation:** the effect has no source item and is a condition BLFX knows, with that setting on.
4. **AA Active Effects auto-rec.**

A spell's cast and its lingering effect are decided separately, so BLFX can play the cast and AA the effect.

## CPR spells with only a generic cast animation

CAT's item check can't see CPR's generic cast animations, such as the ones on Haste and Burning Hands. Those spells aren't fully owned by CAT:

| Type of spell | Example | Who animates |
|---|---|---|
| CAT has its own effect or spell animation | Bless, Shield of Faith | CAT only |
| CAT only has a generic cast animation | Haste, Burning Hands | BLFX at the effect or template, plus CAT's cast if it gets to play |

To use only BLFX on a spell like this, set its CAT animation to None in CatKit.

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

- BLFX's list of condition animations can't be read at runtime, so the bridge has its own copy. If BLFX adds a condition, AA keeps playing it too until the bridge is updated.
- The bridge's switches stay in memory until the item next updates. If you open BLFX's Animation Editor on a CAT or GPS item after using it and press Save, auto-rec can be stored as off.
- A hand-made BLFX animation on an item that CAT or GPS also animates plays alongside them. Set the CAT animation to None, or untick Play Animation.
- It reads BLFX's internal `BlfxMacroExecutor.js`, which is not a public API, and follows BLFX's steps for finding an effect's source item. If a BLFX update changes these, AA can play alongside BLFX until the bridge is updated. If the file itself changes, the GM also gets a warning.

## Development

```bash
npm test
```
