import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseOverAa,
  chooseOverAaForEffect,
  gpsAnimationState,
  prepareEffectCreation,
  prepareItemUse,
  resolveEffectWorkflow,
  resolveWorkflow,
  BLFX_ID,
  GPS_ID,
} from '../scripts/logic.js';

// Same lookup rules as BlfxMacroExecutor, driven by a small map of item name -> triggers.
function fakeExecutor(map = {}) {
  return {
    getMacroScript: (item, _trigger, activity) => item.flags[BLFX_ID]?.[activity.id]?.command,
    isAutoRecognitionEnabled: (item, _trigger, activity) => item.flags[BLFX_ID]?.[activity.id]?.autoRec?.enabled ?? true,
    getAutoRecognitionAnimation: async ({ item, trigger }) => map[item.name]?.[trigger] ?? null,
  };
}

const play = () => {};

function makeItem({ name = 'Test', flags = {}, activityType = 'attack', effects = 0, extra = {} } = {}) {
  const activity = { id: 'act1', type: activityType, ...extra };
  const item = { name, flags, isEmbedded: true, effects: { size: effects, some: () => false }, system: { activities: [activity] } };
  activity.item = item;
  return { item, activity };
}

function makeDeps(overrides = {}) {
  return {
    executor: fakeExecutor(),
    catUtils: undefined,
    catPriority: () => 'cat',
    gpsFallback: () => true,
    aaCustomWins: () => false,
    log: () => {},
    ...overrides,
  };
}

// Flag shape copied from the GPS Fireball item.
const gpsFlags = () => ({
  autoanimations: { isEnabled: false, isCustomized: false },
  cat: { automation: { source: GPS_ID, version: '3.0.1' } },
  [GPS_ID]: { itemConfig: { playAnimation: { type: 'checkbox', default: true } } },
  [BLFX_ID]: { act1: { autoRec: { enabled: false }, version: 2 } },
});

test('BLFX auto-rec match takes the item from AA', async () => {
  const { item, activity } = makeItem({ name: 'Longsword' });
  const deps = makeDeps({ executor: fakeExecutor({ Longsword: { afterAttack: { macro: play } } }) });
  assert.equal(await chooseOverAa(item, activity, deps), 'BLFX');
});

test('no BLFX match leaves the item with AA', async () => {
  const { item, activity } = makeItem({ name: 'Gore' });
  assert.equal(await chooseOverAa(item, activity, makeDeps()), null);
});

test('hand-made BLFX animation wins', async () => {
  const { item, activity } = makeItem({ flags: { [BLFX_ID]: { act1: { command: 'play()' } } } });
  assert.equal(await chooseOverAa(item, activity, makeDeps()), 'BLFX');
});

test('Custom Auto-Rec placeholder with no macro does not take the item', async () => {
  const { item, activity } = makeItem({ name: 'Claws' });
  const deps = makeDeps({ executor: fakeExecutor({ Claws: { afterAttack: { macro: null } } }) });
  assert.equal(await chooseOverAa(item, activity, deps), null);
});

test('auto-rec switched off for the activity is respected', async () => {
  const { item, activity } = makeItem({ name: 'Longsword', flags: { [BLFX_ID]: { act1: { autoRec: { enabled: false } } } } });
  const deps = makeDeps({ executor: fakeExecutor({ Longsword: { afterAttack: { macro: play } } }) });
  assert.equal(await chooseOverAa(item, activity, deps), null);
});

test('a match on a trigger that cannot fire does not silence the item', async () => {
  const cases = [
    ['Spell A', 'save', 'afterSummon', {}],
    ['Spell B', 'utility', 'afterActiveEffects', {}],
    ['Spell C', 'save', 'afterAttack', {}],
    ['Spell D', 'utility', 'createTemplate', {}],
  ];
  for (const [name, activityType, trigger, extra] of cases) {
    const { item, activity } = makeItem({ name, activityType, extra });
    const deps = makeDeps({ executor: fakeExecutor({ [name]: { [trigger]: { macro: play } } }) });
    assert.equal(await chooseOverAa(item, activity, deps), null, `${name} via ${trigger}`);
  }
});

test('triggers that can fire do take the item', async () => {
  const withEffect = makeItem({ name: 'Shield', activityType: 'utility', effects: 1 });
  let deps = makeDeps({ executor: fakeExecutor({ Shield: { afterActiveEffects: { macro: play } } }) });
  assert.equal(await chooseOverAa(withEffect.item, withEffect.activity, deps), 'BLFX');

  const template = makeItem({ name: 'Burn', activityType: 'save', extra: { target: { template: { type: 'cone' } } } });
  deps = makeDeps({ executor: fakeExecutor({ Burn: { createTemplate: { macro: play } } }) });
  assert.equal(await chooseOverAa(template.item, template.activity, deps), 'BLFX');
});

