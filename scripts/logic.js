export const BLFX_ID = 'boss-loot-assets-premium';
export const GPS_ID = 'gambits-premades';

const dealsDamage = activity => activity.type === 'attack' || activity.type === 'heal' || activity.damage?.parts?.length > 0;

// The BLFX triggers that animate an item use, and whether each one can fire for an activity.
// A match on a trigger that can never fire must not stop AA, or the item would go silent.
// deleteActiveEffects and destroyTemplate are left out: they only play when something ends.
const TRIGGER_CAN_FIRE = {
  afterItemUse: () => true,
  postUseActivity: () => true,
  afterRollSavingThrow: () => true,
  applyDamage: () => true,
  updateCombat: () => true,
  afterAttack: activity => activity.type === 'attack',
  afterThrown: activity => activity.type === 'attack',
  afterDamage: dealsDamage,
  createTemplate: activity => Boolean(activity.target?.template?.type),
  afterSummon: activity => activity.type === 'summon',
  afterRollFormula: activity => Boolean(activity.roll?.formula),
  afterActiveEffects: (_activity, item) => item.effects?.size > 0,
};

function activitiesFor(item, activity) {
  return activity ? [activity] : [...(item.system?.activities ?? [])];
}

export function hasHandmadeBlfx(executor, item, activity) {
  return activitiesFor(item, activity).some(candidate => Boolean(executor.getMacroScript(item, 'afterItemUse', candidate)));
}

export async function hasBlfxAutoRec(executor, item, activity) {
  for (const candidate of activitiesFor(item, activity)) {
    if (!executor.isAutoRecognitionEnabled(item, 'afterItemUse', candidate)) continue;
    for (const [trigger, canFire] of Object.entries(TRIGGER_CAN_FIRE)) {
      if (!canFire(candidate, item)) continue;
      const match = await executor.getAutoRecognitionAnimation({ item, activity: candidate, trigger });
      if (typeof match?.macro === 'function') return true;
    }
  }
  return false;
}

// 'on' or 'off' for an item that GPS animates itself, otherwise null.
// CAT does not see these animations: GPS uses a checkbox, not a selectAnimation config.
export function gpsAnimationState(item, catUtils) {
  const source = item.flags?.cat?.automation?.source;
  if (source && source !== GPS_ID) return null;
  const automation = catUtils?.getCurrentAutomation?.(item);
  const declared = item.flags?.[GPS_ID]?.itemConfig?.playAnimation ?? (automation?.source === GPS_ID ? automation.config?.playAnimation : undefined);
  if (!declared) return null;
  const value = catUtils?.getConfigValues?.(item, ['playAnimation'])?.playAnimation;
  return value === false ? 'off' : 'on';
}

// Mirrors the CAT check behind its On & Override setting, using its public utils.
// CAT also counts generic macros, but that lookup is not public. CAT still stops AA for those items.
export function catOwnsAnimation(item, catUtils, priority) {
  if (priority !== 'cat' || !catUtils) return false;
  const config = catUtils.getCurrentAutomation?.(item)?.config ?? {};
  const hasSelected = Object.entries(config).some(
    ([key, option]) => option?.type === 'selectAnimation' && catUtils.getResolvedAnimation?.(item, key)?.animation
  );
  return hasSelected || Boolean(item.effects?.some(effect => effect.flags?.cat?.animation));
}

export function isAaCustomized(item, activity) {
  return Boolean(activity?.flags?.autoanimations?.isCustomized || item.flags?.autoanimations?.isCustomized);
}

// In-memory only, like CAT's own override: the change is never saved to the item.
function setBlfxAutoRec(item, activity, enabled) {
  const flags = (item.flags[BLFX_ID] ??= {});
  const entry = (flags[activity.id] ??= {});
  entry.autoRec = { ...entry.autoRec, enabled };
}

// Runs just before an item is used, so that BLFX and AA read the adjusted flags.
export function prepareItemUse(activity, deps) {
  const item = activity?.item;
  if (!item?.flags) return;
  const gps = gpsAnimationState(item, deps.catUtils);

  if (gps === 'off' && deps.gpsFallback()) {
    setBlfxAutoRec(item, activity, true);
    if (item.flags.autoanimations?.isEnabled === false) item.flags.autoanimations.isEnabled = true;
    return;
  }
  if (hasHandmadeBlfx(deps.executor, item, activity)) return;
  if (gps === 'on' || catOwnsAnimation(item, deps.catUtils, deps.catPriority())) {
    setBlfxAutoRec(item, activity, false);
  } else if (deps.aaCustomWins() && isAaCustomized(item, activity)) {
    setBlfxAutoRec(item, activity, false);
  }
}

// Returns which engine other than AA takes this item use, or null to leave it with AA.
export async function chooseOverAa(item, activity, deps) {
  if (!item.isEmbedded) return null;
  if (gpsAnimationState(item, deps.catUtils) === 'on') return 'GPS';
  if (hasHandmadeBlfx(deps.executor, item, activity)) return 'BLFX';
  if (deps.aaCustomWins() && isAaCustomized(item, activity)) return null;
  return (await hasBlfxAutoRec(deps.executor, item, activity)) ? 'BLFX' : null;
}

// Any failure leaves AA running: a double animation is better than a missing one.
export async function resolveWorkflow(data, animationData, deps) {
  const { item, activity } = data;
  let engine = null;
  try {
    engine = await chooseOverAa(item, activity, deps);
  } catch (error) {
    console.warn('blfx-aa-bridge | Lookup failed, leaving this item with AA', item.name, error);
  }
  if (engine) data.stopWorkflow = true;
  deps.log(`${item.name} -> ${engine ?? (animationData ? 'AA' : 'no AA match')}`);
}
