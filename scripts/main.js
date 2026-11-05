import { BLFX_ID, prepareItemUse, resolveWorkflow } from './logic.js';

const MODULE_ID = 'blfx-aa-bridge';
const EXECUTOR_PATH = `modules/${BLFX_ID}/scripts/apps/BlfxMacroExecutor.js`;
const EXECUTOR_METHODS = ['getMacroScript', 'isAutoRecognitionEnabled', 'getAutoRecognitionAnimation'];

function registerSetting(key, labelKey, scope, defaultValue) {
  game.settings.register(MODULE_ID, key, {
    name: `BLFX_AA_BRIDGE.Settings.${labelKey}.Name`,
    hint: `BLFX_AA_BRIDGE.Settings.${labelKey}.Hint`,
    scope,
    config: true,
    type: Boolean,
    default: defaultValue,
  });
}

// BLFX has no public API for this. Importing its own file returns the instance BLFX already
// loaded, so new auto-rec entries and Custom Auto-Rec edits are picked up with no list to maintain.
async function loadExecutor() {
  const { BlfxMacroExecutor } = await import(foundry.utils.getRoute(EXECUTOR_PATH));
  const missing = EXECUTOR_METHODS.filter(method => typeof BlfxMacroExecutor?.[method] !== 'function');
  if (missing.length) throw new Error(`BlfxMacroExecutor is missing: ${missing.join(', ')}`);
  return BlfxMacroExecutor;
}

Hooks.once('init', () => {
  registerSetting('gpsFallback', 'GpsFallback', 'world', true);
  registerSetting('aaCustomWins', 'AaCustomWins', 'world', false);
  registerSetting('debug', 'Debug', 'client', false);
});

Hooks.once('ready', async () => {
  if (!game.modules.get(BLFX_ID)?.active) return;

  let executor;
  try {
    executor = await loadExecutor();
  } catch (error) {
    console.warn(`${MODULE_ID} | BLFX lookup unavailable, AA keeps playing everything`, error);
    if (game.user.isGM) ui.notifications.warn(game.i18n.localize('BLFX_AA_BRIDGE.LookupFailed'));
    return;
  }

  const deps = {
    executor,
    catUtils: game.modules.get('cat')?.active ? globalThis.cat?.utils?.automationUtils : undefined,
    catPriority: () => game.settings.settings.has('cat.animationPriority') && game.settings.get('cat', 'animationPriority'),
    gpsFallback: () => game.settings.get(MODULE_ID, 'gpsFallback'),
    aaCustomWins: () => game.settings.get(MODULE_ID, 'aaCustomWins'),
    log: message => {
      if (game.settings.get(MODULE_ID, 'debug')) console.log(`${MODULE_ID} | ${message}`);
    },
  };

  Hooks.on('dnd5e.preUseActivity', activity => {
    try {
      prepareItemUse(activity, deps);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not prepare item use`, activity?.item?.name, error);
    }
  });

  // AA awaits deferrals before it reads stopWorkflow. Effect workflows are left alone.
  Hooks.on('AutomatedAnimations-WorkflowStart', (data, animationData) => {
    if (data.activeEffect || data.item?.documentName !== 'Item') return;
    (data.deferrals ??= []).push(resolveWorkflow(data, animationData, deps));
  });

  console.log(`${MODULE_ID} | ready`);
});
