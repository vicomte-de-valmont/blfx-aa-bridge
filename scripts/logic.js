export const BLFX_ID = 'boss-loot-assets-premium';
export const GPS_ID = 'gambits-premades';

const EFFECT_TRIGGER = 'afterActiveEffects';
const EFFECT_EVENT_TYPE = 'After Active Effects';

// BLFX keeps this list inside addConditionAnimation, where it cannot be read at runtime.
// If BLFX adds a condition, AA keeps playing it too until the name is added here.
const BLFX_CONDITIONS = new Set([
  'blinded',
  'charmed',
  'confused',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'restrained',
  'paralyzed',
  'petrified',
  'poisoned',
  'silenced',
  'stunned',
  'unconscious',
]);

const isItem = document => document?.documentName === 'Item';

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

// dnd5e runs preUseActivity on a temporary copy of the item. BLFX and AA read that copy during
// the use, but the real item once a template or effect appears, so both need the change.
function itemVersions(item) {
  const real = item.actor?.items?.get(item.id);
  return real && real !== item ? [item, real] : [item];
}

// In-memory only, like CAT's own override: the change is never saved to the item.
function setBlfxAutoRec(item, activity, enabled) {
  for (const version of itemVersions(item)) {
    const flags = (version.flags[BLFX_ID] ??= {});
    const entry = (flags[activity.id] ??= {});
    entry.autoRec = { ...entry.autoRec, enabled };
  }
}

function enableAa(item) {
  for (const version of itemVersions(item)) {
    if (version.flags.autoanimations?.isEnabled === false) version.flags.autoanimations.isEnabled = true;
  }
}

// Runs just before an item is used, so that BLFX and AA read the adjusted flags.
export function prepareItemUse(activity, deps) {
  const item = activity?.item;
  if (!item?.flags) return;
  const gps = gpsAnimationState(item, deps.catUtils);

  if (gps === 'off' && deps.gpsFallback()) {
    setBlfxAutoRec(item, activity, true);
    enableAa(item);
    return;
  }
  if (hasHandmadeBlfx(deps.executor, item, activity)) return;
  if (gps === 'on' || catOwnsAnimation(item, deps.catUtils, deps.catPriority())) {
    setBlfxAutoRec(item, activity, false);
  } else if (deps.aaCustomWins() && isAaCustomized(item, activity)) {
    setBlfxAutoRec(item, activity, false);
  }
}