test('every activity is checked when AA passes none', async () => {
  const { item } = makeItem({ name: 'Longsword' });
  const deps = makeDeps({ executor: fakeExecutor({ Longsword: { afterAttack: { macro: play } } }) });
  assert.equal(await chooseOverAa(item, undefined, deps), 'BLFX');
});

test('GPS item with Play Animation on beats a BLFX match', async () => {
  const { item, activity } = makeItem({ name: 'Fireball', flags: gpsFlags() });
  const deps = makeDeps({ executor: fakeExecutor({ Fireball: { afterItemUse: { macro: play } } }) });
  assert.equal(gpsAnimationState(item, undefined), 'on');
  assert.equal(await chooseOverAa(item, activity, deps), 'GPS');
});

test('item automated by another source is not treated as GPS', () => {
  const flags = gpsFlags();
  flags.cat.automation.source = 'chris-premades';
  assert.equal(gpsAnimationState(makeItem({ flags }).item, undefined), null);
});

test('GPS item that lost its AA and BLFX flags gets BLFX auto-rec switched off', () => {
  const flags = gpsFlags();
  delete flags[BLFX_ID];
  delete flags.autoanimations;
  const { item, activity } = makeItem({ flags });
  prepareItemUse(activity, makeDeps());
  assert.equal(item.flags[BLFX_ID].act1.autoRec.enabled, false);
});

test('GPS Play Animation off falls back to BLFX and AA', async () => {
  const { item, activity } = makeItem({ name: 'Fireball', flags: gpsFlags() });
  const catUtils = { getConfigValues: () => ({ playAnimation: false }) };
  const deps = makeDeps({ catUtils, executor: fakeExecutor({ Fireball: { afterItemUse: { macro: play } } }) });
  prepareItemUse(activity, deps);
  assert.equal(item.flags[BLFX_ID].act1.autoRec.enabled, true);
  assert.equal(item.flags.autoanimations.isEnabled, true);
  assert.equal(await chooseOverAa(item, activity, deps), 'BLFX');
});

test('GPS Play Animation off stays silent when the fallback is off', () => {
  const { item, activity } = makeItem({ flags: gpsFlags() });
  const catUtils = { getConfigValues: () => ({ playAnimation: false }) };
  prepareItemUse(activity, makeDeps({ catUtils, gpsFallback: () => false }));
  assert.equal(item.flags[BLFX_ID].act1.autoRec.enabled, false);
  assert.equal(item.flags.autoanimations.isEnabled, false);
});

test('CAT-owned item with existing BLFX data gets auto-rec switched off', () => {
  const { item, activity } = makeItem({ flags: { [BLFX_ID]: { act1: { version: 2, autoRec: { enabled: true } } } } });
  const catUtils = {
    getCurrentAutomation: () => ({ source: 'chris-premades', config: { animation: { type: 'selectAnimation' } } }),
    getResolvedAnimation: () => ({ animation: {} }),
  };
  prepareItemUse(activity, makeDeps({ catUtils }));
  assert.deepEqual(item.flags[BLFX_ID].act1, { version: 2, autoRec: { enabled: false } });
});

test('CPR item with its animation set to None stays available to BLFX', () => {
  const { item, activity } = makeItem();
  const catUtils = {
    getCurrentAutomation: () => ({ source: 'chris-premades', config: { animation: { type: 'selectAnimation' } } }),
    getResolvedAnimation: () => ({ animation: undefined }),
  };
  prepareItemUse(activity, makeDeps({ catUtils }));
  assert.equal(item.flags[BLFX_ID], undefined);
});

test('CAT set to something other than On & Override does not touch BLFX', () => {
  const { item, activity } = makeItem();
  const catUtils = {
    getCurrentAutomation: () => ({ config: { animation: { type: 'selectAnimation' } } }),
    getResolvedAnimation: () => ({ animation: {} }),
  };
  prepareItemUse(activity, makeDeps({ catUtils, catPriority: () => 'both' }));
  assert.equal(item.flags[BLFX_ID], undefined);
});

