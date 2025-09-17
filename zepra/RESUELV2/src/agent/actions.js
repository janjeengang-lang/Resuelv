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
    STATUS: {
      START: 'act_status_start',
      OK: 'act_status_ok',
      FAIL: 'act_status_failed',
    },
    IP_INFO: {
      START: 'act_ipInfo_start',
      OK: 'act_ipInfo_ok',
      FAIL: 'act_ipInfo_failed',
    },
    IP_CHECK: {
      START: 'act_ipCheck_start',
      OK: 'act_ipCheck_ok',
      FAIL: 'act_ipCheck_failed',
    },
    CUSTOM_OPEN: {
      START: 'act_customOpen_start',
      OK: 'act_customOpen_ok',
      FAIL: 'act_customOpen_failed',
    },
    NOTE_SAVE: {
      START: 'act_noteSave_start',
      OK: 'act_noteSave_ok',
      FAIL: 'act_noteSave_failed',
    },
    OPEN_TAB: {
      START: 'act_openTab_start',
      OK: 'act_openTab_ok',
      FAIL: 'act_openTab_failed',
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

  async function statusUpdate(tabId, step = {}) {
    const message = step.message || step.text;
    if (!message) {
      return buildFail(MESSAGE_CODES.STATUS.FAIL, new Error('NO_STATUS_MESSAGE'));
    }
    try {
      await ensureContentScript(tabId);
      await chrome.tabs.sendMessage(tabId, {
        type: 'SURVEY_AGENT_STATUS_UPDATE',
        message,
        tone: step.tone,
        persist: step.persist === true,
      });
      return buildOk(MESSAGE_CODES.STATUS.OK, { statusMessage: message, tone: step.tone }, {});
    } catch (err) {
      return buildFail(MESSAGE_CODES.STATUS.FAIL, err, { message }, {});
    }
  }

  async function ipInfo(tabId, step = {}) {
    try {
      const result = await sendAction(tabId, {
        type: 'ip_info',
        intent: step.intent || MESSAGE_CODES.IP_INFO.START,
        mode: step.mode,
      });
      return buildOk(result.code || MESSAGE_CODES.IP_INFO.OK, result.details, { intent: step.intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.IP_INFO.FAIL, err, err.details, { intent: step.intent });
    }
  }

  async function ipCheck(tabId, step = {}) {
    try {
      const result = await sendAction(tabId, {
        type: 'ip_check',
        intent: step.intent || MESSAGE_CODES.IP_CHECK.START,
        mode: step.mode,
      });
      return buildOk(result.code || MESSAGE_CODES.IP_CHECK.OK, result.details, { intent: step.intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.IP_CHECK.FAIL, err, err.details, { intent: step.intent });
    }
  }

  async function customOpen(tabId, step = {}) {
    try {
      const result = await sendAction(tabId, {
        type: 'custom_open',
        siteKey: step.siteKey,
        url: step.url,
        intent: step.intent || MESSAGE_CODES.CUSTOM_OPEN.START,
      });
      return buildOk(result.code || MESSAGE_CODES.CUSTOM_OPEN.OK, result.details, { intent: step.intent });
    } catch (err) {
      return buildFail(err.code || MESSAGE_CODES.CUSTOM_OPEN.FAIL, err, err.details, { intent: step.intent });
    }
  }

  async function saveNote(step = {}) {
    const content = step.content || step.text;
    if (!content) {
      return buildFail(MESSAGE_CODES.NOTE_SAVE.FAIL, new Error('NO_NOTE_CONTENT'));
    }
    const title = step.title || 'ملاحظة الوكيل';
    try {
      const entry = {
        id: `agent-note-${Date.now()}`,
        title: String(title).slice(0, 160),
        content: String(content),
        createdAt: Date.now(),
        source: 'survey-agent',
      };
      const { surveyAgentNotes = [] } = await chrome.storage.local.get('surveyAgentNotes');
      surveyAgentNotes.push(entry);
      await chrome.storage.local.set({ surveyAgentNotes });
      return buildOk(MESSAGE_CODES.NOTE_SAVE.OK, { title: entry.title, createdAt: entry.createdAt }, {});
    } catch (err) {
      return buildFail(MESSAGE_CODES.NOTE_SAVE.FAIL, err, {}, {});
    }
  }

  async function openTab(step = {}) {
    const url = step.url;
    if (!url) {
      return buildFail(MESSAGE_CODES.OPEN_TAB.FAIL, new Error('NO_URL'), {}, {});
    }
    try {
      const tab = await chrome.tabs.create({ url, active: step.active !== false });
      return buildOk(MESSAGE_CODES.OPEN_TAB.OK, { url, tabId: tab?.id }, {});
    } catch (err) {
      return buildFail(MESSAGE_CODES.OPEN_TAB.FAIL, err, { url }, {});
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
      case 'status':
        return statusUpdate(tabId, step);
      case 'ip_info':
        return ipInfo(tabId, step);
      case 'ip_check':
        return ipCheck(tabId, step);
      case 'custom_open':
        return customOpen(tabId, step);
      case 'note_save':
        return saveNote(step);
      case 'open_tab':
        return openTab(step);
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
    statusUpdate,
    ipInfo,
    ipCheck,
    customOpen,
    saveNote,
    openTab,
    execute,
  };
})(self);
