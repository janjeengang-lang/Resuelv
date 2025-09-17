/*
 * Survey Agent action executors
 * Ported from Nanobrowser's background automation routines into reusable
 * helpers that talk to Zepra's content script.
 */
(function attachSurveyAgentActions(globalThis) {
  const STATUS = {
    OK: 'ok',
    FAIL: 'fail',
  };

  const MESSAGE_CODES = {
    CLICK: {
      START: 'act_click_start',
      OK: 'act_click_ok',
      FAIL: 'act_errors_elementNotExist',
    },
    INPUT: {
      START: 'act_inputText_start',
      OK: 'act_inputText_ok',
      FAIL: 'act_errors_elementNotExist',
    },
    SELECT: {
      START: 'act_selectDropdownOption_start',
      OK: 'act_selectDropdownOption_ok',
      FAIL: 'act_selectDropdownOption_failed',
    },
    SCROLL: {
      START: 'act_scroll_start',
      OK: 'act_scroll_ok',
      FAIL: 'act_scroll_failed',
    },
    NAVIGATE: {
      START: 'act_goToUrl_start',
      OK: 'act_goToUrl_ok',
      FAIL: 'act_goToUrl_failed',
    },
    BACK: {
      START: 'act_goBack_start',
      OK: 'act_goBack_ok',
      FAIL: 'act_goBack_failed',
    },
    FORWARD: {
      START: 'act_goForward_start',
      OK: 'act_goForward_ok',
      FAIL: 'act_goForward_failed',
    },
    RELOAD: {
      START: 'act_reload_start',
      OK: 'act_reload_ok',
      FAIL: 'act_reload_failed',
    },
    WAIT: {
      START: 'act_wait_start',
      OK: 'act_wait_ok',
      FAIL: 'act_wait_failed',
    },
  };

  function buildOk(code, details = {}, meta = {}) {
    return { ok: true, status: STATUS.OK, code, details, meta };
  }

  function buildFail(code, error, details = {}, meta = {}) {
    return { ok: false, status: STATUS.FAIL, code, error: error?.message || String(error), details, meta };
  }

  async function ensureContentScript(tabId) {
    if (!tabId) throw new Error('NO_TAB_ID');
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return;
    } catch (err) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      } catch (injectErr) {
        throw err instanceof Error ? err : injectErr || err;
      }
    }
  }

  async function sendAction(tabId, actionPayload) {
    await ensureContentScript(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'SURVEY_AGENT_EXECUTE_ACTION',
      action: actionPayload,
    });
    if (!response) throw new Error('NO_RESPONSE');
    if (!response.ok) {
      const err = new Error(response.error || 'ACTION_FAILED');
      err.code = response.code;
      err.details = response.details;
      throw err;
    }
    return response;
  }

  async function click(tabId, step = {}) {
    const { locator = {}, intent, scrollIntoView = true } = step;
    try {
      const result = await sendAction(tabId, {
        type: 'click',
        locator,
        intent: intent || MESSAGE_CODES.CLICK.START,
        scrollIntoView,
      });
      return buildOk(result.code || MESSAGE_CODES.CLICK.OK, result.details, { intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.CLICK.FAIL, err, err.details, { intent });
    }
  }

  async function inputText(tabId, step = {}) {
    const { locator = {}, text = '', typingSpeed, intent, replace = true } = step;
    try {
      const result = await sendAction(tabId, {
        type: 'type',
        locator,
        text,
        typingSpeed,
        replace,
        intent: intent || MESSAGE_CODES.INPUT.START,
      });
      return buildOk(result.code || MESSAGE_CODES.INPUT.OK, result.details, { intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.INPUT.FAIL, err, err.details, { intent });
    }
  }

  async function selectDropdownOption(tabId, step = {}) {
    const { locator = {}, text = '', intent } = step;
    try {
      const result = await sendAction(tabId, {
        type: 'select',
        locator,
        text,
        intent: intent || MESSAGE_CODES.SELECT.START,
      });
      return buildOk(result.code || MESSAGE_CODES.SELECT.OK, result.details, { intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.SELECT.FAIL, err, err.details, { intent });
    }
  }

  async function scroll(tabId, step = {}) {
    const { intent, mode = 'element', locator = {}, percent, behavior, offset = 0 } = step;
    try {
      const result = await sendAction(tabId, {
        type: 'scroll',
        intent: intent || MESSAGE_CODES.SCROLL.START,
        locator,
        mode,
        percent,
        behavior,
        offset,
      });
      return buildOk(result.code || MESSAGE_CODES.SCROLL.OK, result.details, { intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.SCROLL.FAIL, err, err.details, { intent });
    }
  }

  async function goToUrl(tabId, step = {}) {
    const { url, intent } = step;
    if (!url) return buildFail(MESSAGE_CODES.NAVIGATE.FAIL, new Error('NO_URL'), {}, { intent });
    try {
      await chrome.tabs.update(tabId, { url });
      return buildOk(MESSAGE_CODES.NAVIGATE.OK, { url }, { intent });
    } catch (err) {
      return buildFail(MESSAGE_CODES.NAVIGATE.FAIL, err, { url }, { intent });
    }
  }

  async function goBack(tabId, step = {}) {
    const { intent } = step;
    try {
      await chrome.tabs.goBack(tabId);
      return buildOk(MESSAGE_CODES.BACK.OK, {}, { intent });
    } catch (err) {
      return buildFail(MESSAGE_CODES.BACK.FAIL, err, {}, { intent });
    }
  }

  async function goForward(tabId, step = {}) {
    const { intent } = step;
    try {
      await chrome.tabs.goForward(tabId);
      return buildOk(MESSAGE_CODES.FORWARD.OK, {}, { intent });
    } catch (err) {
      return buildFail(MESSAGE_CODES.FORWARD.FAIL, err, {}, { intent });
    }
  }

  async function reload(tabId, step = {}) {
    const { intent, bypassCache = false } = step;
    try {
      await chrome.tabs.reload(tabId, { bypassCache });
      return buildOk(MESSAGE_CODES.RELOAD.OK, { bypassCache }, { intent });
    } catch (err) {
      return buildFail(MESSAGE_CODES.RELOAD.FAIL, err, { bypassCache }, { intent });
    }
  }

  async function wait(step = {}) {
    const { seconds = 1, intent } = step;
    try {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
      return buildOk(MESSAGE_CODES.WAIT.OK, { seconds }, { intent });
    } catch (err) {
      return buildFail(MESSAGE_CODES.WAIT.FAIL, err, { seconds }, { intent });
    }
  }

  async function execute(tabId, step = {}) {
    if (!step || typeof step !== 'object') {
      return buildFail('act_errors_invalidAction', new Error('INVALID_ACTION'));
    }
    const type = typeof step.type === 'string' ? step.type : step.name;
    const normalized = typeof type === 'string' ? type.toLowerCase() : '';
    switch (normalized) {
      case 'click':
        return click(tabId, step);
      case 'type':
      case 'input_text':
        return inputText(tabId, step);
      case 'select':
      case 'select_dropdown_option':
        return selectDropdownOption(tabId, step);
      case 'scroll':
      case 'scroll_to':
        return scroll(tabId, step);
      case 'go_to_url':
      case 'navigate':
        return goToUrl(tabId, step);
      case 'go_back':
        return goBack(tabId, step);
      case 'go_forward':
        return goForward(tabId, step);
      case 'reload':
        return reload(tabId, step);
      case 'wait':
        return wait(step);
      default:
        return buildFail('act_errors_unknownAction', new Error(`Unknown action: ${type || 'undefined'}`));
    }
  }

  globalThis.surveyAgentActions = {
    click,
    inputText,
    selectDropdownOption,
    scroll,
    goToUrl,
    goBack,
    goForward,
    reload,
    wait,
    execute,
  };
})(self);