test('customized AA setting beats auto-rec but not a hand-made animation', async () => {
  const deps = makeDeps({ aaCustomWins: () => true, executor: fakeExecutor({ Mace: { afterAttack: { macro: play } } }) });

  const custom = makeItem({ name: 'Mace', flags: { autoanimations: { isCustomized: true } } });
  assert.equal(await chooseOverAa(custom.item, custom.activity, deps), null);
  prepareItemUse(custom.activity, deps);
  assert.equal(custom.item.flags[BLFX_ID].act1.autoRec.enabled, false);

  const handmade = makeItem({ name: 'Mace', flags: { autoanimations: { isCustomized: true }, [BLFX_ID]: { act1: { command: 'play()' } } } });
  assert.equal(await chooseOverAa(handmade.item, handmade.activity, deps), 'BLFX');
});

test('resolveWorkflow stops AA on a match and leaves it running otherwise', async () => {
  const deps = makeDeps({ executor: fakeExecutor({ Longsword: { afterAttack: { macro: play } } }) });
  const hit = makeItem({ name: 'Longsword' });
  const hitData = { item: hit.item, activity: hit.activity };
  await resolveWorkflow(hitData, {}, deps);
  assert.equal(hitData.stopWorkflow, true);

  const miss = makeItem({ name: 'Gore' });
  const missData = { item: miss.item, activity: miss.activity };
  await resolveWorkflow(missData, {}, deps);
  assert.equal(missData.stopWorkflow, undefined);
});

test('the debug log names the engine that took the item', async () => {
  const lines = [];
  const deps = makeDeps({ log: line => lines.push(line) });
  const { item, activity } = makeItem({ name: 'Misty Step' });

  const stoppedByCat = { item, activity };
  const pending = resolveWorkflow(stoppedByCat, {}, deps);
  stoppedByCat.stopWorkflow = true; // CAT's hook runs in the same callAll, before the lookup resolves.
  await pending;

  await resolveWorkflow({ item, activity }, {}, deps);
  await resolveWorkflow({ item, activity }, undefined, deps);
  assert.deepEqual(lines, ['Misty Step -> CAT', 'Misty Step -> AA', 'Misty Step -> no AA match']);
});

test('a BLFX lookup error leaves AA running', async () => {
  const executor = fakeExecutor();
  executor.getAutoRecognitionAnimation = async () => {
    throw new Error('boom');
  };
  const { item, activity } = makeItem();
  const data = { item, activity };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await resolveWorkflow(data, {}, makeDeps({ executor }));
  } finally {
    console.warn = warn;
  }
  assert.equal(data.stopWorkflow, undefined);
});

// Effect tests: an effect created by a spell points at its activity, as in dnd5e 6.
const statusSet = (...statuses) => Object.assign(new Set(statuses), { first: () => statuses[0] });

function makeSpellEffect({ name = 'Bless', flags = {}, effectFlags = {}, statuses = statusSet() } = {}) {
  const { item, activity } = makeItem({ name, flags, activityType: 'utility', effects: 1 });
  item.documentName = 'Item';
  const effect = { name, flags: effectFlags, statuses, system: { origin: { activity: 'Activity.uuid' } } };
  return { item, activity, effect, fromUuid: async uuid => (uuid === 'Activity.uuid' ? activity : null) };
}

const effectMatch = name => fakeExecutor({ [name]: { afterActiveEffects: { macro: play } } });

test('effect from a spell goes to BLFX when BLFX has an effect animation', async () => {
  const { effect, fromUuid } = makeSpellEffect();
  const deps = makeDeps({ fromUuid, blfxConditions: () => true, executor: effectMatch('Bless') });
  assert.equal(await chooseOverAaForEffect(effect, deps), 'BLFX');
});

test('effect from a spell stays with AA when BLFX only animates the cast', async () => {
  const { effect, fromUuid } = makeSpellEffect();
  const executor = fakeExecutor({ Bless: { afterItemUse: { macro: play } } });
  assert.equal(await chooseOverAaForEffect(effect, makeDeps({ fromUuid, blfxConditions: () => true, executor })), null);
});

test('a condition caused by a spell with no BLFX effect animation stays with AA', async () => {
  const { effect, fromUuid } = makeSpellEffect({ name: 'Charmed', statuses: statusSet('charmed') });
  assert.equal(await chooseOverAaForEffect(effect, makeDeps({ fromUuid, blfxConditions: () => true })), null);
});