// Runs just before an effect is created. When a player casts, the GM's client often creates the
// effect, and that client never ran prepareItemUse. This has to stay synchronous.
export function prepareEffectCreation(effect, deps) {
  const uuid = effect.system?.origin?.activity ?? effect.system?.origin?.item ?? effect._source?.origin;
  const origin = uuid ? deps.fromUuidSync(uuid) : null;
  const item = isItem(origin?.item) ? origin.item : isItem(origin) ? origin : null;
  if (!item?.flags) return;
  if (gpsAnimationState(item, deps.catUtils) !== 'on' && !catOwnsAnimation(item, deps.catUtils, deps.catPriority())) return;
  for (const activity of isItem(origin) ? (item.system?.activities ?? []) : [origin]) {
    if (!hasHandmadeBlfx(deps.executor, item, activity)) setBlfxAutoRec(item, activity, false);
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

// Follows the same steps as getItem in BLFX's hooks.js, which is not exported.
// BLFX skips concentration effects, and treats an effect with no item as a possible condition.
async function findEffectSourceItem(effect, fromUuid) {
  if (effect.statuses?.has('concentrating')) return null;
  const originUuid = effect.system?.origin?.activity ?? effect.system?.origin?.item ?? effect._source?.origin;
  const origin = originUuid ? await fromUuid(originUuid) : null;
  if (isItem(origin?.item)) return origin.item;
  const parent = origin?.parent;
  if (isItem(parent)) return parent;
  if (isItem(origin)) return origin;
  if (parent?.documentName === 'Actor') {
    const sourceItem = origin._source?.origin ? await fromUuid(origin._source.origin) : null;
    return isItem(sourceItem) ? sourceItem : (parent.items?.getName?.(effect.name) ?? null);
  }
  if (parent?.documentName === 'ActiveEffect') {
    const sourceItem = await parent.getSource?.();
    return isItem(sourceItem) ? sourceItem : null;
  }
  const customUuid = effect.flags?.[BLFX_ID]?.blfxCustom?.originItem;
  const customItem = customUuid ? await fromUuid(customUuid) : null;
  return isItem(customItem) ? customItem : null;
}

// Follows the same steps as getActivity in BLFX's hooks.js.
async function findEffectActivity(item, effect, fromUuid) {
  const uuid = effect.system?.origin?.activity;
  if (uuid) return fromUuid(uuid);
  for (const activity of item.system?.activities ?? []) {
    if (activity.effects?.some(entry => entry.effect?.name === effect.name)) return activity;
  }
  const customUuid = effect.flags?.[BLFX_ID]?.blfxCustom?.originActivity;
  return customUuid ? fromUuid(customUuid) : null;
}

function blfxPlaysCondition(effect) {
  const slug = effect.name?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).join('-');
  return BLFX_CONDITIONS.has(effect.statuses?.first?.() ?? slug);
}

// Returns which engine other than AA takes this effect, or null to leave it with AA.
// Mirrors what BLFX does when an effect is created, so a null here means BLFX plays nothing.
export async function chooseOverAaForEffect(effect, deps) {
  if (deps.catPriority() === 'cat' && effect.flags?.cat?.animation) return 'CAT';

  const item = await findEffectSourceItem(effect, deps.fromUuid);
  if (!item) return deps.blfxConditions() && blfxPlaysCondition(effect) ? 'BLFX' : null;

  if (gpsAnimationState(item, deps.catUtils) === 'on') return 'GPS';
  if (catOwnsAnimation(item, deps.catUtils, deps.catPriority())) return 'CAT';
  if (!item.isEmbedded) return null;

  const activity = await findEffectActivity(item, effect, deps.fromUuid);
  if (deps.executor.getMacroScript(item, EFFECT_TRIGGER, activity)) {
    if (!activity) return 'BLFX';
    const flags = item.flags[BLFX_ID];
    const eventType = flags[activity.id]?.eventType ?? flags[activity.name]?.eventType;
    return eventType === EFFECT_EVENT_TYPE ? 'BLFX' : null;
  }
  if (deps.aaCustomWins() && isAaCustomized(effect)) return null;
  if (!activity || !deps.executor.isAutoRecognitionEnabled(item, EFFECT_TRIGGER, activity)) return null;
  const match = await deps.executor.getAutoRecognitionAnimation({ item, activity, trigger: EFFECT_TRIGGER });
  return typeof match?.macro === 'function' ? 'BLFX' : null;
}

// Any failure leaves AA running: a double animation is better than a missing one.
async function resolve(data, label, animationData, deps, choose) {
  let engine = null;
  try {
    engine = await choose();
  } catch (error) {
    console.warn(`blfx-aa-bridge | Lookup failed, leaving ${label} with AA`, error);
  }
  if (engine) data.stopWorkflow = true;
  // After the await, every other hook has run, so a stop we did not set came from CAT.
  deps.log(`${label} -> ${engine ?? (data.stopWorkflow ? 'CAT' : animationData ? 'AA' : 'no AA match')}`);
}

export function resolveWorkflow(data, animationData, deps) {
  return resolve(data, data.item.name, animationData, deps, () => chooseOverAa(data.item, data.activity, deps));
}

export function resolveEffectWorkflow(data, animationData, deps) {
  return resolve(data, `Effect ${data.item.name}`, animationData, deps, () => chooseOverAaForEffect(data.item, deps));
}