test('a condition with no source item goes to BLFX only if BLFX knows it and the setting is on', async () => {
  const fromUuid = async () => null;
  const charmed = { name: 'Charmed', flags: {}, statuses: statusSet('charmed') };
  assert.equal(await chooseOverAaForEffect(charmed, makeDeps({ fromUuid, blfxConditions: () => true })), 'BLFX');
  assert.equal(await chooseOverAaForEffect(charmed, makeDeps({ fromUuid, blfxConditions: () => false })), null);

  const hiding = { name: 'Hiding', flags: {}, statuses: statusSet('hiding') };
  assert.equal(await chooseOverAaForEffect(hiding, makeDeps({ fromUuid, blfxConditions: () => true })), null);
});

test('an effect named after a condition counts when it has no status, as in BLFX', async () => {
  const effect = { name: 'Stunned', flags: {}, statuses: statusSet() };
  const deps = makeDeps({ fromUuid: async () => null, blfxConditions: () => true });
  assert.equal(await chooseOverAaForEffect(effect, deps), 'BLFX');
});

test('concentration effects stay with AA, because BLFX skips them', async () => {
  const { effect, fromUuid } = makeSpellEffect({ statuses: statusSet('concentrating') });
  const deps = makeDeps({ fromUuid, blfxConditions: () => true, executor: effectMatch('Bless') });
  assert.equal(await chooseOverAaForEffect(effect, deps), null);
});

test('effect from a GPS item with Play Animation on stops AA', async () => {
  const { effect, fromUuid } = makeSpellEffect({ flags: gpsFlags() });
  assert.equal(await chooseOverAaForEffect(effect, makeDeps({ fromUuid, blfxConditions: () => true })), 'GPS');
});

test('effect from a CAT-owned item stops AA, and so does a CAT animation on the effect', async () => {
  const { effect, fromUuid } = makeSpellEffect();
  const catUtils = {
    getCurrentAutomation: () => ({ source: 'chris-premades', config: { animation: { type: 'selectAnimation' } } }),
    getResolvedAnimation: () => ({ animation: {} }),
  };
  assert.equal(await chooseOverAaForEffect(effect, makeDeps({ fromUuid, catUtils, blfxConditions: () => true })), 'CAT');

  const onEffect = { name: 'Aura', flags: { cat: { animation: {} } }, statuses: statusSet() };
  assert.equal(await chooseOverAaForEffect(onEffect, makeDeps({ fromUuid: async () => null })), 'CAT');
  assert.equal(await chooseOverAaForEffect(onEffect, makeDeps({ fromUuid: async () => null, catPriority: () => 'off', blfxConditions: () => false })), null);
});

test('hand-made BLFX animation only claims the effect if it plays on the effect', async () => {
  const onEffect = makeSpellEffect({ flags: { [BLFX_ID]: { act1: { command: 'play()', eventType: 'After Active Effects' } } } });
  let deps = makeDeps({ fromUuid: onEffect.fromUuid, blfxConditions: () => true });
  assert.equal(await chooseOverAaForEffect(onEffect.effect, deps), 'BLFX');

  const onUse = makeSpellEffect({ flags: { [BLFX_ID]: { act1: { command: 'play()', eventType: 'After Activity Use (Default)' } } } });
  deps = makeDeps({ fromUuid: onUse.fromUuid, blfxConditions: () => true, executor: effectMatch('Bless') });
  assert.equal(await chooseOverAaForEffect(onUse.effect, deps), null);
});

test('BLFX auto-rec switched off for the activity leaves the effect with AA', async () => {
  const { effect, fromUuid } = makeSpellEffect({ flags: { [BLFX_ID]: { act1: { autoRec: { enabled: false } } } } });
  const deps = makeDeps({ fromUuid, blfxConditions: () => true, executor: effectMatch('Bless') });
  assert.equal(await chooseOverAaForEffect(effect, deps), null);
});

test('customized AA config on the effect beats BLFX auto-rec when that setting is on', async () => {
  const { effect, fromUuid } = makeSpellEffect({ effectFlags: { autoanimations: { isCustomized: true } } });
  const base = { fromUuid, blfxConditions: () => true, executor: effectMatch('Bless') };
  assert.equal(await chooseOverAaForEffect(effect, makeDeps({ ...base, aaCustomWins: () => true })), null);
  assert.equal(await chooseOverAaForEffect(effect, makeDeps(base)), 'BLFX');
});

test('resolveEffectWorkflow stops AA on a match, and a lookup error leaves it running', async () => {
  const lines = [];
  const { effect, fromUuid } = makeSpellEffect();
  const hit = { item: effect };
  const deps = makeDeps({ fromUuid, blfxConditions: () => true, executor: effectMatch('Bless'), log: line => lines.push(line) });
  await resolveEffectWorkflow(hit, {}, deps);
  assert.equal(hit.stopWorkflow, true);
  assert.deepEqual(lines, ['Effect Bless -> BLFX']);

  const broken = { item: effect };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await resolveEffectWorkflow(broken, {}, makeDeps({ fromUuid: async () => { throw new Error('boom'); } }));
  } finally {
    console.warn = warn;
  }
  assert.equal(broken.stopWorkflow, undefined);
});

// dnd5e's use() hands preUseActivity a clone of the item, while the actor keeps the real one.
function makeCastCopy(flags) {
  const real = makeItem({ flags: structuredClone(flags) });
  const copy = makeItem({ flags: structuredClone(flags) });
  real.item.documentName = copy.item.documentName = 'Item';
  real.item.id = copy.item.id = 'item1';
  const actor = { items: { get: id => (id === 'item1' ? real.item : undefined) } };
  real.item.actor = copy.item.actor = actor;
  return { real, copy };
}

const catOwner = {
  getCurrentAutomation: () => ({ source: 'chris-premades', config: { animation: { type: 'selectAnimation' } } }),
  getResolvedAnimation: () => ({ animation: {} }),
};

test('switching BLFX off for CAT also reaches the real item, not only the cast copy', () => {
  const { real, copy } = makeCastCopy({});
  prepareItemUse(copy.activity, makeDeps({ catUtils: catOwner }));
  assert.equal(copy.item.flags[BLFX_ID].act1.autoRec.enabled, false);
  assert.equal(real.item.flags[BLFX_ID].act1.autoRec.enabled, false);
});

test('GPS fallback also reaches the real item, for both BLFX and AA', () => {
  const { real, copy } = makeCastCopy(gpsFlags());
  const catUtils = { getConfigValues: () => ({ playAnimation: false }) };
  prepareItemUse(copy.activity, makeDeps({ catUtils }));
  assert.equal(real.item.flags[BLFX_ID].act1.autoRec.enabled, true);
  assert.equal(real.item.flags.autoanimations.isEnabled, true);
});

test('a generic-cast CPR spell is left alone, so BLFX keeps its effect', () => {
  const { real, copy } = makeCastCopy({ cat: { automation: { source: 'chris-premades' } } });
  const catUtils = { getCurrentAutomation: () => ({ source: 'chris-premades', config: {} }) };
  prepareItemUse(copy.activity, makeDeps({ catUtils }));
  assert.equal(real.item.flags[BLFX_ID], undefined);
});

test('an effect created on the GM client still keeps BLFX out of a CAT-owned spell', () => {
  const { real } = makeCastCopy({});
  const effect = { name: 'Bless', flags: {}, system: { origin: { activity: 'Activity.uuid' } } };
  const fromUuidSync = uuid => (uuid === 'Activity.uuid' ? real.activity : null);
  prepareEffectCreation(effect, makeDeps({ catUtils: catOwner, fromUuidSync }));
  assert.equal(real.item.flags[BLFX_ID].act1.autoRec.enabled, false);
});

test('an effect from an item origin covers every activity, and hand-made animations stay', () => {
  const { real } = makeCastCopy({ [BLFX_ID]: { act2: { command: 'play()' } } });
  real.item.system.activities.push({ id: 'act2', type: 'utility' });
  const effect = { name: 'Bless', flags: {}, system: { origin: { item: 'Item.uuid' } } };
  prepareEffectCreation(effect, makeDeps({ catUtils: catOwner, fromUuidSync: () => real.item }));
  assert.equal(real.item.flags[BLFX_ID].act1.autoRec.enabled, false);
  assert.equal(real.item.flags[BLFX_ID].act2.autoRec, undefined);
});

test('effect creation leaves BLFX alone on spells without a CAT or GPS animation', () => {
  const { real } = makeCastCopy({});
  const effect = { name: 'Haste', flags: {}, system: { origin: { activity: 'Activity.uuid' } } };
  prepareEffectCreation(effect, makeDeps({ fromUuidSync: () => real.activity }));
  assert.equal(real.item.flags[BLFX_ID], undefined);

  const noOrigin = { name: 'Frightened', flags: {}, system: {} };
  assert.doesNotThrow(() => prepareEffectCreation(noOrigin, makeDeps({ fromUuidSync: () => null })));
});

test('unowned items are left with AA, because BLFX ignores them', async () => {
  const { item, activity } = makeItem({ name: 'Longsword' });
  item.isEmbedded = false;
  const deps = makeDeps({ executor: fakeExecutor({ Longsword: { afterAttack: { macro: play } } }) });
  assert.equal(await chooseOverAa(item, activity, deps), null);
});
