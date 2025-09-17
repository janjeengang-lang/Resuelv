// content.js
// - Extract selected text or from DOM
// - Overlay to select OCR region
// - Fallback image crop
// - Type text into focused field (no humanize; speed only)
// - Floating bubble with rainbow modal
// (Video dubbing feature removed)

function init() {
  if (window.zepraInit) return;
  window.zepraInit = true;
  const STATE = {
    overlay: null,
    rectEl: null,
    modal: null,
    bubble: null,
    currentAnswer: '',
    isTyping: false,
    selBtn: null,
    lastFocused: null,
    lastMouse: { x: 20, y: 20 },
    fillIcon: null,
    surveyAgent: {
      domTree: null,
      highlightLookup: new Map(),
      nodeById: new Map(),
      parentById: new Map(),
      lastUpdated: 0,
      ocrCache: new Map(),
      ocrCacheUrl: '',
      settings: {
        useIdentityAnswers: true,
        deliberateMode: false,
      },
      session: {
        running: false,
        stopRequested: false,
        status: 'idle',
        history: [],
        logs: [],
        chat: [],
        startedAt: 0,
        completedAt: 0,
        planCount: 0,
        errorCount: 0,
        maxSteps: 40,
        instructions: '',
        goal: '',
        loopPromise: null,
        rateLimitBackoffMs: 0,
        currentPhase: null,
        lastPlanSignature: '',
        lastExecutedSignature: '',
        repeatPlanCount: 0,
        repeatedSuccessCount: 0,
        lastPlanAt: 0,
        lastActionAt: 0,
        statusMessage: 'في انتظار تعليماتك.',
        statusTone: 'status',
      },
      ui: {
        modal: null,
        styleEl: null,
        elements: null,
      },
    }
  };

  let customPrompts = [];
  chrome.storage.sync.get('customPrompts', r => { customPrompts = r.customPrompts || []; });
  chrome.storage.onChanged.addListener((chg, area) => {
    if(area === 'sync' && chg.customPrompts){ customPrompts = chg.customPrompts.newValue || []; }
  });

  let activeIdentity = null;

  function getSurveyAgentSettings() {
    if (!STATE.surveyAgent.settings) {
      STATE.surveyAgent.settings = { useIdentityAnswers: true, deliberateMode: false };
    }
    return STATE.surveyAgent.settings;
  }

  function applySurveyAgentSettings(settings = {}) {
    const target = getSurveyAgentSettings();
    target.useIdentityAnswers = settings.useIdentityAnswers !== false;
    target.deliberateMode = Boolean(settings.deliberateMode);
    syncSurveyAgentSettingsToUi();
  }

  function persistSurveyAgentSettings(settings = {}) {
    const payload = {
      useIdentityAnswers: settings.useIdentityAnswers !== false,
      deliberateMode: Boolean(settings.deliberateMode),
    };
    try {
      chrome.storage.local.set({ [SURVEY_AGENT_SETTINGS_KEY]: payload }, () => {
        if (chrome.runtime?.lastError) {
          console.warn('Survey agent settings save failed', chrome.runtime.lastError);
        }
      });
    } catch (err) {
      console.warn('Survey agent settings persistence error', err);
    }
  }

  function loadSurveyAgentSettings() {
    try {
      chrome.storage.local.get(SURVEY_AGENT_SETTINGS_KEY, (res) => {
        const stored = res && res[SURVEY_AGENT_SETTINGS_KEY];
        if (stored && typeof stored === 'object') {
          applySurveyAgentSettings(stored);
        } else {
          applySurveyAgentSettings(getSurveyAgentSettings());
        }
      });
    } catch (err) {
      console.warn('Survey agent settings load error', err);
    }
  }

  function updateSurveyAgentSetting(key, value) {
    const settings = getSurveyAgentSettings();
    settings[key] = value;
    persistSurveyAgentSettings(settings);
    syncSurveyAgentSettingsToUi();
  }

  function syncSurveyAgentSettingsToUi() {
    const settings = getSurveyAgentSettings();
    const ui = getSurveyAgentUiState();
    const elements = ui.elements || {};
    if (elements.identityToggle) {
      elements.identityToggle.checked = settings.useIdentityAnswers !== false;
    }
    if (elements.deliberateToggle) {
      elements.deliberateToggle.checked = Boolean(settings.deliberateMode);
    }
  }

  loadSurveyAgentSettings();

  let domBuilderModulePromise = null;

  function resolveDomBuilderFromGlobals() {
    const builder =
      (globalThis.__zepraBuildDomTreeModule && globalThis.__zepraBuildDomTreeModule.buildDomTree) ||
      globalThis.__zepraBuildDomTree ||
      globalThis.buildDomTree;
    if (typeof builder !== 'function') return null;
    const module = { buildDomTree: builder };
    try {
      if (!globalThis.__zepraBuildDomTreeModule) {
        globalThis.__zepraBuildDomTreeModule = module;
      }
      if (!globalThis.__zepraBuildDomTree) {
        globalThis.__zepraBuildDomTree = builder;
      }
    } catch (err) {
      // Ignore strict CSP frames that block global assignment
    }
    return module;
  }

  function loadDomBuilderModule() {
    if (domBuilderModulePromise) return domBuilderModulePromise;

    const existing = resolveDomBuilderFromGlobals();
    if (existing) {
      domBuilderModulePromise = Promise.resolve(existing);
      return domBuilderModulePromise;
    }

    domBuilderModulePromise = new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timeoutMs = 5000;

      const poll = () => {
        const module = resolveDomBuilderFromGlobals();
        if (module) {
          resolve(module);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error('DOM builder unavailable'));
          return;
        }
        setTimeout(poll, 50);
      };

      poll();
    }).catch((err) => {
      domBuilderModulePromise = null;
      throw err;
    });

    return domBuilderModulePromise;
  }

  async function collectSurveyDomTree(options = {}) {
    const allowCache = !options?.forceRefresh && !options?.showHighlights && !options?.debugMode;
    const state = STATE.surveyAgent;
    const now = Date.now();

    if (
      allowCache &&
      state.domTree &&
      state.lastUpdated &&
      now - state.lastUpdated <= SURVEY_AGENT_DOM_CACHE_TTL
    ) {
      return state.domTree;
    }

    if (allowCache && !state.domTree) {
      const cached = loadSurveyAgentDomCache();
      if (cached && cached.tree) {
        const refreshedTimestamp = Date.now();
        updateSurveyAgentDomCache(cached.tree, { timestamp: refreshedTimestamp, persist: allowCache });
        try {
          await augmentSurveyAgentDomTree(cached.tree, options);
        } catch (err) {
          console.warn('Survey agent cache augment failed', err);
        }
        return state.domTree;
      }
    }

    const module = await loadDomBuilderModule();
    if (!module || typeof module.buildDomTree !== 'function') {
      throw new Error('DOM builder unavailable');
    }
    const {
      showHighlights = false,
      focusHighlightIndex = -1,
      viewportExpansion = 0,
      startHighlightIndex = 0,
      startId = 0,
      debugMode = false
    } = options || {};

    const tree = await module.buildDomTree({
      showHighlightElements: Boolean(showHighlights),
      focusHighlightIndex: Number.isInteger(focusHighlightIndex) ? focusHighlightIndex : -1,
      viewportExpansion: Number.isFinite(viewportExpansion) ? viewportExpansion : 0,
      startHighlightIndex: Number.isInteger(startHighlightIndex) ? startHighlightIndex : 0,
      startId: Number.isInteger(startId) ? startId : 0,
      debugMode: Boolean(debugMode)
    });

    updateSurveyAgentDomCache(tree, { persist: allowCache });

    await augmentSurveyAgentDomTree(tree, options);

    return tree;
  }

  function updateSurveyAgentDomCache(tree, meta = {}) {
    const { highlightLookup, nodeById, parentById } = buildSurveyAgentLookups(tree);
    const timestamp = meta.timestamp || Date.now();
    STATE.surveyAgent.domTree = tree || null;
    STATE.surveyAgent.highlightLookup = highlightLookup;
    STATE.surveyAgent.nodeById = nodeById;
    STATE.surveyAgent.parentById = parentById;
    STATE.surveyAgent.lastUpdated = timestamp;

    if (meta.persist) {
      storeSurveyAgentDomCache(tree, timestamp);
    }

    try {
      window.__zepraSurveyAgentCache = {
        lastUpdated: STATE.surveyAgent.lastUpdated,
        highlightIndices: Array.from(highlightLookup.keys()),
      };
    } catch (e) {
      // Ignore serialization issues
    }
  }

  function getSurveyAgentDomCacheStorageKey() {
    try {
      const url = new URL(window.location.href);
      url.hash = '';
      return `${SURVEY_AGENT_DOM_CACHE_STORAGE_KEY}${url.origin}${url.pathname}`;
    } catch (err) {
      return `${SURVEY_AGENT_DOM_CACHE_STORAGE_KEY}${window.location.href.split('#')[0]}`;
    }
  }

  function loadSurveyAgentDomCache() {
    const key = getSurveyAgentDomCacheStorageKey();
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !payload.tree) return null;
      if (payload.version !== 1) return null;
      if (payload.url && payload.url !== window.location.href.split('#')[0]) return null;
      if (typeof payload.timestamp === 'number') {
        if (Date.now() - payload.timestamp > SURVEY_AGENT_DOM_CACHE_PERSIST_TTL) {
          sessionStorage.removeItem(key);
          return null;
        }
      }
      if (
        typeof payload.viewportWidth === 'number' &&
        payload.viewportWidth !== window.innerWidth
      ) {
        return null;
      }
      if (
        typeof payload.viewportHeight === 'number' &&
        Math.abs(payload.viewportHeight - window.innerHeight) > 40
      ) {
        return null;
      }
      return payload;
    } catch (err) {
      try {
        sessionStorage.removeItem(key);
      } catch (cleanupErr) {
        // ignore cleanup errors
      }
      return null;
    }
  }

  function storeSurveyAgentDomCache(tree, timestamp) {
    if (!tree) return;
    const key = getSurveyAgentDomCacheStorageKey();
    const payload = {
      version: 1,
      url: window.location.href.split('#')[0],
      timestamp: timestamp || Date.now(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      tree,
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(payload));
    } catch (err) {
      try {
        sessionStorage.removeItem(key);
      } catch (cleanupErr) {
        // ignore cleanup
      }
    }
  }

  function invalidateSurveyAgentDomCache(options = {}) {
    STATE.surveyAgent.domTree = null;
    STATE.surveyAgent.highlightLookup = new Map();
    STATE.surveyAgent.nodeById = new Map();
    STATE.surveyAgent.parentById = new Map();
    STATE.surveyAgent.lastUpdated = 0;
    if (!options.skipStorage) {
      try {
        sessionStorage.removeItem(getSurveyAgentDomCacheStorageKey());
      } catch (err) {
        // ignore removal failures
      }
    }
  }

  function buildSurveyAgentLookups(tree) {
    const highlightLookup = new Map();
    const nodeById = new Map();
    const parentById = new Map();

    if (!tree || typeof tree !== 'object' || !tree.map) {
      return { highlightLookup, nodeById, parentById };
    }

    const entries = Object.entries(tree.map);
    for (const [id, node] of entries) {
      nodeById.set(id, node);
      if (node && Array.isArray(node.children)) {
        for (const childId of node.children) {
          parentById.set(childId, id);
        }
      }
    }

    const buildFrameChain = (nodeId) => {
      const chain = [];
      let currentId = parentById.get(nodeId);
      while (currentId) {
        const parentNode = nodeById.get(currentId);
        if (!parentNode) break;
        if ((parentNode.tagName || '').toLowerCase() === 'iframe') {
          chain.unshift({
            nodeId: currentId,
            xpath: parentNode.xpath || '',
            attributes: parentNode.attributes || {},
          });
        }
        currentId = parentById.get(currentId);
      }
      return chain;
    };

    for (const [id, node] of nodeById.entries()) {
      if (node && Number.isInteger(node.highlightIndex)) {
        highlightLookup.set(node.highlightIndex, {
          nodeId: id,
          xpath: node.xpath || '',
          tagName: node.tagName || '',
          attributes: node.attributes || {},
          frameChain: buildFrameChain(id),
        });
      }
    }

    return { highlightLookup, nodeById, parentById };
  }

  function formatIdentityPreviewValue(value, max = 80) {
    if (value == null) return '';
    const text = String(value).trim();
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }

  function getActiveIdentitySnapshot() {
    if (!activeIdentity || typeof activeIdentity !== 'object') return null;
    const snapshot = {};
    const push = (key, value) => {
      if (snapshot[key]) return;
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      snapshot[key] = trimmed;
    };
    for (const key of SURVEY_AGENT_IDENTITY_FIELD_ORDER) {
      if (Object.prototype.hasOwnProperty.call(activeIdentity, key)) {
        push(key, activeIdentity[key]);
      }
    }
    if (Object.keys(snapshot).length < 12) {
      for (const [key, value] of Object.entries(activeIdentity)) {
        if (snapshot[key]) continue;
        if (/^(id|profilePictureUrl)$/i.test(key)) continue;
        push(key, value);
        if (Object.keys(snapshot).length >= 24) break;
      }
    }
    return Object.keys(snapshot).length ? snapshot : null;
  }

  function buildLocatorForNode(nodeId, node) {
    const locator = {};
    if (Number.isInteger(node?.highlightIndex)) locator.highlightIndex = node.highlightIndex;
    if (nodeId) locator.nodeId = String(nodeId);
    if (node?.xpath) locator.xpath = node.xpath;
    if (Array.isArray(node?.frameChain)) locator.frameChain = node.frameChain;
    return locator;
  }

  function shouldAttemptAutoOcr(node) {
    if (!node || typeof node !== 'object') return false;
    const tag = (node.tagName || '').toLowerCase();
    if (tag !== 'img' && tag !== 'svg' && tag !== 'canvas') return false;
    if (node.isVisible === false) return false;
    if (typeof node.ocrText === 'string' && node.ocrText.length) return false;
    const attrs = node.attributes || {};
    const alt = typeof attrs.alt === 'string' ? attrs.alt.trim() : '';
    const aria = typeof attrs['aria-label'] === 'string' ? attrs['aria-label'].trim() : '';
    if ((alt && alt.length > 3) || (aria && aria.length > 3)) return false;
    return true;
  }

  function annotateIdentityHintsOnTree(tree) {
    const snapshot = getActiveIdentitySnapshot();
    const map = tree?.map;
    if (!map) return;
    const eligible = new Set(['input', 'textarea', 'select']);
    for (const [nodeId, node] of Object.entries(map)) {
      if (!node || typeof node !== 'object') continue;
      const tag = (node.tagName || '').toLowerCase();
      if (!eligible.has(tag)) {
        if (node.identityKey) {
          delete node.identityKey;
          delete node.identityPreview;
        }
        continue;
      }
      const locator = buildLocatorForNode(nodeId, node);
      const resolved = resolveSurveyAgentElement(locator);
      const element = resolved.element;
      if (!element) {
        if (node.identityKey) {
          delete node.identityKey;
          delete node.identityPreview;
        }
        continue;
      }
      const key = detectField(element);
      if (key) {
        node.identityKey = key;
        if (snapshot && snapshot[key]) {
          node.identityPreview = formatIdentityPreviewValue(snapshot[key]);
        } else {
          delete node.identityPreview;
        }
      } else if (node.identityKey) {
        delete node.identityKey;
        delete node.identityPreview;
      }
    }
  }

  async function annotateSurveyImagesWithOcr(tree, options = {}) {
    const map = tree?.map;
    if (!map) return;
    const state = STATE.surveyAgent;
    if (!state.ocrCache || !(state.ocrCache instanceof Map)) {
      state.ocrCache = new Map();
    }
    const cache = state.ocrCache;
    const targets = [];
    for (const [nodeId, node] of Object.entries(map)) {
      if (!shouldAttemptAutoOcr(node)) continue;
      const cacheKey = node.xpath || `${nodeId}`;
      if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (typeof cached === 'string' && cached.trim()) {
          node.ocrText = cached;
        }
        continue;
      }
      targets.push({ nodeId, node, cacheKey });
    }
    if (!targets.length) return;
    const slice = targets.slice(0, SURVEY_AGENT_MAX_AUTO_OCR);
    const settings = await chrome.storage.local.get('ocrLang');
    const ocrLang = settings?.ocrLang || 'eng';
    const tabId = await getTabId();
    for (const target of slice) {
      const locator = buildLocatorForNode(target.nodeId, target.node);
      const resolved = resolveSurveyAgentElement(locator);
      const element = resolved.element;
      if (!element) {
        cache.set(target.cacheKey, '');
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (!rect) {
        cache.set(target.cacheKey, '');
        continue;
      }
      if (
        rect.width < SURVEY_AGENT_OCR_MIN_EDGE ||
        rect.height < SURVEY_AGENT_OCR_MIN_EDGE ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        cache.set(target.cacheKey, '');
        continue;
      }
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'CAPTURE_AND_OCR',
          rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            dpr: window.devicePixelRatio || 1,
          },
          tabId,
          ocrLang,
        });
        if (response?.ok && response.text) {
          const text = String(response.text).trim();
          if (text) {
            target.node.ocrText = text;
            cache.set(target.cacheKey, text);
          } else {
            cache.set(target.cacheKey, '');
          }
        } else {
          cache.set(target.cacheKey, '');
        }
      } catch (err) {
        console.warn('Survey agent OCR error', err);
        cache.set(target.cacheKey, '');
      }
      await sleep(120);
    }
  }

  async function augmentSurveyAgentDomTree(tree, options = {}) {
    if (!tree || typeof tree !== 'object' || !tree.map) return;
    const state = STATE.surveyAgent;
    if (state.ocrCacheUrl !== location.href) {
      state.ocrCache = new Map();
      state.ocrCacheUrl = location.href;
    }
    try {
      annotateIdentityHintsOnTree(tree);
    } catch (err) {
      console.warn('Survey agent identity annotation failed', err);
    }
    try {
      await annotateSurveyImagesWithOcr(tree, options);
    } catch (err) {
      console.warn('Survey agent OCR annotation failed', err);
    }
  }

  function summarizeSurveyAgentProgress(tree) {
    const map = tree && tree.map ? tree.map : null;
    if (!map) return null;
    let total = 0;
    let filled = 0;
    let required = 0;
    let requiredFilled = 0;
    const missing = [];
    for (const node of Object.values(map)) {
      if (!node || typeof node !== 'object') continue;
      const tag = (node.tagName || '').toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag)) continue;
      total += 1;
      const isRequired = Boolean(
        node.isRequired ||
          (node.attributes &&
            (node.attributes.required !== undefined ||
              (typeof node.attributes['aria-required'] === 'string' && node.attributes['aria-required'].toLowerCase() === 'true')))
      );
      if (isRequired) required += 1;
      const hasValue = Boolean(
        (typeof node.currentValue === 'string' && node.currentValue.trim()) ||
          (Array.isArray(node.selectedTexts) && node.selectedTexts.some((text) => text && text.trim())) ||
          (Array.isArray(node.selectedValues) && node.selectedValues.some((value) => value && String(value).trim())) ||
          node.isChecked === true
      );
      if (hasValue) filled += 1;
      if (isRequired && hasValue) {
        requiredFilled += 1;
      } else if (isRequired && !hasValue) {
        const highlight = Number.isInteger(node.highlightIndex) ? `#${node.highlightIndex}` : '';
        const identityHint = node.identityKey ? node.identityKey : '';
        const nameAttr = node.attributes?.name || node.attributes?.id || '';
        const descriptor = highlight || identityHint || nameAttr || (node.xpath ? node.xpath.slice(-24) : tag);
        missing.push(descriptor);
      }
    }
    if (!total) return null;
    return {
      totalFields: total,
      filledFields: filled,
      requiredFields: required,
      requiredFilled,
      missingRequired: missing.slice(0, 8),
    };
  }

  function formatSurveyAgentProgress(progress) {
    if (!progress) return '';
    const parts = [];
    parts.push(`${progress.filledFields}/${progress.totalFields} fields filled`);
    if (progress.requiredFields) {
      parts.push(`required ${progress.requiredFilled}/${progress.requiredFields}`);
    }
    if (Array.isArray(progress.missingRequired) && progress.missingRequired.length) {
      parts.push(`missing required: ${progress.missingRequired.join(', ')}`);
    }
    return parts.join(' • ');
  }

  function buildSurveyAgentPlanningContext(domTree, session) {
    const identitySnapshot = getActiveIdentitySnapshot();
    const preview = identitySnapshot
      ? Object.fromEntries(
          Object.entries(identitySnapshot).map(([key, value]) => [key, formatIdentityPreviewValue(value)])
        )
      : null;
    const context = {
      page: {
        url: location.href,
        title: document.title,
      },
      preferences: {
        useIdentityAnswers: session ? session.useIdentityAnswers !== false : true,
        deliberateMode: session ? Boolean(session.deliberateMode) : false,
      },
    };
    const docLang = document.documentElement?.lang;
    if (docLang) {
      context.page.language = docLang;
    } else if (navigator.language) {
      context.page.language = navigator.language;
    }
    const progress = summarizeSurveyAgentProgress(domTree);
    if (progress) {
      context.progress = progress;
      context.page.formProgress = formatSurveyAgentProgress(progress);
    }
    if (identitySnapshot) {
      context.identity = identitySnapshot;
      context.identityPreview = preview;
    }
    return context;
  }

  function buildSurveyAgentPlannerOptions(session) {
    const deliberate = session ? Boolean(session.deliberateMode) : false;
    return {
      maxNodes: deliberate ? 160 : 120,
      preferences: {
        useIdentityAnswers: session ? session.useIdentityAnswers !== false : true,
        deliberateMode: deliberate,
      },
    };
  }

  async function ensureSurveyAgentPlanSpacing(session) {
    if (!session) return;
    const cooldown = SURVEY_AGENT_PLAN_COOLDOWN_BASE + (session.deliberateMode ? SURVEY_AGENT_PLAN_COOLDOWN_DELIBERATE : 0);
    if (!session.lastPlanAt) {
      if (session.deliberateMode) {
        await sleep(SURVEY_AGENT_POST_ACTION_DELAY_DELIBERATE);
      }
      return;
    }
    const elapsed = Date.now() - session.lastPlanAt;
    if (elapsed < cooldown) {
      const jitter = rand(40, 140);
      await sleep(cooldown - elapsed + jitter);
    }
  }

  const SURVEY_AGENT_SETTINGS_KEY = 'surveyAgentSettings';
  const SURVEY_AGENT_DEFAULT_GOAL = 'أكمل المهمة المطلوبة بعناية.';
  const SURVEY_AGENT_MAX_PLAN_ERRORS = 3;
  const SURVEY_AGENT_MAX_LOGS = 80;
  const SURVEY_AGENT_HISTORY_LIMIT = 12;
  const SURVEY_AGENT_MAX_CHAT_MESSAGES = 60;
  const SURVEY_AGENT_CHAT_CONTEXT_LIMIT = 12;
  const SURVEY_AGENT_MAX_AUTO_OCR = 4;
  const SURVEY_AGENT_OCR_MIN_EDGE = 24;
  const SURVEY_AGENT_REPEAT_STUCK_LIMIT = 1;
  const SURVEY_AGENT_PLAN_REPEAT_LIMIT = 3;
  const SURVEY_AGENT_RATE_LIMIT_BACKOFF_INITIAL = 1500;
  const SURVEY_AGENT_RATE_LIMIT_BACKOFF_MAX = 15000;
  const SURVEY_AGENT_PLAN_COOLDOWN_BASE = 520;
  const SURVEY_AGENT_PLAN_COOLDOWN_DELIBERATE = 1500;
  const SURVEY_AGENT_POST_ACTION_DELAY_OK = 240;
  const SURVEY_AGENT_POST_ACTION_DELAY_FAIL = 520;
  const SURVEY_AGENT_POST_ACTION_DELAY_DELIBERATE = 300;
  const SURVEY_AGENT_DOM_CACHE_TTL = 1200;
  const SURVEY_AGENT_DOM_CACHE_PERSIST_TTL = 5000;
  const SURVEY_AGENT_DOM_CACHE_STORAGE_KEY = '__zepraSurveyDomCacheV1__';
  const SURVEY_AGENT_IDENTITY_FIELD_ORDER = [
    'identityName',
    'fullName',
    'firstName',
    'lastName',
    'username',
    'password',
    'email',
    'phone',
    'age',
    'address1',
    'address2',
    'city',
    'state',
    'zipCode',
    'country',
    'companyName',
    'companyIndustry',
    'companySize',
    'companyAnnualRevenue',
    'companyWebsite',
    'companyAddress',
    'macAddress',
  ];

  function getSurveyAgentSession() {
    return STATE.surveyAgent.session;
  }

  function getSurveyAgentUiState() {
    return STATE.surveyAgent.ui;
  }

  function ensureSurveyAgentStyles() {
    const ui = getSurveyAgentUiState();
    if (ui.styleEl && ui.styleEl.isConnected) return;
    const style = document.createElement('style');
    style.id = 'zepra-survey-agent-styles';
    style.textContent = `
      #zepra-survey-agent-panel {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: min(420px, 100vw);
        z-index: 2147483646;
        display: flex;
        transform: translateX(110%);
        transition: transform 0.28s ease, box-shadow 0.28s ease;
        pointer-events: none;
      }

      #zepra-survey-agent-panel.is-open {
        transform: translateX(0);
        pointer-events: auto;
        box-shadow: -28px 0 48px rgba(11, 16, 33, 0.58);
      }

      #zepra-survey-agent-panel.is-closing {
        pointer-events: none;
      }

      #zepra-survey-agent-panel .nano-agent-window {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(7, 12, 24, 0.96));
        backdrop-filter: blur(26px);
        border-left: 1px solid rgba(125, 211, 252, 0.14);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 30px 60px -40px rgba(15, 23, 42, 0.95);
        color: #e8f1ff;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        letter-spacing: 0.01em;
      }

      #zepra-survey-agent-panel .nano-agent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.15rem 1.5rem 1rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.82), rgba(17, 24, 39, 0.92));
        backdrop-filter: blur(24px);
        box-shadow: inset 0 -1px 0 rgba(6, 11, 23, 0.8);
      }

      #zepra-survey-agent-panel .nano-brand {
        display: flex;
        align-items: center;
        gap: 0.9rem;
      }

      #zepra-survey-agent-panel .nano-logo {
        width: 40px;
        height: 40px;
        border-radius: 14px;
        background: linear-gradient(135deg, #60a5fa, #38bdf8);
        color: #041021;
        font-size: 1.1rem;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.08em;
        box-shadow: 0 22px 44px -26px rgba(56, 189, 248, 0.85);
      }

      #zepra-survey-agent-panel .nano-heading {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      #zepra-survey-agent-panel .nano-title {
        font-weight: 600;
        font-size: 1.05rem;
        color: #f1f7ff;
        letter-spacing: 0.02em;
      }

      #zepra-survey-agent-panel .nano-status-line {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      #zepra-survey-agent-panel .nano-status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border-radius: 999px;
        padding: 0.24rem 0.7rem;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(30, 41, 59, 0.6);
        color: rgba(226, 232, 240, 0.82);
        font-size: 0.74rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      #zepra-survey-agent-panel .nano-status-badge::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16);
      }

      #zepra-survey-agent-panel .nano-status-badge.is-running {
        border-color: rgba(56, 189, 248, 0.4);
        background: rgba(14, 165, 233, 0.22);
        color: #7dd3fc;
      }

      #zepra-survey-agent-panel .nano-status-badge.is-success {
        border-color: rgba(74, 222, 128, 0.35);
        background: rgba(22, 163, 74, 0.26);
        color: #bbf7d0;
      }

      #zepra-survey-agent-panel .nano-status-badge.is-error {
        border-color: rgba(248, 113, 113, 0.34);
        background: rgba(153, 27, 27, 0.32);
        color: #fecaca;
      }

      #zepra-survey-agent-panel .nano-status-badge.is-warning {
        border-color: rgba(253, 224, 71, 0.34);
        background: rgba(202, 138, 4, 0.32);
        color: #fde68a;
      }

      #zepra-survey-agent-panel .nano-status-text {
        font-size: 0.78rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(203, 213, 225, 0.68);
      }

      #zepra-survey-agent-panel .nano-header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      #zepra-survey-agent-panel .nano-run-toggle {
        border-radius: 0.9rem;
        border: 1px solid rgba(59, 130, 246, 0.35);
        padding: 0.46rem 1.05rem;
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.35), rgba(56, 189, 248, 0.28));
        color: #dbeafe;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 600;
        font-size: 0.72rem;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border 0.2s ease, background 0.2s ease;
      }

      #zepra-survey-agent-panel .nano-run-toggle.is-stop {
        border-color: rgba(248, 113, 113, 0.38);
        background: linear-gradient(135deg, rgba(248, 113, 113, 0.28), rgba(244, 63, 94, 0.2));
        color: #fecaca;
      }

      #zepra-survey-agent-panel .nano-run-toggle:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      #zepra-survey-agent-panel .nano-run-toggle:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 28px -20px rgba(37, 99, 235, 0.6);
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.45), rgba(56, 189, 248, 0.32));
      }

      #zepra-survey-agent-panel .survey-agent-close {
        background: transparent;
        border: none;
        color: rgba(149, 191, 255, 0.68);
        width: 34px;
        height: 34px;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1.35rem;
        line-height: 1;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }

      #zepra-survey-agent-panel .survey-agent-close:hover {
        background: rgba(30, 64, 175, 0.42);
        color: #fff;
      }

      #zepra-survey-agent-panel .nano-controls {
        padding: 12px 18px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(11, 24, 45, 0.68);
        border-top: 1px solid rgba(59, 130, 246, 0.1);
        border-bottom: 1px solid rgba(56, 189, 248, 0.12);
      }

      #zepra-survey-agent-panel .nano-toggle {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        font-size: 0.82rem;
        color: rgba(224, 231, 255, 0.82);
        line-height: 1.45;
      }

      #zepra-survey-agent-panel .nano-toggle input[type="checkbox"] {
        margin-top: 2px;
        width: 16px;
        height: 16px;
        accent-color: #5eead4;
      }

      #zepra-survey-agent-panel .nano-toggle span {
        flex: 1;
      }

      #zepra-survey-agent-panel .nano-thread {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.35rem 1.5rem;
        overflow-y: auto;
        scroll-behavior: smooth;
      }

      #zepra-survey-agent-panel .nano-placeholder {
        margin-top: 3rem;
        text-align: center;
        color: rgba(203, 213, 225, 0.6);
        font-size: 0.94rem;
        line-height: 1.6;
      }

      #zepra-survey-agent-panel .nano-messages {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      #zepra-survey-agent-panel .nano-message {
        display: flex;
        align-items: flex-start;
        gap: 0.85rem;
      }

      #zepra-survey-agent-panel .nano-avatar {
        width: 40px;
        height: 40px;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.78rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        box-shadow: 0 18px 36px -26px rgba(15, 118, 255, 0.9);
      }

      #zepra-survey-agent-panel .nano-avatar.is-agent {
        background: linear-gradient(135deg, rgba(45, 212, 191, 0.3), rgba(14, 165, 233, 0.38));
        color: #ecfeff;
      }

      #zepra-survey-agent-panel .nano-avatar.is-user {
        background: linear-gradient(135deg, rgba(79, 70, 229, 0.32), rgba(59, 130, 246, 0.38));
        color: #e0e7ff;
      }

      #zepra-survey-agent-panel .nano-bubble {
        flex: 1;
        background: linear-gradient(160deg, rgba(11, 22, 45, 0.9), rgba(6, 16, 34, 0.92));
        border: 1px solid rgba(96, 165, 250, 0.35);
        border-radius: 1.1rem;
        padding: 0.85rem 1.05rem;
        color: #e9f2ff;
        line-height: 1.6;
        position: relative;
        box-shadow: 0 24px 46px -32px rgba(59, 130, 246, 0.55);
      }

      #zepra-survey-agent-panel .nano-message.is-agent .nano-bubble {
        border-color: rgba(45, 212, 191, 0.35);
        box-shadow: 0 24px 46px -30px rgba(45, 212, 191, 0.55);
      }

      #zepra-survey-agent-panel .nano-message[data-meta="error"] .nano-bubble {
        border-color: rgba(248, 113, 113, 0.4);
        background: linear-gradient(160deg, rgba(67, 20, 36, 0.9), rgba(88, 28, 58, 0.92));
        color: #fecaca;
      }

      #zepra-survey-agent-panel .nano-message[data-meta="warning"] .nano-bubble {
        border-color: rgba(253, 224, 71, 0.4);
        background: linear-gradient(160deg, rgba(80, 57, 16, 0.9), rgba(113, 63, 18, 0.92));
        color: #fde68a;
      }

      #zepra-survey-agent-panel .nano-message[data-meta="plan"] .nano-bubble {
        border-color: rgba(96, 165, 250, 0.42);
        background: linear-gradient(160deg, rgba(17, 34, 68, 0.92), rgba(13, 26, 54, 0.94));
      }

      #zepra-survey-agent-panel .nano-message-meta {
        margin-top: 0.45rem;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(191, 219, 254, 0.5);
      }

      #zepra-survey-agent-panel .nano-compose {
        padding: 1.15rem 1.5rem 1.45rem;
        border-top: 1px solid rgba(148, 163, 184, 0.16);
        background: linear-gradient(180deg, rgba(8, 15, 30, 0.94), rgba(6, 12, 24, 0.98));
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      #zepra-survey-agent-panel .nano-compose textarea {
        width: 100%;
        min-height: 64px;
        border-radius: 1rem;
        border: 1px solid rgba(96, 165, 250, 0.28);
        background: rgba(12, 19, 36, 0.78);
        color: #f1f5ff;
        padding: 0.9rem 1.05rem;
        resize: vertical;
        font-family: inherit;
        font-size: 0.95rem;
        line-height: 1.6;
        transition: border 0.2s ease, box-shadow 0.2s ease;
      }

      #zepra-survey-agent-panel .nano-compose textarea::placeholder {
        color: rgba(148, 163, 184, 0.65);
      }

      #zepra-survey-agent-panel .nano-compose textarea:focus {
        outline: none;
        border-color: rgba(56, 189, 248, 0.6);
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.38), 0 18px 38px -32px rgba(56, 189, 248, 0.6);
      }

      #zepra-survey-agent-panel .nano-compose footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.85rem;
      }

      #zepra-survey-agent-panel .nano-compose .nano-hint {
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(203, 213, 225, 0.58);
      }

      #zepra-survey-agent-panel .nano-compose .nano-send {
        border-radius: 0.95rem;
        padding: 0.65rem 1.25rem;
        border: none;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(14, 165, 233, 0.95));
        color: #f0f9ff;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
      }

      #zepra-survey-agent-panel .nano-compose .nano-send:disabled {
        opacity: 0.42;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      #zepra-survey-agent-panel .nano-compose .nano-send:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 32px -24px rgba(59, 130, 246, 0.85);
      }

      #zepra-survey-agent-panel .nano-thread::-webkit-scrollbar {
        width: 8px;
      }

      #zepra-survey-agent-panel .nano-thread::-webkit-scrollbar-track {
        background: rgba(8, 20, 45, 0.78);
      }

      #zepra-survey-agent-panel .nano-thread::-webkit-scrollbar-thumb {
        background: rgba(88, 136, 226, 0.45);
        border-radius: 999px;
      }

      #zepra-survey-agent-panel .nano-thread::-webkit-scrollbar-thumb:hover {
        background: rgba(110, 162, 255, 0.58);
      }

      @media (max-width: 600px) {
        #zepra-survey-agent-panel {
          width: 100vw;
        }

        #zepra-survey-agent-panel .nano-agent-header,
        #zepra-survey-agent-panel .nano-thread,
        #zepra-survey-agent-panel .nano-compose {
          padding-left: 1rem;
          padding-right: 1rem;
        }
      }

    `;
    document.head.appendChild(style);
    ui.styleEl = style;
  }
  function formatTimeShort(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function renderSurveyAgentChat() {
    const session = getSurveyAgentSession();
    const ui = getSurveyAgentUiState();
    const elements = ui.elements || {};
    const thread = elements.chatThread;
    if (!thread) return;

    const chatBody = elements.chatBody;
    const chatEmpty = elements.chatEmpty;
    thread.innerHTML = '';

    const chat = Array.isArray(session.chat) ? session.chat : [];
    if (!chat.length) {
      thread.style.display = 'none';
      if (chatEmpty) chatEmpty.style.display = 'block';
      if (chatBody) chatBody.scrollTop = 0;
      return;
    }

    thread.style.display = 'flex';
    if (chatEmpty) chatEmpty.style.display = 'none';

    chat.forEach((entry) => {
      if (!entry || typeof entry.text !== 'string') return;
      const role = entry.role === 'agent' || entry.role === 'system' ? 'agent' : 'user';
      const item = document.createElement('div');
      item.className = `nano-message is-${role}`;
      if (entry.meta) {
        item.dataset.meta = entry.meta;
      } else {
        delete item.dataset.meta;
      }

      const avatar = document.createElement('div');
      avatar.className = `nano-avatar is-${role}`;
      avatar.textContent = role === 'agent' ? 'A' : 'YOU';
      item.appendChild(avatar);

      const bubble = document.createElement('div');
      bubble.className = 'nano-bubble';
      bubble.textContent = entry.text;
      item.appendChild(bubble);

      if (entry.timestamp) {
        const stamp = document.createElement('div');
        stamp.className = 'nano-message-meta';
        stamp.textContent = formatTimeShort(entry.timestamp);
        item.appendChild(stamp);
      }

      thread.appendChild(item);
    });

    if (chatBody) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  }

  function appendSurveyAgentChatMessage(message) {
    if (!message || typeof message.text !== 'string') return;
    const text = message.text.trim();
    if (!text) return;
    const session = getSurveyAgentSession();
    if (!Array.isArray(session.chat)) session.chat = [];
    const entry = {
      id: message.id || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: message.role === 'agent' || message.role === 'system' ? message.role : 'user',
      text,
      timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
    };
    if (message.meta) {
      entry.meta = message.meta;
    }
    session.chat.push(entry);
    if (session.chat.length > SURVEY_AGENT_MAX_CHAT_MESSAGES) {
      session.chat.splice(0, session.chat.length - SURVEY_AGENT_MAX_CHAT_MESSAGES);
    }
    renderSurveyAgentChat();
  }

  const SURVEY_AGENT_STATUS_METAS = new Set(['status', 'plan', 'warning', 'error', 'progress']);
  const SURVEY_AGENT_CHAT_METAS = new Set([
    'chat',
    'reply',
    'ask',
    'summary',
    'greeting',
    'ack',
    'ack-running',
    'ack-idle',
    'operator',
    'plan-outline',
    'progress-update',
  ]);

  function setSurveyAgentStatusMessage(text, tone = 'status') {
    const session = getSurveyAgentSession();
    if (!session) return;
    const message = typeof text === 'string' ? text.trim() : '';
    const nextTone = tone || 'status';
    if (session.statusMessage === message && session.statusTone === nextTone) {
      return;
    }
    session.statusMessage = message;
    session.statusTone = nextTone;
    updateSurveyAgentUiState();
  }

  function appendSurveyAgentChatAck(text, meta = 'ack') {
    const session = getSurveyAgentSession();
    if (!text) return;
    const chat = Array.isArray(session.chat) ? session.chat : [];
    const last = chat[chat.length - 1];
    if (last && last.role === 'agent' && last.meta === meta && last.text === text) {
      return;
    }
    appendSurveyAgentChatMessage({ role: 'agent', text, meta });
  }

  function getLastAgentMessage(session) {
    if (!session || !Array.isArray(session.chat)) return null;
    for (let idx = session.chat.length - 1; idx >= 0; idx -= 1) {
      const entry = session.chat[idx];
      if (entry && entry.role === 'agent') {
        return entry;
      }
    }
    return null;
  }

  function appendSurveyAgentAgentMessage(text, meta = 'status') {
    if (!text) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const session = getSurveyAgentSession();
    if (SURVEY_AGENT_STATUS_METAS.has(meta)) {
      setSurveyAgentStatusMessage(trimmed, meta);
      return;
    }
    const lastAgent = getLastAgentMessage(session);
    const chatMeta = SURVEY_AGENT_CHAT_METAS.has(meta) ? meta : 'chat';
    if (lastAgent && lastAgent.text === trimmed && lastAgent.meta === chatMeta) {
      return;
    }
    appendSurveyAgentChatMessage({ role: 'agent', text: trimmed, meta: chatMeta });
  }

  function updateSurveyAgentPhase(session, phase, message, meta = 'status') {
    if (!session) return;
    if (session.currentPhase === phase) {
      if (message) {
        appendSurveyAgentAgentMessage(message, meta);
      }
      return;
    }
    session.currentPhase = phase;
    if (message) {
      appendSurveyAgentAgentMessage(message, meta);
    }
  }

  function ensureSurveyAgentChatGreeting() {
    const session = getSurveyAgentSession();
    if (Array.isArray(session.chat) && session.chat.length) return;
    appendSurveyAgentChatMessage({
      role: 'agent',
      text: 'أهلاً! ازاي أقدر أساعدك؟',
      meta: 'greeting',
    });
  }

  function handleSurveyAgentChatSubmit() {
    const ui = getSurveyAgentUiState();
    const input = ui.elements && ui.elements.chatInput;
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    const session = getSurveyAgentSession();
    const shouldAutoStart = !session.running;
    sendSurveyAgentUserMessage(value);
    input.value = '';
    if (ui.elements && ui.elements.chatSend) {
      ui.elements.chatSend.disabled = true;
    }
    input.focus();
    if (shouldAutoStart) {
      startSurveyAgentRun({ instructions: value });
    }
  }

  function sendSurveyAgentUserMessage(text) {
    const session = getSurveyAgentSession();
    appendSurveyAgentChatMessage({ role: 'user', text, meta: 'operator' });
    appendSurveyAgentLog({ level: 'info', label: 'Operator', message: text });
    if (text && typeof text === 'string') {
      session.instructions = text;
      session.goal = text;
    }
    if (session.running) {
      appendSurveyAgentChatAck('تمام، هنفذ ده حالاً.', 'ack-running');
      setSurveyAgentStatusMessage('مستمر في تنفيذ المطلوب.', 'plan');
    } else {
      appendSurveyAgentChatAck('تمام، هابدأ دلوقتي.', 'ack-idle');
    }
  }

  function buildSurveyAgentPlannerConversation(limit = SURVEY_AGENT_CHAT_CONTEXT_LIMIT) {
    const session = getSurveyAgentSession();
    const chat = Array.isArray(session.chat) ? session.chat : [];
    if (!chat.length) return [];
    const slice = chat.slice(-Math.max(3, limit));
    return slice
      .filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim())
      .map((entry) => ({
        role: entry.role === 'agent' ? 'agent' : entry.role === 'system' ? 'system' : 'user',
        text: entry.text.trim(),
        meta: entry.meta || undefined,
        timestamp: entry.timestamp || Date.now(),
      }));
  }

  function renderSurveyAgentLogs() {
    const session = getSurveyAgentSession();
    const ui = getSurveyAgentUiState();
    const elements = ui.elements || {};
    if (!elements.logList) return;

    const { logList, logBody, emptyState } = elements;
    logList.innerHTML = '';

    if (!session.logs.length) {
      if (emptyState) emptyState.style.display = 'flex';
      logList.style.display = 'none';
      if (logBody) logBody.scrollTop = 0;
      return;
    }

    logList.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';

    session.logs.forEach((entry) => {
      const item = document.createElement('div');
      item.className = `survey-agent-log-item level-${entry.level || 'info'}`;

      const header = document.createElement('div');
      header.className = 'survey-agent-log-item-header';

      const label = document.createElement('span');
      label.className = 'survey-agent-log-item-label';
      label.textContent = entry.label || entry.level || 'info';

      const time = document.createElement('span');
      time.className = 'survey-agent-log-item-time';
      time.textContent = formatTimeShort(entry.timestamp);

      header.appendChild(label);
      header.appendChild(time);
      item.appendChild(header);

      if (entry.message) {
        const message = document.createElement('div');
        message.className = 'survey-agent-log-item-message';
        message.textContent = entry.message;
        item.appendChild(message);
      }

      if (entry.detail) {
        const detail = document.createElement('div');
        detail.className = 'survey-agent-log-item-detail';
        detail.textContent = entry.detail;
        item.appendChild(detail);
      }

      logList.appendChild(item);
    });

    if (logBody) {
      logBody.scrollTop = logBody.scrollHeight;
    }
  }

  function surveyAgentStatusDescriptor(session) {
    const steps = session.history.length;
    const plans = session.planCount;
    const stepLabel = steps === 1 ? 'خطوة' : 'خطوات';
    const planLabel = plans === 1 ? 'خطة' : 'خطط';
    const counts = `${steps} ${stepLabel} • ${plans} ${planLabel}`;
    const toneRaw = session.statusTone || 'status';
    const tone = toneRaw === 'warning' || toneRaw === 'error' ? toneRaw : 'status';
    const statusMessage = session.statusMessage ? session.statusMessage : '';
    const meta = statusMessage
      ? counts
        ? `${statusMessage} • ${counts}`
        : statusMessage
      : counts;

    if (session.running && session.stopRequested) {
      return { label: 'جاري الإيقاف', badge: 'is-warning', meta };
    }

    if (session.running) {
      let label = 'قيد العمل';
      let badge = 'is-running';
      switch (session.status) {
        case 'scanning':
          label = 'مسح الصفحة';
          break;
        case 'planning':
          label = 'تخطيط الحركة';
          break;
        case 'executing':
          label = 'تنفيذ الخطوة';
          break;
        case 'review':
          label = 'مراجعة التقدّم';
          break;
        case 'rate-limit':
          label = 'تهدئة السرعة';
          badge = 'is-warning';
          break;
        case 'loop-guard':
          label = 'بحاجة لتوجيه';
          badge = 'is-warning';
          break;
        default:
          label = 'قيد العمل';
          break;
      }
      if (tone === 'warning') {
        badge = 'is-warning';
      } else if (tone === 'error') {
        badge = 'is-error';
      }
      return { label, badge, meta };
    }

    let label;
    let badge;
    switch (session.status) {
      case 'done':
        label = 'اكتمل';
        badge = 'is-success';
        break;
      case 'aborted':
        label = 'أُلغي';
        badge = 'is-warning';
        break;
      case 'error':
        label = 'خطأ';
        badge = 'is-error';
        break;
      case 'stopped':
        label = 'متوقف';
        badge = 'is-warning';
        break;
      default:
        label = 'جاهز';
        badge = 'is-idle';
        break;
    }
    if (tone === 'warning' && badge !== 'is-success') {
      badge = 'is-warning';
    } else if (tone === 'error') {
      badge = 'is-error';
    }
    const fallbackMeta = statusMessage || 'في انتظار تعليماتك.';
    return { label, badge, meta: statusMessage ? meta : `${fallbackMeta} • ${counts}` };
  }

  function updateSurveyAgentUiState() {
    const session = getSurveyAgentSession();
    const ui = getSurveyAgentUiState();
    const elements = ui.elements;
    if (!elements) return;

    const descriptor = surveyAgentStatusDescriptor(session);
    if (elements.statusBadge) {
      elements.statusBadge.textContent = descriptor.label;
      elements.statusBadge.classList.remove('is-running', 'is-success', 'is-warning', 'is-error');
      if (descriptor.badge && descriptor.badge !== 'is-idle') {
        elements.statusBadge.classList.add(descriptor.badge);
      }
    }

    if (elements.statusText) {
      elements.statusText.textContent = descriptor.meta || '';
    }

    if (elements.chatSend) {
      const chatValue = elements.chatInput ? elements.chatInput.value.trim() : '';
      elements.chatSend.disabled = !chatValue;
    }

    renderSurveyAgentChat();
  }

  function truncateForLog(str, max = 72) {
    if (!str) return '';
    const value = String(str);
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
  }

  function appendSurveyAgentLog(entry) {
    const session = getSurveyAgentSession();
    const logEntry = {
      id: entry.id || `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level: entry.level || 'info',
      label: entry.label || '',
      message: entry.message || '',
      detail: entry.detail || '',
      timestamp: entry.timestamp || Date.now(),
    };
    session.logs.push(logEntry);
    if (session.logs.length > SURVEY_AGENT_MAX_LOGS) {
      session.logs.splice(0, session.logs.length - SURVEY_AGENT_MAX_LOGS);
    }
    updateSurveyAgentUiState();
  }

  function formatSurveyAgentAction(step) {
    if (!step || typeof step !== 'object') return '';
    const type = String(step.type || '').toLowerCase();
    const hi = step.locator && Number.isInteger(step.locator.highlightIndex) ? `#${step.locator.highlightIndex}` : '';
    if (type === 'click') {
      return hi ? `نقر العنصر ${hi}` : 'نقر عنصر';
    }
    if (type === 'type') {
      const text = truncateForLog(step.text || step.value || '');
      return hi ? `كتابة "${text}" في ${hi}` : `كتابة "${text}"`;
    }
    if (type === 'select') {
      const text = truncateForLog(step.text || step.option || '');
      return hi ? `اختيار "${text}" من ${hi}` : `اختيار الخيار "${text}"`;
    }
    if (type === 'scroll') {
      if (step.mode === 'percent') {
        return `تمرير حتى ${step.percent ?? 0}%`;
      }
      if (step.mode === 'top') return 'تمرير لأعلى الصفحة';
      if (step.mode === 'bottom') return 'تمرير لأسفل الصفحة';
      return hi ? `تمرير العنصر ${hi} داخل الشاشة` : 'تمرير الصفحة';
    }
    if (type === 'navigate') {
      const url = truncateForLog(step.url || '');
      return `الانتقال إلى ${url || 'الرابط المطلوب'}`;
    }
    if (type === 'back') return 'رجوع للخلف';
    if (type === 'forward') return 'تقدم للأمام';
    if (type === 'reload') return 'إعادة تحميل الصفحة';
    if (type === 'dom_scan') {
      return 'مسح هيكل الصفحة';
    }
    if (type === 'ocr_capture') {
      return 'تشغيل OCR للعنصر المحدد';
    }
    if (type === 'wait') {
      const ms = Number.isFinite(step.ms) ? step.ms : Number(step.duration) || 0;
      return `انتظار ${Math.max(0, Math.round(ms))} مللي ثانية`;
    }
    if (type === 'status') return 'تحديث شريط الحالة';
    if (type === 'ip_info') return 'عرض معلومات الـIP';
    if (type === 'ip_check') return 'تشغيل فحص تأهيل الـIP';
    if (type === 'custom_open') return 'فتح نافذة المساعدة الخارجية';
    if (type === 'open_tab') {
      const url = truncateForLog(step.url || '');
      return `فتح تبويب جديد ${url ? `(${url})` : ''}`.trim();
    }
    if (type === 'note_save') {
      const title = truncateForLog(step.title || '');
      return title ? `حفظ ملاحظة «${title}»` : 'حفظ ملاحظة جديدة';
    }
    return type ? `خطوة ${type}` : 'خطوة';
  }

  function formatSurveyAgentActionEnglish(step) {
    if (!step || typeof step !== 'object') return '';
    const type = String(step.type || '').toLowerCase();
    const locator = step.locator || {};
    const hasHighlight = Number.isInteger(locator.highlightIndex);
    const target = hasHighlight ? `element #${locator.highlightIndex}` : 'the target element';
    const textValue = typeof step.text === 'string' ? step.text : typeof step.value === 'string' ? step.value : '';
    const identityMatch = typeof textValue === 'string' ? textValue.match(/\{\{IDENTITY\.([^}]+)\}\}/i) : null;
    const identityLabel = identityMatch ? identityMatch[1] : '';
    const truncated = textValue ? truncateForLog(textValue, 64) : '';
    switch (type) {
      case 'click':
        return hasHighlight ? `Click ${target}` : 'Click the target element';
      case 'type':
        if (identityLabel) {
          return hasHighlight
            ? `Fill ${target} with identity field ${identityLabel}`
            : `Fill the field with identity field ${identityLabel}`;
        }
        return hasHighlight
          ? `Type "${truncated}" into ${target}`
          : `Type "${truncated}" into the field`;
      case 'select':
        if (identityLabel) {
          return hasHighlight
            ? `Select identity field ${identityLabel} on ${target}`
            : `Select identity field ${identityLabel}`;
        }
        return hasHighlight
          ? `Select option "${truncated}" on ${target}`
          : `Select option "${truncated}"`;
      case 'scroll': {
        if (step.mode === 'percent' && Number.isFinite(step.percent)) {
          return `Scroll page to ${Math.round(step.percent)}%`;
        }
        if (step.mode === 'top') return 'Scroll to page top';
        if (step.mode === 'bottom') return 'Scroll to page bottom';
        if (hasHighlight) return `Scroll ${target} into view`;
        if (Number.isFinite(step.offset)) {
          return `Scroll page by ${Math.round(step.offset)}px`;
        }
        return 'Scroll the page';
      }
      case 'navigate':
        return `Navigate to ${truncateForLog(step.url || '', 80)}`;
      case 'back':
        return 'Navigate back';
      case 'forward':
        return 'Navigate forward';
      case 'reload':
        return 'Reload the page';
      case 'wait': {
        const ms = Number.isFinite(step.ms) ? step.ms : Number(step.duration) || 0;
        return `Wait ${Math.max(0, Math.round(ms))} ms`;
      }
      case 'status':
        return `Update status bar: ${truncateForLog(step.message || step.text || '', 80)}`;
      case 'ip_info':
        return 'Open IP information panel';
      case 'ip_check':
        return 'Run IP qualification check';
      case 'custom_open': {
        if (step.siteKey) {
          return `Open custom web window for "${truncateForLog(step.siteKey, 40)}"`;
        }
        if (step.url) {
          return `Open custom web window to ${truncateForLog(step.url, 80)}`;
        }
        return 'Open custom web window';
      }
      case 'open_tab':
        return step.url ? `Open new tab to ${truncateForLog(step.url, 80)}` : 'Open a new tab';
      case 'note_save':
        return step.title ? `Save note "${truncateForLog(step.title, 60)}"` : 'Save a new note';
      case 'dom_scan':
        return 'Run DOM scan on the current page';
      case 'ocr_capture':
        return 'Capture OCR for the selected region';
      default:
        return type ? `Execute ${type} step` : 'Execute step';
    }
  }

  function describeSurveyAgentPlanStepEnglish(entry) {
    if (!entry) return '';
    switch (entry.kind) {
      case 'dom_scan':
        return 'Run DOM scan on the current page';
      case 'ocr_capture': {
        const reason = entry.reason ? truncateForLog(entry.reason, 60) : '';
        return reason ? `Capture OCR (${reason})` : 'Capture OCR for the target region';
      }
      case 'done':
        return 'Mark task as complete';
      case 'action':
        return formatSurveyAgentActionEnglish(entry.step);
      default:
        return 'Execute next step';
    }
  }

  function describeSurveyAgentPlanStepArabic(entry) {
    if (!entry) return '';
    switch (entry.kind) {
      case 'dom_scan':
        return 'إعادة مسح الصفحة بالـDOM';
      case 'ocr_capture':
        return entry.reason ? `تشغيل OCR: ${entry.reason}` : 'تشغيل OCR للنطاق المحدد';
      case 'done':
        return 'إنهاء المهمة';
      case 'action':
        return formatSurveyAgentAction(entry.step);
      default:
        return 'خطوة';
    }
  }

  function appendSurveyAgentPlanOutline(plan, steps) {
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) return;
    const lines = [];
    list.forEach((entry, idx) => {
      const description = describeSurveyAgentPlanStepEnglish(entry);
      if (description) {
        lines.push(`${idx + 1}. ${description}`);
      }
    });
    if (!lines.length) return;
    if (plan?.meta?.finishWhen) {
      lines.push(`Finish when: ${plan.meta.finishWhen}`);
    }
    const message = `PLAN:\n${lines.join('\n')}`;
    appendSurveyAgentChatMessage({ role: 'agent', text: message, meta: 'plan-outline' });
  }

  function appendSurveyAgentProgressUpdate(index, total, entry) {
    const stepText = describeSurveyAgentPlanStepArabic(entry);
    if (!stepText) return;
    const prefix = `الخطوة ${index}/${total}: `;
    appendSurveyAgentAgentMessage(`${prefix}${stepText}`, 'progress-update');
  }

  function formatSurveyAgentResult(result) {
    if (!result || typeof result !== 'object') return '';
    const details = result.details || {};
    if (details.summary) return details.summary;
    if (details.statusMessage) return details.statusMessage;
    if (details.title && result.code === 'act_noteSave_ok') {
      return `تم حفظ الملاحظة «${truncateForLog(details.title)}»`;
    }
    if (details.skipped) {
      if (details.text) return `موجود بالفعل "${truncateForLog(details.text)}"`;
      if (details.value) return `موجود بالفعل "${truncateForLog(details.value)}"`;
      return 'الحقل مكتمل بالفعل';
    }
    if (details.text) return `القيمة "${truncateForLog(details.text)}"`;
    if (details.value) return `القيمة "${truncateForLog(details.value)}"`;
    if (details.percent !== undefined) return `تم التمرير إلى ${details.percent}%`;
    if (details.position) return `الموضع ${details.position}`;
    if (details.delta !== undefined) return `تمرير بمقدار ${Math.round(details.delta)}px`;
    if (details.url) return truncateForLog(details.url);
    if (details.index !== undefined) return `الخيار رقم ${details.index}`;
    if (result.code) return result.code;
    return '';
  }

  function getSurveyAgentStepSignature(step) {
    if (!step || typeof step !== 'object') return '';
    const type = typeof step.type === 'string' ? step.type.toLowerCase() : '';
    const locator = step.locator || {};
    const highlight = Number.isInteger(locator.highlightIndex) ? locator.highlightIndex : '';
    const xpath = locator.xpath || locator.cssSelector || locator.css || '';
    const framePath = Array.isArray(locator.frameChain)
      ? locator.frameChain
          .map((frame) => (frame && frame.xpath) || (Number.isInteger(frame?.index) ? `#${frame.index}` : ''))
          .filter(Boolean)
          .join('>')
      : '';
    const text = type === 'type' || type === 'select' ? step.text || step.value || '' : '';
    const url = type === 'navigate' ? step.url || '' : '';
    return [type, highlight, xpath, framePath, text, url]
      .map((part) => (part === undefined || part === null ? '' : String(part).trim()))
      .join('|');
  }

  function inferQuestionFromLocator(locator = {}) {
    try {
      const resolved = resolveSurveyAgentElement(locator);
      if (resolved && resolved.element) {
        return getElementLabelText(resolved.element) || extractElementText(resolved.element);
      }
    } catch (err) {
      // ignore resolution errors
    }
    return '';
  }

  function buildSurveyAgentHistoryRecord(session, status) {
    if (!session || typeof session !== 'object') return null;
    const answers = [];
    for (const entry of Array.isArray(session.history) ? session.history : []) {
      const step = entry?.step || entry?.action || {};
      const result = entry?.result || entry || {};
      const type = String(step.type || '').toLowerCase();
      if (type !== 'type' && type !== 'select') continue;
      const locator = step.locator || {};
      const details = result.details || {};
      const answerText = type === 'select'
        ? details.text || details.value || step.text || ''
        : details.text || step.text || '';
      if (!answerText) continue;
      const question = details.question || inferQuestionFromLocator(locator);
      answers.push({
        type,
        highlightIndex: Number.isInteger(locator.highlightIndex) ? locator.highlightIndex : null,
        identityKey: details.identityKey || null,
        question: question || '',
        answer: answerText,
      });
    }
    if (!answers.length) return null;

    const logs = (session.logs || []).map((entry) => ({
      level: entry.level,
      label: entry.label,
      message: entry.message,
      detail: entry.detail,
      timestamp: entry.timestamp,
    }));
    const chat = (session.chat || [])
      .filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim())
      .map((entry) => ({
        role: entry.role === 'agent' || entry.role === 'system' ? entry.role : 'user',
        text: entry.text.trim(),
        timestamp: entry.timestamp,
        meta: entry.meta,
      }));
    return {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url: location.href,
      title: document.title,
      startedAt: session.startedAt || Date.now(),
      completedAt: session.completedAt || Date.now(),
      status,
      goal: session.goal || '',
      instructions: session.instructions || '',
      answers,
      logs: logs.slice(-80),
      chat: chat.slice(-SURVEY_AGENT_MAX_CHAT_MESSAGES),
    };
  }

  async function persistSurveyAgentHistory(session, status) {
    const record = buildSurveyAgentHistoryRecord(session, status);
    if (!record) return;
    try {
      await chrome.runtime.sendMessage({ type: 'SURVEY_AGENT_SAVE_HISTORY', record });
    } catch (err) {
      console.warn('Survey agent history save failed', err);
    }
  }

  function finalizeSurveyAgentSession(session, status, message) {
    session.running = false;
    session.stopRequested = false;
    session.status = status;
    session.completedAt = Date.now();
    session.loopPromise = null;
    session.currentPhase = null;
    session.rateLimitBackoffMs = 0;
    session.repeatPlanCount = 0;
    session.lastPlanSignature = '';
    session.lastExecutedSignature = '';
    session.repeatedSuccessCount = 0;
    session.statusTone = 'status';
    if (message) {
      appendSurveyAgentLog({
        level: status === 'done' ? 'success' : status === 'error' ? 'error' : 'info',
        label: 'Agent',
        message,
      });
    } else {
      updateSurveyAgentUiState();
    }
    let summaryMessage;
    if (message) {
      summaryMessage = message;
    } else {
      switch (status) {
        case 'done':
          summaryMessage = 'تم إنهاء المهمة بنجاح.';
          break;
        case 'aborted':
          summaryMessage = 'أوقفت الخطة بطلب منك.';
          break;
        case 'error':
          summaryMessage = 'توقفت لأن فيه خطأ يحتاج تدخل منك.';
          break;
        case 'stopped':
          summaryMessage = 'أوقفت التشغيل وتم حفظ التقدم.';
          break;
        default:
          summaryMessage = 'الوكيل جاهز لتعليمات جديدة.';
          break;
      }
    }
    const tone = status === 'error' ? 'error' : status === 'aborted' || status === 'stopped' ? 'warning' : 'status';
    setSurveyAgentStatusMessage(summaryMessage, tone);
    if (summaryMessage) {
      appendSurveyAgentAgentMessage(summaryMessage, 'summary');
    }
    invalidateSurveyAgentDomCache();
    if (status === 'done') {
      const payload = {
        history: Array.isArray(session.history) ? [...session.history] : [],
        logs: Array.isArray(session.logs) ? [...session.logs] : [],
        goal: session.goal,
        instructions: session.instructions,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        chat: Array.isArray(session.chat) ? [...session.chat] : [],
      };
      persistSurveyAgentHistory(payload, status).catch((err) => console.warn('Survey agent history persist failed', err));
    }
  }

  function openSurveyAgentPanel() {
    ensureSurveyAgentStyles();
    const ui = getSurveyAgentUiState();
    if (ui.modal && ui.modal.isConnected && !ui.modal.classList.contains('is-closing')) {
      updateSurveyAgentUiState();
      return ui.modal;
    }

    const session = getSurveyAgentSession();
    if (!session.goal) session.goal = SURVEY_AGENT_DEFAULT_GOAL;

    const panelHtml = `
      <div class="nano-agent-window">
        <header class="nano-agent-header">
          <div class="nano-brand">
            <span class="nano-logo">Z</span>
            <div class="nano-heading">
              <div class="nano-title">وكيل Zepra</div>
              <div class="nano-status-line">
                <span class="nano-status-badge is-idle">جاهز</span>
                <span class="nano-status-text">في انتظار تعليماتك.</span>
              </div>
            </div>
          </div>
          <div class="nano-header-actions">
            <button type="button" class="survey-agent-close" aria-label="إغلاق الوكيل">&times;</button>
          </div>
        </header>
        <section class="nano-thread">
          <div class="nano-placeholder">اكتب تعليماتك وسيبدأ الوكيل فورًا.</div>
          <div class="nano-messages"></div>
        </section>
        <form class="nano-compose">
          <textarea class="nano-input" rows="3" placeholder="اكتب ما تريد أن أنفذه…"></textarea>
          <footer>
            <span class="nano-hint">Shift+Enter لسطر جديد</span>
            <button type="submit" class="nano-send" disabled>إرسال</button>
          </footer>
        </form>
      </div>
    `;

    const panel = createSurveyAgentPanel('وكيل Zepra', panelHtml, () => {
      const currentUi = getSurveyAgentUiState();
      if (currentUi.modal === panel) {
        currentUi.modal = null;
        currentUi.elements = null;
      }
    });

    ui.modal = panel;
    ui.elements = {
      statusBadge: panel.querySelector('.nano-status-badge'),
      statusText: panel.querySelector('.nano-status-text'),
      chatBody: panel.querySelector('.nano-thread'),
      chatThread: panel.querySelector('.nano-messages'),
      chatEmpty: panel.querySelector('.nano-placeholder'),
      chatInput: panel.querySelector('.nano-input'),
      chatSend: panel.querySelector('.nano-send'),
      chatForm: panel.querySelector('.nano-compose'),
    };

    syncSurveyAgentSettingsToUi();

    if (ui.elements.chatForm) {
      ui.elements.chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        handleSurveyAgentChatSubmit();
      });
    }

    if (ui.elements.chatSend) {
      ui.elements.chatSend.addEventListener('click', (event) => {
        event.preventDefault();
        handleSurveyAgentChatSubmit();
      });
    }

    if (ui.elements.chatInput) {
      ui.elements.chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          handleSurveyAgentChatSubmit();
        }
      });
      ui.elements.chatInput.addEventListener('input', () => {
        if (ui.elements.chatSend) {
          ui.elements.chatSend.disabled = !ui.elements.chatInput.value.trim();
        }
      });
    }

    ensureSurveyAgentChatGreeting();
    if (ui.elements.chatSend) {
      ui.elements.chatSend.disabled = !ui.elements.chatInput || !ui.elements.chatInput.value.trim();
    }

    if (ui.elements.chatInput) {
      setTimeout(() => {
        try {
          ui.elements.chatInput.focus();
        } catch (err) {
          // ignore focus errors
        }
      }, 60);
    }

    updateSurveyAgentUiState();
    return panel;
  }

  function startSurveyAgentRun(options = {}) {
    const session = getSurveyAgentSession();
    if (session.running) {
      showNotification('الوكيل شغال بالفعل حالياً');
      return;
    }
    session.history = [];
    session.planCount = 0;
    session.errorCount = 0;
    session.logs = [];
    session.startedAt = Date.now();
    session.completedAt = 0;
    session.stopRequested = false;
    session.status = 'running';
    const runSettings = getSurveyAgentSettings();
    session.useIdentityAnswers = runSettings.useIdentityAnswers !== false;
    session.deliberateMode = Boolean(runSettings.deliberateMode);
    session.goal = SURVEY_AGENT_DEFAULT_GOAL;
    session.rateLimitBackoffMs = 0;
    session.currentPhase = null;
    session.lastPlanSignature = '';
    session.repeatPlanCount = 0;
    session.lastExecutedSignature = '';
    session.repeatedSuccessCount = 0;
    session.lastPlanAt = 0;
    session.lastActionAt = 0;
    invalidateSurveyAgentDomCache();
    if (typeof options.instructions === 'string') {
      session.instructions = options.instructions;
    }
    if (session.instructions) {
      session.goal = session.instructions;
    }
    appendSurveyAgentLog({ level: 'info', label: 'Agent', message: 'بدء تشغيل جديد' });
    const introParts = [];
    if (session.instructions) {
      introParts.push(`جارٍ تنفيذ تعليماتك: «${session.instructions}».`);
    } else {
      introParts.push('جارٍ تجهيز الخطة لمسح الصفحة.');
    }
    if (session.useIdentityAnswers) {
      introParts.push('سأستخدم بيانات الهوية النشطة لأي حقول شخصية.');
    }
    if (session.deliberateMode) {
      introParts.push('وضع التمهل مُفعّل لتفادي التكرار والأخطاء.');
    }
    setSurveyAgentStatusMessage(introParts.join(' '), 'status');
    updateSurveyAgentPhase(session, 'starting', null, 'status');
    session.running = true;
    updateSurveyAgentUiState();

    session.loopPromise = runSurveyAgentLoop(session).finally(() => {
      session.loopPromise = null;
      updateSurveyAgentUiState();
    });
  }

  function stopSurveyAgentRun(reason = 'تم الإيقاف بطلب يدوي') {
    const session = getSurveyAgentSession();
    if (!session.running || session.stopRequested) return;
    session.stopRequested = true;
    session.status = 'stopping';
    appendSurveyAgentLog({ level: 'info', label: 'Agent', message: reason });
    setSurveyAgentStatusMessage('سأوقف التنفيذ بعد الخطوة الحالية.', 'warning');
  }

  async function runSurveyAgentLoop(session) {
    try {
      while (session.running && !session.stopRequested) {
        if (session.history.length >= session.maxSteps) {
          finalizeSurveyAgentSession(session, 'aborted', 'وصلت للحد الأقصى للخطوات.');
          return;
        }

        session.status = 'scanning';
        updateSurveyAgentUiState();
        updateSurveyAgentPhase(session, 'scanning', 'جارٍ مسح الصفحة عن الأسئلة الجديدة…', 'status');

        let domTree;
        try {
          domTree = await collectSurveyDomTree({ showHighlights: false });
        } catch (err) {
          finalizeSurveyAgentSession(session, 'error', `تعذّر قراءة الصفحة: ${err?.message || err}`);
          return;
        }

        if (session.stopRequested) {
          break;
        }

        await ensureSurveyAgentPlanSpacing(session);

        session.status = 'planning';
        updateSurveyAgentUiState();
        updateSurveyAgentPhase(session, 'planning', 'بفكر في أحسن خطوة جاية…', 'plan');

        let planResponse;
        try {
          planResponse = await chrome.runtime.sendMessage({
            type: 'SURVEY_AGENT_PLAN_NEXT',
            domTree,
            history: session.history,
            goal: session.goal,
            instructions: session.instructions ? session.instructions : undefined,
            context: buildSurveyAgentPlanningContext(domTree, session),
            options: buildSurveyAgentPlannerOptions(session),
            conversation: buildSurveyAgentPlannerConversation(),
          });
        } catch (err) {
          planResponse = { ok: false, error: err?.message || String(err) };
        }

        session.lastPlanAt = Date.now();

        if (session.stopRequested) {
          break;
        }

        if (!planResponse || !planResponse.ok) {
          const rawError = planResponse?.error;
          const errorMessage =
            typeof rawError === 'string' && rawError.trim()
              ? rawError.trim()
              : String(rawError || 'Unknown planner failure');
          const errorCode = planResponse?.code || '';
          const normalized = errorMessage.toLowerCase();
          const isRateLimit =
            errorCode === 'CEREBRAS_RATE_LIMIT' ||
            errorCode === 'token_quota_exceeded' ||
            normalized.includes('too_many_tokens') ||
            normalized.includes('tokens per minute');
          if (isRateLimit) {
            session.rateLimitBackoffMs = session.rateLimitBackoffMs
              ? Math.min(Math.round(session.rateLimitBackoffMs * 1.6), SURVEY_AGENT_RATE_LIMIT_BACKOFF_MAX)
              : SURVEY_AGENT_RATE_LIMIT_BACKOFF_INITIAL;
            const waitSeconds = Math.max(1, Math.ceil(session.rateLimitBackoffMs / 1000));
            appendSurveyAgentLog({
              level: 'warn',
              label: 'Planner',
              message: 'تم تهدئة السرعة من المزود',
              detail: errorMessage,
            });
            session.status = 'rate-limit';
            updateSurveyAgentUiState();
            updateSurveyAgentPhase(
              session,
              'rate-limit',
              `مزود Cerebras موقف الطلبات مؤقتًا، هنستنى ${waitSeconds} ثانية وبعدين نحاول تاني.`,
              'warning'
            );
            await sleep(session.rateLimitBackoffMs);
            continue;
          }

        session.errorCount += 1;
        appendSurveyAgentLog({
          level: 'error',
          label: `Plan ${session.planCount + 1}`,
          message: 'خطأ في التخطيط',
          detail: errorMessage,
        });
        appendSurveyAgentAgentMessage(`معرفتش أخطط للخطوة الجاية: ${errorMessage}. هحاول تاني…`, 'error');
        if (session.errorCount >= SURVEY_AGENT_MAX_PLAN_ERRORS) {
          finalizeSurveyAgentSession(session, 'error', 'المخطط فشل أكثر من مرة متتالية.');
          return;
        }
          await sleep(600);
          continue;
        }

        session.rateLimitBackoffMs = 0;
        session.errorCount = 0;
        session.planCount += 1;

        const plan = planResponse;
        const planSteps = Array.isArray(plan.steps) && plan.steps.length
          ? plan.steps.filter(Boolean)
          : plan.step
          ? [{ kind: 'action', step: plan.step }]
          : [];
        if (plan.meta && Array.isArray(plan.meta.statusUpdates) && plan.meta.statusUpdates.length) {
          const updates = plan.meta.statusUpdates;
          const lastUpdate = updates[updates.length - 1];
          for (const update of updates) {
            if (update && update.message) {
              setSurveyAgentStatusMessage(String(update.message), update.tone || 'status');
            }
          }
          if (lastUpdate && lastUpdate.message) {
            appendSurveyAgentLog({
              level: 'status',
              label: 'حالة',
              message: lastUpdate.message,
            });
          }
        }
        const firstActionEntry = planSteps.find((entry) => entry && entry.kind === 'action' && entry.step);
        const primaryStep = firstActionEntry ? firstActionEntry.step : plan.step;
        const planMessage = formatSurveyAgentAction(primaryStep) || 'لا توجد خطوة قابلة للتنفيذ';
        const planDetails = [];
        if (plan.explanation) planDetails.push(plan.explanation.trim());
        if (typeof plan.confidence === 'number' && !Number.isNaN(plan.confidence)) {
          planDetails.push(`الثقة ${(plan.confidence * 100).toFixed(0)}%`);
        }
        appendSurveyAgentLog({
          level: 'plan',
          label: `Plan ${session.planCount}`,
          message: planMessage,
          detail: planDetails.join(' • '),
        });

        appendSurveyAgentPlanOutline(plan, planSteps);

        if (plan.explanation) {
          const meta = plan.status === 'continue' ? 'plan' : 'status';
          appendSurveyAgentAgentMessage(plan.explanation.trim(), meta);
        }

        if (plan.status === 'done') {
          finalizeSurveyAgentSession(session, 'done', plan.explanation || 'تم إنهاء الاستبيان.');
          return;
        }
        if (plan.status === 'abort') {
          finalizeSurveyAgentSession(session, 'aborted', plan.explanation || 'المخطط قرر إيقاف التنفيذ.');
          return;
        }

        if (!primaryStep) {
          session.errorCount += 1;
          appendSurveyAgentLog({
            level: 'error',
            label: `Plan ${session.planCount}`,
            message: 'المخطط لم يرجع خطوة.',
          });
          appendSurveyAgentAgentMessage('الخطة مش واضحة، هراجع الصفحة وأحاول تاني.', 'plan');
          if (session.errorCount >= SURVEY_AGENT_MAX_PLAN_ERRORS) {
            finalizeSurveyAgentSession(session, 'error', 'المخطط أعاد خطوات فارغة أكثر من مرة.');
            return;
          }
          await sleep(400);
          continue;
        }

        const signature = getSurveyAgentStepSignature(primaryStep);
        if (signature) {
          if (session.lastPlanSignature === signature) {
            session.repeatPlanCount = (session.repeatPlanCount || 0) + 1;
          } else {
            session.repeatPlanCount = 0;
          }
          session.lastPlanSignature = signature;
        } else {
          session.lastPlanSignature = '';
          session.repeatPlanCount = 0;
        }

        if (session.repeatPlanCount >= SURVEY_AGENT_PLAN_REPEAT_LIMIT) {
          appendSurveyAgentLog({
            level: 'warning',
            label: 'Loop guard',
            message: 'المخطط كرر نفس الخطوة',
            detail: planMessage,
          });
          session.status = 'loop-guard';
          updateSurveyAgentUiState();
          updateSurveyAgentPhase(
            session,
            'loop-guard',
            'المخطط كرر نفس الخطوة بدون تقدم.',
            'warning'
          );
          appendSurveyAgentAgentMessage('الخطوة مكررة ومفيش تقدم. ممكن تدلّني أعمل إيه بعد كده؟', 'ask');
          session.history.push({
            step: primaryStep ? { ...primaryStep } : undefined,
            result: {
              ok: false,
              status: 'fail',
              code: 'act_errors_repeat_plan',
              error: 'PLAN_REPEATED_WITHOUT_PROGRESS',
              details: { locator: primaryStep?.locator || {}, reason: 'repeat_plan_limit' },
            },
          });
          if (session.history.length > SURVEY_AGENT_HISTORY_LIMIT) {
            session.history = session.history.slice(-SURVEY_AGENT_HISTORY_LIMIT);
          }
          session.repeatPlanCount = 0;
          await sleep(700);
          continue;
        }

        const lastHistoryEntry = session.history[session.history.length - 1];
        const lastSignature = lastHistoryEntry ? getSurveyAgentStepSignature(lastHistoryEntry.step) : '';
        if (signature && lastSignature && signature === lastSignature && lastHistoryEntry?.result?.ok) {
          session.repeatedSuccessCount = (session.repeatedSuccessCount || 0) + 1;
        } else {
          session.repeatedSuccessCount = 0;
        }

        if (session.repeatedSuccessCount >= SURVEY_AGENT_REPEAT_STUCK_LIMIT) {
          appendSurveyAgentLog({
            level: 'warning',
            label: 'Loop guard',
            message: 'الخطوة تكررت بدون تقدم',
            detail: planMessage,
          });
          session.status = 'loop-guard';
          updateSurveyAgentUiState();
          updateSurveyAgentPhase(
            session,
            'loop-guard',
            'نفذت الخطوة لكن الصفحة ما اتغيرتش.',
            'warning'
          );
          appendSurveyAgentAgentMessage('الصفحة ما اتغيرتش بعد الخطوة، ممكن تتأكد أو ترشدني؟', 'ask');
          session.history.push({
            step: primaryStep ? { ...primaryStep } : undefined,
            result: {
              ok: false,
              status: 'fail',
              code: 'act_errors_no_progress',
              error: 'NO_PROGRESS_AFTER_REPEAT',
              details: { locator: primaryStep?.locator || {}, reason: 'repeat_no_progress' },
            },
          });
          if (session.history.length > SURVEY_AGENT_HISTORY_LIMIT) {
            session.history = session.history.slice(-SURVEY_AGENT_HISTORY_LIMIT);
          }
          session.repeatedSuccessCount = 0;
          await sleep(600);
          continue;
        }

        const stepsToExecute = planSteps.length ? planSteps : [{ kind: 'action', step: primaryStep }];
        let executionFailed = false;

        for (let idx = 0; idx < stepsToExecute.length; idx += 1) {
          if (!session.running || session.stopRequested) break;
          const entry = stepsToExecute[idx];
          if (!entry) continue;

          appendSurveyAgentProgressUpdate(idx + 1, stepsToExecute.length, entry);

          if (entry.kind === 'dom_scan') {
            session.status = 'scanning';
            updateSurveyAgentUiState();
            updateSurveyAgentPhase(session, 'scanning', 'جارٍ مسح الصفحة عن الأسئلة الجديدة…', 'status');
            try {
              const tree = await collectSurveyDomTree({ forceRefresh: true });
              const nodeCount = tree?.map ? Object.keys(tree.map).length : 0;
              appendSurveyAgentLog({
                level: 'info',
                label: 'dom.scan',
                message: 'مسح هيكل الصفحة',
                detail: nodeCount ? `العناصر ${nodeCount}` : undefined,
              });
            } catch (err) {
              const errorText = err?.message || String(err);
              appendSurveyAgentLog({ level: 'error', label: 'dom.scan', message: 'فشل مسح الصفحة', detail: errorText });
              appendSurveyAgentAgentMessage(`خطأ أثناء مسح الصفحة: ${errorText}.`, 'error');
              executionFailed = true;
              break;
            }
            continue;
          }

          if (entry.kind === 'ocr_capture') {
            session.status = 'executing';
            updateSurveyAgentUiState();
            updateSurveyAgentPhase(session, 'executing', 'تشغيل OCR للعنصر المحدد…', 'status');
            const ocrResult = await executeSurveyAgentOcrCapture(entry);
            appendSurveyAgentLog({
              level: ocrResult.ok ? 'info' : 'error',
              label: 'OCR',
              message: ocrResult.ok ? 'تم استخراج النص من الصورة' : 'فشل تنفيذ OCR',
              detail: ocrResult.ok ? truncateForLog(ocrResult.details?.text || '', 120) : (ocrResult.error || ocrResult.code),
            });
            if (!ocrResult.ok) {
              appendSurveyAgentAgentMessage(`تعذّر تشغيل OCR: ${ocrResult.error || ocrResult.code}.`, 'error');
              executionFailed = true;
              break;
            }
            if (ocrResult.details?.text) {
              appendSurveyAgentAgentMessage('تم استخراج النص من الصورة بنجاح.', 'summary');
            }
            continue;
          }

          if (entry.kind === 'done') {
            finalizeSurveyAgentSession(session, 'done', plan.explanation || 'تم إنهاء المهمة.');
            return;
          }

          const stepToRun = entry.step || null;
          if (!stepToRun) {
            continue;
          }

          session.status = 'executing';
          updateSurveyAgentUiState();
          const planMessageCurrent = formatSurveyAgentAction(stepToRun) || 'خطوة';
          updateSurveyAgentPhase(session, 'executing', `تنفيذ الخطوة: ${planMessageCurrent}`, 'status');

          let actionResult;
          if ((stepToRun.type || '').toLowerCase() === 'wait') {
            const waitMs = Number.isFinite(stepToRun.ms)
              ? Math.max(0, stepToRun.ms)
              : Math.max(0, Number(stepToRun.duration) || 0);
            appendSurveyAgentLog({ level: 'info', label: 'انتظار', message: `انتظار ${Math.round(waitMs)} مللي ثانية` });
            await sleep(waitMs);
            actionResult = { ok: true, code: 'act_wait_ok', details: { ms: waitMs }, status: 'ok' };
          } else {
            try {
              actionResult = await executeSurveyAgentAction(stepToRun);
            } catch (err) {
              actionResult = { ok: false, error: err?.message || String(err), code: err?.code };
            }
          }

          const normalizedResult = {
            ok: Boolean(actionResult?.ok),
            code: actionResult?.code || (actionResult?.ok ? 'act_unknown_ok' : 'act_unknown_fail'),
            details: actionResult?.details || {},
            error: actionResult?.error,
            status: actionResult?.status || (actionResult?.ok === false ? 'fail' : 'ok'),
          };

          const executedStep = { ...stepToRun };
          if (normalizedResult.details && typeof normalizedResult.details.text === 'string') {
            if (executedStep.type === 'type' || executedStep.type === 'select') {
              executedStep.text = normalizedResult.details.text;
            }
          }

          session.history.push({ step: executedStep, result: normalizedResult });
          if (session.history.length > SURVEY_AGENT_HISTORY_LIMIT) {
            session.history = session.history.slice(-SURVEY_AGENT_HISTORY_LIMIT);
          }

          session.lastExecutedSignature = getSurveyAgentStepSignature(executedStep) || '';
          if (normalizedResult.ok) {
            session.repeatedSuccessCount = 0;
          }

          appendSurveyAgentLog({
            level: normalizedResult.ok ? 'success' : 'error',
            label: normalizedResult.ok ? 'الخطوة' : 'فشل الخطوة',
            message: planMessageCurrent,
            detail: normalizedResult.ok ? formatSurveyAgentResult(normalizedResult) : (normalizedResult.error || normalizedResult.code),
          });

          if (!normalizedResult.ok) {
            const failureDetail = normalizedResult.error || normalizedResult.code || 'فشل الخطوة';
            appendSurveyAgentAgentMessage(`الخطوة فشلت: ${failureDetail}. هعدّل وحاول تاني.`, 'error');
            session.lastActionAt = Date.now();
            executionFailed = true;
            break;
          }

          const stepType = (executedStep.type || '').toLowerCase();
          if (
            stepType &&
            !['wait', 'status', 'ip_info', 'ip_check', 'custom_open', 'note_save', 'open_tab', 'ocr_capture', 'dom_scan'].includes(stepType)
          ) {
            invalidateSurveyAgentDomCache();
          }

          session.lastActionAt = Date.now();
          const baseDelay = normalizedResult.ok ? SURVEY_AGENT_POST_ACTION_DELAY_OK : SURVEY_AGENT_POST_ACTION_DELAY_FAIL;
          const deliberateDelay = session.deliberateMode ? SURVEY_AGENT_POST_ACTION_DELAY_DELIBERATE : 0;
          await sleep(baseDelay + deliberateDelay);
        }

        if (executionFailed) {
          session.status = 'review';
          updateSurveyAgentUiState();
          updateSurveyAgentPhase(session, 'review', 'براجع الصفحة قبل التخطيط للخطوة الجاية.', 'status');
          continue;
        }

        session.status = 'review';
        updateSurveyAgentUiState();
        updateSurveyAgentPhase(session, 'review', 'براجع الصفحة قبل التخطيط للخطوة الجاية.', 'status');
      }

      if (session.stopRequested) {
        finalizeSurveyAgentSession(session, 'stopped', 'تم الإيقاف بناءً على طلبك.');
      } else if (session.running) {
        finalizeSurveyAgentSession(session, 'done');
      }
    } catch (err) {
      finalizeSurveyAgentSession(session, 'error', `خطأ في الوكيل: ${err?.message || err}`);
    }
  }

  function evaluateXPathInDocument(xpath, doc) {
    if (!xpath || !doc) return null;
    const trimmed = String(xpath).trim();
    if (!trimmed) return null;
    const attempts = [];
    if (trimmed.startsWith('/') || trimmed.startsWith('.')) {
      attempts.push(trimmed);
    } else {
      attempts.push(`//${trimmed}`);
      attempts.push(`/${trimmed}`);
    }
    for (const attempt of attempts) {
      try {
        const result = doc.evaluate(attempt, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result && result.singleNodeValue) {
          return result.singleNodeValue;
        }
      } catch (e) {
        // ignore evaluation errors
      }
    }
    return null;
  }

  function resolveSurveyAgentElement(locator = {}) {
    const resolved = {
      element: null,
      frameElements: [],
      frameChain: [],
      highlightEntry: null,
      reason: null,
      doc: document,
    };

    const highlightIndex = Number.isInteger(locator.highlightIndex) ? locator.highlightIndex : null;
    const state = STATE.surveyAgent;
    let highlightEntry = null;
    if (highlightIndex !== null && state.highlightLookup instanceof Map) {
      highlightEntry = state.highlightLookup.get(highlightIndex) || null;
    }
    if (!highlightEntry && locator.nodeId && state.nodeById instanceof Map) {
      const node = state.nodeById.get(String(locator.nodeId));
      if (node && Number.isInteger(node.highlightIndex)) {
        highlightEntry = state.highlightLookup.get(node.highlightIndex) || null;
      }
    }

    const frameChain = Array.isArray(locator.frameChain)
      ? locator.frameChain
      : highlightEntry?.frameChain || [];

    let doc = document;
    const frameElements = [];
    for (const frame of frameChain) {
      const frameXPath = frame?.xpath || frame?.frameXPath || '';
      const frameCss = frame?.css || '';
      const frameElement =
        (frameXPath ? evaluateXPathInDocument(frameXPath, doc) : null) ||
        (frameCss ? doc.querySelector(frameCss) : null);
      if (!frameElement) {
        resolved.reason = 'IFRAME_NOT_FOUND';
        return resolved;
      }
      if (!(frameElement instanceof HTMLIFrameElement)) {
        resolved.reason = 'FRAME_NOT_IFRAME';
        return resolved;
      }
      const frameDoc = frameElement.contentDocument;
      if (!frameDoc) {
        resolved.reason = 'CROSS_ORIGIN_IFRAME';
        return resolved;
      }
      frameElements.push(frameElement);
      doc = frameDoc;
    }

    const targetXPath = locator.xpath || highlightEntry?.xpath || '';
    let element = targetXPath ? evaluateXPathInDocument(targetXPath, doc) : null;
    if (!element && locator.css) {
      element = doc.querySelector(locator.css);
    }
    if (!element && locator.text) {
      const normalized = String(locator.text).trim().toLowerCase();
      if (normalized) {
        const candidates = Array.from(
          doc.querySelectorAll(
            'button, a, input, textarea, select, label, [role="button"], [role="option"], [role="menuitem"], [data-action]'
          )
        );
        element = candidates.find((node) => (node.textContent || node.value || '').trim().toLowerCase() === normalized) || null;
      }
    }

    resolved.element = element || null;
    resolved.frameElements = frameElements;
    resolved.frameChain = frameChain;
    resolved.highlightEntry = highlightEntry;
    resolved.doc = doc;

    if (!resolved.element) {
      resolved.reason = resolved.reason || 'ELEMENT_NOT_FOUND';
    }

    return resolved;
  }

  function focusFrameElements(frameElements) {
    if (!Array.isArray(frameElements) || frameElements.length === 0) return;
    const lastFrame = frameElements[frameElements.length - 1];
    try {
      lastFrame?.focus?.();
    } catch (e) {
      // ignore focus errors
    }
  }

  function ensureElementInView(element, behavior = 'instant') {
    if (!element) return;
    try {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior });
    } catch (e) {
      try {
        element.scrollIntoView();
      } catch (err) {
        // ignore scroll errors
      }
    }
  }

  function simulateElementClick(element, options = {}) {
    if (!element) throw new Error('ELEMENT_UNDEFINED');
    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;
    if (options.scrollIntoView !== false) {
      ensureElementInView(element, options.scrollBehavior === 'smooth' ? 'smooth' : 'instant');
    }
    if (typeof element.focus === 'function') {
      try {
        element.focus({ preventScroll: options.scrollIntoView === false });
      } catch (e) {
        element.focus();
      }
    }
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, rect.width / 2);
    const clientY = rect.top + Math.max(1, rect.height / 2);
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: win,
      clientX,
      clientY,
      screenX: (win?.screenX || 0) + clientX,
      screenY: (win?.screenY || 0) + clientY,
      button: 0,
    };
    const PointerCtor = win.PointerEvent || win.MouseEvent || MouseEvent;
    const MouseCtor = win.MouseEvent || MouseEvent;
    const sequence = [
      ['pointerover', PointerCtor],
      ['mouseover', MouseCtor],
      ['pointerdown', PointerCtor],
      ['mousedown', MouseCtor],
      ['pointerup', PointerCtor],
      ['mouseup', MouseCtor],
      ['click', MouseCtor],
    ];
    for (const [type, Ctor] of sequence) {
      try {
        const event = new Ctor(type, eventInit);
        element.dispatchEvent(event);
      } catch (e) {
        // ignore dispatch failures
      }
    }
  }

  function extractElementText(element) {
    if (!element) return '';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return (element.value || element.placeholder || '').trim();
    }
    return (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
  }

  async function typeValueIntoElement(element, text, options = {}) {
    if (!element) throw new Error('ELEMENT_UNDEFINED');
    const speed = options.typingSpeed || options.speed || 'normal';
    const delays = speed === 'fast' ? [5, 15] : speed === 'slow' ? [60, 120] : [25, 60];
    const isInput = (node) => node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
    const isContentEditable = (node) => node && node.isContentEditable;
    const dispatch = (node, type) => node && node.dispatchEvent(new Event(type, { bubbles: true }));
    const setter = isInput(element)
      ? (value) => {
          const proto = element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(element, value);
          else element.value = value;
        }
      : isContentEditable(element)
      ? (value) => {
          element.innerHTML = '';
          element.textContent = value;
        }
      : (value) => {
          element.textContent = value;
        };
    const getter = isInput(element)
      ? () => element.value
      : () => element.value ?? element.textContent ?? '';

    if (typeof element.focus === 'function') {
      try {
        element.focus({ preventScroll: true });
      } catch (e) {
        element.focus();
      }
    }

    if (options.replace !== false) {
      const currentValue = getter();
      if (currentValue) {
        setter('');
        dispatch(element, 'input');
      }
    }

    const valueToType = text == null ? '' : String(text);
    if (!valueToType) {
      dispatch(element, 'change');
      return;
    }

    let current = getter() || '';
    for (const ch of valueToType) {
      dispatch(element, 'keydown');
      setter(current + ch);
      current += ch;
      dispatch(element, 'input');
      dispatch(element, 'keyup');
      await sleep(rand(delays[0], delays[1]));
    }
    dispatch(element, 'change');
  }

  function selectOptionOnElement(element, text) {
    if (!element || element.tagName !== 'SELECT') {
      throw new Error('NOT_SELECT_ELEMENT');
    }
    const options = Array.from(element.options || []);
    if (!options.length) {
      return { selected: false };
    }
    const normalized = String(text || '').trim().toLowerCase();
    let match = options.find((opt) => opt.textContent?.trim().toLowerCase() === normalized);
    if (!match) {
      match = options.find((opt) => opt.value?.trim().toLowerCase() === normalized);
    }
    if (!match && normalized) {
      match = options.find((opt) => opt.textContent?.trim().toLowerCase().includes(normalized));
    }
    if (!match && normalized) {
      match = options.find((opt) => normalized.includes(opt.textContent?.trim().toLowerCase() || ''));
    }
    if (!match) {
      return { selected: false };
    }
    element.value = match.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      selected: true,
      value: match.value,
      text: match.textContent?.trim() || match.value,
    };
  }

  function normalizeSurveyAgentValue(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
  }

  function getElementCurrentValueSnapshot(element) {
    if (!element) return '';
    const tag = element.tagName;
    if (tag === 'SELECT') {
      const selected = Array.from(element.selectedOptions || []);
      if (!selected.length) return '';
      return selected
        .map((opt) => (opt.textContent || opt.value || '').trim())
        .filter(Boolean)
        .join(', ');
    }
    if (tag === 'INPUT') {
      const type = (element.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        return element.checked ? 'checked' : '';
      }
      return (element.value || '').trim();
    }
    if (tag === 'TEXTAREA') {
      return (element.value || element.textContent || '').trim();
    }
    if (element.isContentEditable) {
      return (element.textContent || '').trim();
    }
    return '';
  }

  function getSelectSelectionInfo(element) {
    if (!element || element.tagName !== 'SELECT') return { text: '', value: '' };
    const selected = Array.from(element.selectedOptions || []);
    if (!selected.length) return { text: '', value: '' };
    const primary = selected[0];
    return {
      text: (primary.textContent || '').trim(),
      value: (primary.value || '').trim(),
    };
  }

  function isSelectValueAlreadyChosen(element, desiredText) {
    if (!element || element.tagName !== 'SELECT') return false;
    const normalizedDesired = normalizeSurveyAgentValue(desiredText || '');
    const selected = Array.from(element.selectedOptions || []);
    if (!selected.length) return !normalizedDesired;
    return selected.some((opt) => {
      const text = normalizeSurveyAgentValue(opt.textContent || '');
      const value = normalizeSurveyAgentValue(opt.value || '');
      return text === normalizedDesired || value === normalizedDesired;
    });
  }

  function performScrollAction(action = {}, resolved) {
    const mode = action.mode || 'element';
    const targetDoc = resolved?.doc || document;
    const targetWin = targetDoc.defaultView || window;
    const behavior = action.behavior === 'smooth' ? 'smooth' : 'instant';

    if (mode === 'element') {
      if (resolved && resolved.element) {
        ensureElementInView(resolved.element, behavior);
        return { target: extractElementText(resolved.element) };
      }
      const viewport = targetWin || window;
      const defaultStep = viewport.innerHeight ? Math.round(viewport.innerHeight * 0.7) : 480;
      const fallbackDelta = Number.isFinite(action.offset) ? action.offset : defaultStep;
      try {
        viewport.scrollBy({ top: fallbackDelta, behavior });
      } catch (err) {
        viewport.scrollBy(0, fallbackDelta);
      }
      return { fallback: true, delta: fallbackDelta };
    }

    if (mode === 'percent') {
      const percent = Number(action.percent);
      if (!Number.isFinite(percent)) {
        throw new Error('INVALID_PERCENT');
      }
      const docEl = targetDoc.documentElement || targetDoc.body;
      const totalHeight = (docEl?.scrollHeight || 0) - (targetWin.innerHeight || 0);
      const clampedPercent = Math.max(0, Math.min(100, percent));
      const y = totalHeight <= 0 ? 0 : Math.round((clampedPercent / 100) * totalHeight);
      targetWin.scrollTo({ top: y, behavior });
      return { percent: clampedPercent };
    }

    if (mode === 'top') {
      targetWin.scrollTo({ top: 0, behavior });
      return { position: 'top' };
    }

    if (mode === 'bottom') {
      const docEl = targetDoc.documentElement || targetDoc.body;
      const totalHeight = (docEl?.scrollHeight || 0) - (targetWin.innerHeight || 0);
      targetWin.scrollTo({ top: Math.max(0, totalHeight), behavior });
      return { position: 'bottom' };
    }

    throw new Error('UNKNOWN_SCROLL_MODE');
  }

  function getElementLabelText(element) {
    if (!element) return '';
    const doc = element.ownerDocument || document;
    let label = '';
    if (element.labels && element.labels.length) {
      label = Array.from(element.labels)
        .map((el) => (el?.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
    }
    if (!label && element.id) {
      try {
        const selector = `label[for="${typeof CSS !== 'undefined' ? CSS.escape(element.id) : element.id}"]`;
        const forLabel = doc.querySelector(selector);
        if (forLabel) label = forLabel.textContent || '';
      } catch (err) {
        // ignore invalid selector
      }
    }
    if (!label) {
      const direct = element.closest?.('label');
      if (direct) label = direct.textContent || '';
    }
    if (!label && element.getAttribute) {
      label = element.getAttribute('aria-label') || '';
      if (!label) {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          label = labelledBy
            .split(/\s+/)
            .map((id) => (doc.getElementById(id)?.textContent || '').trim())
            .filter(Boolean)
            .join(' ');
        }
      }
      if (!label) {
        label = element.getAttribute('placeholder') || '';
      }
    }
    return (label || '').replace(/\s+/g, ' ').trim();
  }

  function resolveSurveyAgentInputValue(action = {}, element) {
    const valueInfo = {
      text: typeof action.text === 'string' ? action.text : '',
      identityKey: null,
      usedIdentity: false,
      missingIdentity: false,
    };
    let requestedKey = null;
    if (typeof action.intent === 'string') {
      const match = action.intent.match(/identity[:.]([\w-]+)/i);
      if (match) requestedKey = match[1];
    }
    if (!requestedKey && typeof action.text === 'string') {
      const placeholder = action.text.match(/{{\s*identity[:.]?([\w-]+)\s*}}/i);
      if (placeholder) {
        requestedKey = placeholder[1];
        valueInfo.text = '';
      }
    }
    if (!requestedKey && element) {
      const inferred = detectField(element);
      if (inferred) requestedKey = inferred;
    }
    if (requestedKey) {
      valueInfo.identityKey = requestedKey;
      const allowIdentity = getSurveyAgentSettings().useIdentityAnswers !== false;
      const identityValue = allowIdentity && activeIdentity && activeIdentity[requestedKey];
      if (allowIdentity && typeof identityValue === 'string' && identityValue.trim()) {
        valueInfo.text = identityValue.trim();
        valueInfo.usedIdentity = true;
      } else if (!allowIdentity) {
        if (!valueInfo.text || /{{\s*identity/i.test(valueInfo.text)) {
          valueInfo.missingIdentity = true;
        }
      } else if (valueInfo.text === '' || /{{\s*identity/i.test(valueInfo.text)) {
        valueInfo.missingIdentity = true;
      }
    }
    return valueInfo;
  }

  async function executeSurveyAgentOcrCapture(step = {}) {
    try {
      const rect = Array.isArray(step.rect) ? step.rect : null;
      const stored = await chrome.storage.local.get('ocrLang');
      const langValue = stored && typeof stored.ocrLang === 'string' ? stored.ocrLang.trim() : '';
      const lang = langValue || 'eng';
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_AND_OCR',
        rect,
        tabId: await getTabId(),
        ocrLang: lang,
      });
      if (response?.ok) {
        return {
          ok: true,
          code: 'act_ocrCapture_ok',
          status: 'ok',
          details: { text: response.text || '', rect },
        };
      }
      return {
        ok: false,
        code: 'act_ocrCapture_fail',
        status: 'fail',
        error: response?.error || 'OCR_FAILED',
        details: { rect },
      };
    } catch (err) {
      return {
        ok: false,
        code: 'act_ocrCapture_fail',
        status: 'fail',
        error: err?.message || String(err),
        details: { rect: Array.isArray(step.rect) ? step.rect : null },
      };
    }
  }

  async function executeSurveyAgentAction(action = {}) {
    if (!action || typeof action !== 'object') {
      return { ok: false, error: 'INVALID_ACTION', code: 'act_errors_invalidAction' };
    }

    const rawType = action.type || action.name;
    const type = typeof rawType === 'string' ? rawType.toLowerCase() : '';
    const locator = action.locator || {};

    const needsElement = type === 'click' || type === 'type' || type === 'select';
    const usesLocator = needsElement || (type === 'scroll' && (!action.mode || action.mode === 'element'));

    let resolved = {
      element: null,
      doc: document,
      frameElements: [],
      frameChain: [],
      reason: null,
    };

    if (usesLocator) {
      if (type === 'scroll' && action.mode && action.mode !== 'element') {
        resolved = { element: null, doc: document, frameElements: [], frameChain: [], reason: null };
      } else {
        resolved = resolveSurveyAgentElement(locator) || {
          element: null,
          doc: document,
          frameElements: [],
          frameChain: [],
          reason: 'ELEMENT_NOT_FOUND',
        };
        if (needsElement && !resolved.element) {
          return {
            ok: false,
            error: resolved.reason || 'ELEMENT_NOT_FOUND',
            code: action.intent || 'act_errors_elementNotExist',
            details: { locator },
          };
        }
      }
    } else if (type === 'scroll') {
      resolved = { element: null, doc: document, frameElements: [], frameChain: [], reason: null };
    }

    try {
      switch (type) {
        case 'click': {
          focusFrameElements(resolved.frameElements);
          simulateElementClick(resolved.element, {
            scrollIntoView: action.scrollIntoView !== false,
            scrollBehavior: action.scrollBehavior,
          });
          const text = extractElementText(resolved.element);
          return {
            ok: true,
            code: 'act_click_ok',
            details: {
              index: locator.highlightIndex,
              text,
            },
          };
        }
        case 'type': {
          focusFrameElements(resolved.frameElements);
          const valueInfo = resolveSurveyAgentInputValue(action, resolved.element);
          if (valueInfo.missingIdentity) {
            return {
              ok: false,
              error: 'IDENTITY_VALUE_MISSING',
              code: 'act_identity_missing',
              details: { key: valueInfo.identityKey, index: locator.highlightIndex },
            };
          }
          const desiredText = valueInfo.text || '';
          const currentSnapshot = normalizeSurveyAgentValue(getElementCurrentValueSnapshot(resolved.element));
          if (normalizeSurveyAgentValue(desiredText) === currentSnapshot) {
            const label = getElementLabelText(resolved.element);
            return {
              ok: true,
              code: 'act_inputText_ok',
              details: {
                index: locator.highlightIndex,
                text: desiredText,
                identityKey: valueInfo.usedIdentity ? valueInfo.identityKey : undefined,
                question: label || undefined,
                skipped: true,
              },
            };
          }
          const textToType = desiredText;
          await typeValueIntoElement(resolved.element, textToType, {
            typingSpeed: action.typingSpeed,
            replace: action.replace !== false,
          });
          const label = getElementLabelText(resolved.element);
          return {
            ok: true,
            code: 'act_inputText_ok',
            details: {
              index: locator.highlightIndex,
              text: textToType,
              identityKey: valueInfo.usedIdentity ? valueInfo.identityKey : undefined,
              question: label || undefined,
            },
          };
        }
        case 'select': {
          focusFrameElements(resolved.frameElements);
          if (!resolved.element || resolved.element.tagName !== 'SELECT') {
            return {
              ok: false,
              error: 'NOT_A_SELECT_ELEMENT',
              code: 'act_selectDropdownOption_notSelect',
              details: { tagName: resolved.element?.tagName, index: locator.highlightIndex },
            };
          }
          const valueInfo = resolveSurveyAgentInputValue(action, resolved.element);
          if (valueInfo.missingIdentity) {
            return {
              ok: false,
              error: 'IDENTITY_VALUE_MISSING',
              code: 'act_identity_missing',
              details: { key: valueInfo.identityKey, index: locator.highlightIndex },
            };
          }
          const desiredOption = valueInfo.text || action.text || '';
          if (isSelectValueAlreadyChosen(resolved.element, desiredOption)) {
            const selectionSnapshot = getSelectSelectionInfo(resolved.element);
            const label = getElementLabelText(resolved.element);
            return {
              ok: true,
              code: 'act_selectDropdownOption_ok',
              details: {
                index: locator.highlightIndex,
                value: selectionSnapshot.value,
                text: selectionSnapshot.text || desiredOption,
                identityKey: valueInfo.usedIdentity ? valueInfo.identityKey : undefined,
                question: label || undefined,
                skipped: true,
              },
            };
          }
          const selection = selectOptionOnElement(resolved.element, valueInfo.text || action.text || '');
          if (!selection.selected) {
            return {
              ok: false,
              error: 'OPTION_NOT_FOUND',
              code: 'act_selectDropdownOption_failed',
              details: {
                index: locator.highlightIndex,
                text: valueInfo.text || action.text || '',
                identityKey: valueInfo.identityKey,
              },
            };
          }
          const label = getElementLabelText(resolved.element);
          return {
            ok: true,
            code: 'act_selectDropdownOption_ok',
            details: {
              index: locator.highlightIndex,
              value: selection.value,
              text: selection.text,
              identityKey: valueInfo.usedIdentity ? valueInfo.identityKey : undefined,
              question: label || undefined,
            },
          };
        }
        case 'scroll': {
          const scrollDetails = performScrollAction(action, resolved);
          return {
            ok: true,
            code: 'act_scroll_ok',
            details: scrollDetails,
          };
        }
        case 'ip_info':
          return await handleSurveyAgentIpInfoAction(action);
        case 'ip_check':
          return await handleSurveyAgentIpQualificationAction(action);
        case 'custom_open':
          return await handleSurveyAgentCustomOpenAction(action);
        default:
          return { ok: false, error: `UNKNOWN_ACTION:${type}`, code: 'act_errors_unknownAction' };
      }
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
        code: action.intent || 'act_errors_unexpected',
        details: { locator, reason: resolved?.reason },
      };
    }
  }

  function summarizeSurveyAgentIpInfo(info) {
    if (!info || typeof info !== 'object') {
      return 'تم عرض معلومات عنوان الـIP الحالي.';
    }
    const parts = [];
    if (info.ip) parts.push(`العنوان: ${info.ip}`);
    if (info.country && info.country !== 'Unknown') parts.push(`الدولة: ${info.country}`);
    if (info.city && info.city !== 'Unknown') parts.push(`المدينة: ${info.city}`);
    if (info.isp && info.isp !== 'Unknown') parts.push(`المزوّد: ${info.isp}`);
    if (info.timezone && info.timezone !== 'Unknown') parts.push(`المنطقة: ${info.timezone}`);
    return parts.length ? parts.join(' • ') : 'تم تحديث معلومات الـIP.';
  }

  function summarizeSurveyAgentIpQualification(data) {
    if (!data || typeof data !== 'object') {
      return 'تم عرض تقييم الـIP الحالي.';
    }
    const score = Number.isFinite(data.fraud_score) ? Math.round(data.fraud_score) : null;
    const status = data.status || data.ip_quality || data.result;
    const vpn = data.vpn || data.proxy || data.recent_abuse;
    const parts = [];
    if (score !== null) parts.push(`التقييم: ${score}/100`);
    if (status) parts.push(`الحالة: ${status}`);
    if (typeof vpn === 'string') {
      parts.push(`VPN/Proxy: ${vpn}`);
    } else if (typeof vpn === 'boolean') {
      parts.push(vpn ? 'يبدو أنه VPN/Proxy' : 'لا يوجد VPN ظاهر');
    }
    return parts.length ? parts.join(' • ') : 'تم تحديث نتيجة التأهيل.';
  }

  async function handleSurveyAgentIpInfoAction(action = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' });
      if (!response?.ok) {
        return {
          ok: false,
          error: response?.error || 'IP_INFO_UNAVAILABLE',
          code: 'act_ipInfo_failed',
          details: {},
        };
      }
      const info = response.info || {};
      showIPModal(info);
      const summary = summarizeSurveyAgentIpInfo(info);
      return {
        ok: true,
        code: 'act_ipInfo_ok',
        details: { summary, info },
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
        code: 'act_ipInfo_failed',
        details: {},
      };
    }
  }

  async function handleSurveyAgentIpQualificationAction(action = {}) {
    try {
      let data = null;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_IP_QUALIFICATION' });
        if (response?.ok) {
          data = response.data || null;
          if (data) {
            await chrome.storage.local.set({ lastIPQ: data });
          }
        }
      } catch (err) {
        // swallow and fall back to cached value
      }
      if (!data) {
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        data = lastIPQ || null;
      }
      showCleanIPQualificationModal(data || null);
      const summary = summarizeSurveyAgentIpQualification(data);
      return {
        ok: true,
        code: 'act_ipCheck_ok',
        details: { summary, data },
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
        code: 'act_ipCheck_failed',
        details: {},
      };
    }
  }

  async function resolveSurveyAgentCustomUrl(siteKey) {
    if (!siteKey) return null;
    const key = String(siteKey).toLowerCase();
    try {
      const { customSites = [] } = await chrome.storage.local.get('customSites');
      const match = customSites.find((site) => {
        if (!site) return false;
        const name = (site.name || '').toLowerCase();
        const url = (site.url || '').toLowerCase();
        return name === key || url.includes(key);
      });
      return match?.url || null;
    } catch (err) {
      console.warn('Survey agent: failed to resolve custom site', err);
      return null;
    }
  }

  async function handleSurveyAgentCustomOpenAction(action = {}) {
    try {
      let targetUrl = action.url;
      if (!targetUrl && action.siteKey) {
        targetUrl = await resolveSurveyAgentCustomUrl(action.siteKey);
      }
      let payload;
      if (targetUrl) {
        payload = { type: 'OPEN_OR_FOCUS_CUSTOM_WEB', url: targetUrl };
      } else {
        payload = { type: 'OPEN_CUSTOM_WEB' };
      }
      const response = await chrome.runtime.sendMessage(payload);
      if (!response?.ok) {
        return {
          ok: false,
          error: response?.error || 'CUSTOM_WEB_FAILED',
          code: 'act_customOpen_failed',
          details: { url: targetUrl || null },
        };
      }
      return {
        ok: true,
        code: 'act_customOpen_ok',
        details: { url: targetUrl || null, focused: Boolean(response.focused) },
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
        code: 'act_customOpen_failed',
        details: { url: action.url || null },
      };
    }
  }

  // Identity handling
  const FIELD_KEYWORDS = {
    email: ['email','e-mail','user_email','customer_email','mailid','emailaddress','email_address','useremail','emailid','contact_email','work_email','primary_email',/e-?mail/],
    username: ['username','user','userid','login','login_id','user-name','nickname','user_name','loginname','account','membername',/user.?name/],
    password: ['password','pass','pwd','secret','user_pass','passwd','passcode','userpassword',/pass.?word/],
    fullName: ['fullname','your-name','cardholder','card_name','nameoncard','full_name','customer_name','name','contact_name','realname',/full.?name/],
    firstName: ['firstname','first_name','fname','given-name','forename','given_name','first','customer_firstname','person_first_name','firstname1','first-name',/first.?name/],
    lastName: ['lastname','last_name','lname','surname','family-name','family_name','last','customer_lastname','person_last_name','lastname1','last-name',/last.?name/],
    age: ['age','user_age','yourage','member_age','ageyears','yrs','years_old','yearsold','birthyear',/years?\s?old/],
    phone: ['phone','mobile','telephone','tel','contact_number','phone_number','contact-no','cell','cellphone','phonenumber','dayphone','evephone','homephone',/phone|tel/],
    address1: ['address','address1','street_address','street','address-line1','billing_address','line1','addr1','street1','address_1','addressline1'],
    address2: ['address2','suite','apt','apartment','address-line2','line2','addr2','street2','address_2','addressline2'],
    city: ['city','town','user_city','locality','cityname','municipality',/city|town/],
    state: ['state','province','region','county','state_province','stateprovince','territory','prefecture',/state|province/],
    zipCode: ['zip','zipcode','postal','postal_code','postcode','zip_code','post_code','pin','pincode',/post.?code/],
    country: ['country','nation','country_name','countrycode','country-code',/country|nation/],
    macAddress: ['mac','mac_address','macaddress','device_mac','mac-addr','hardwareaddress','hwaddress',/mac.*address/],
    companyName: ['company','company_name','business_name','organization','organisation','employer','business','corp','corporation','workplace','companyname','firm',/company.?name|business/],
    companyIndustry: ['industry','field','business_type','area_of_work','sector','line_of_business','business_sector','industry_type','occupation','trade',/industry|sector/],
    companySize: ['company_size','employees','number_of_employees','employee_count','staff_size','num_employees','employee_number','workforce','team_size','size_of_company',/employee.?count|staff/],
    companyAnnualRevenue: ['revenue','annual_revenue','company_revenue','sales_volume','annual_sales','turnover','yearly_revenue','yearly_sales','company_turnover','gross_revenue',/annual.?revenue|turnover/],
    companyWebsite: ['website','company_website','company_url','business_url','site_url','web_address','companysite','companyweb','corporate_website','business_website',/web.?site|url/],
    companyAddress: ['company_address','business_address','work_address','office_address','corporate_address','company_location','workplace_address','company_addr',/office.?address|business.?addr/]
  };

  function loadIdentity(){
    chrome.storage.local.get(['activeIdentityId','identities'], res => {
      const list = res.identities || [];
      const id = res.activeIdentityId;
      activeIdentity = list.find(i=>i.id===id) || null;
    });
  }
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area==='local' && (chg.activeIdentityId || chg.identities)){
      loadIdentity();
    }
  });
  chrome.storage.onChanged.addListener((chg, area) => {
    if (area === 'local' && chg[SURVEY_AGENT_SETTINGS_KEY]) {
      const next = chg[SURVEY_AGENT_SETTINGS_KEY].newValue;
      if (next && typeof next === 'object') {
        applySurveyAgentSettings(next);
      }
    }
  });
  loadIdentity();

  function addFieldToIdentity(btn, value, key, success='Saved!'){
    chrome.storage.local.get('identities', ({identities=[]})=>{
      if(!identities.length){ showNotification('No identities saved'); return; }
      if(btn.nextSibling && btn.nextSibling.classList?.contains('ati-select')){ btn.nextSibling.remove(); return; }
      const sel=document.createElement('select');
      sel.className='ati-select';
      sel.style.cssText='margin-left:6px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:4px;';
      sel.innerHTML='<option value="">Select</option>'+identities.map(i=>`<option value="${i.id}">${i.identityName||'Unnamed'}</option>`).join('');
      btn.after(sel);
      sel.addEventListener('change',()=>{
        const id=sel.value; const idx=identities.findIndex(i=>i.id===id);
        if(idx>-1){ identities[idx][key]=value; chrome.storage.local.set({identities}); }
        sel.remove();
        const msg=document.createElement('span');
        msg.textContent=success;
        msg.style.cssText='color:#39ff14;margin-left:6px;font-size:12px;';
        btn.after(msg);
        setTimeout(()=>msg.remove(),1500);
      });
    });
  }
  function detectField(el){
    if(!el) return null;
    const attrs = ((el.id||'') + ' ' + (el.name||'') + ' ' + (el.placeholder||'') + ' ' + (el.type||'')).toLowerCase();
    const labelText = getElementLabelText(el).toLowerCase();
    const hay = attrs + ' ' + labelText;
    for(const [key, vals] of Object.entries(FIELD_KEYWORDS)){
      if(vals.some(v=> v instanceof RegExp ? v.test(hay) : hay.includes(v))) return key;
    }
    return null;
  }

  function showFieldIcon(el){
    removeFieldIcon();
    if(!activeIdentity) return;
    const fieldKey = detectField(el);
    if(!fieldKey || !activeIdentity[fieldKey]) return;
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/zepra.svg');
    icon.className = 'zepra-fill-icon';
    icon.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;z-index:2147483647;';
    const parent = el.parentElement;
    if(!parent) return;
    const prevPos = parent.style.position;
    if(getComputedStyle(parent).position === 'static') parent.style.position='relative';
    parent.appendChild(icon);
    icon.addEventListener('mousedown', ev=>{
      ev.preventDefault();
      el.focus();
      typeIntoFocusedElement(activeIdentity[fieldKey], { speed: 'normal' });
    });
    STATE.fillIcon = {icon, parent, prevPos};
  }

  function removeFieldIcon(){
    const fi = STATE.fillIcon;
    if(fi){
      fi.icon.remove();
      if(fi.prevPos) fi.parent.style.position = fi.prevPos;
      STATE.fillIcon = null;
    }
  }


  function toggleIdentityPanel(){
    if(!activeIdentity){ showNotification('No active identity'); return; }
    let rows='';
    const fields=['fullName','email','phone','address1','city','country'];
    fields.forEach(k=>{
      if(activeIdentity[k]){
        rows += `<div class="id-row"><strong>${k}:</strong> <span>${activeIdentity[k]}</span> <button data-copy="${k}" class="copy-btn">Copy</button></div>`;
      }
    });
    const content = `
      <style>
        .id-modal-bg{position:relative;color:#e2e8f0;}
        .id-modal-bg video.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;}
        .id-modal-inner{position:relative;z-index:1;}
        .id-header{height:120px;overflow:hidden;border-bottom:2px solid #39ff14;}
        .id-header video{width:100%;height:100%;object-fit:contain;}
        .id-body{padding:15px;max-height:60vh;overflow:auto;}
        .id-row{margin:6px 0;font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:6px;}
        .copy-btn{background:#22c55e;border:none;color:#000;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:12px;}
      </style>
      <div class="id-modal-bg">
        <video class="bg" autoplay loop muted src="${chrome.runtime.getURL('src/media/cepra.webm')}"></video>
        <div class="id-modal-inner">
          <div class="id-header"><video autoplay loop muted src="${chrome.runtime.getURL('src/media/key.webm')}"></video></div>
          <div class="id-body">${rows}</div>
        </div>
      </div>`;
    const modal = createStyledModal('Identity Data', content);
    modal.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>navigator.clipboard.writeText(activeIdentity[b.dataset.copy]||'')));
  }

  document.addEventListener('keydown', e => {
    const combo = (e.ctrlKey ? 'Ctrl+' : '') +
                  (e.altKey ? 'Alt+' : '') +
                  (e.shiftKey ? 'Shift+' : '') +
                  e.key.toUpperCase();
    const pr = customPrompts.find(p => p.hotkey && p.hotkey.toUpperCase() === combo);
    if (pr) {
      const text = window.getSelection().toString().trim();
      if (!text) return;
      // Use integrated rainbow modal for a consistent UX instead of a simple alert.
      createRainbowModal(text, pr.id);
      e.preventDefault();
    }
  });

  document.addEventListener('focusin', (e) => { STATE.lastFocused = e.target; showFieldIcon(e.target); });
  document.addEventListener('focusout', () => removeFieldIcon());

  function watchForms(){
    let dismissed = false;
    const check = ()=>{
      if(dismissed || document.getElementById('zepra-helper-bar')) return;
      const forms = Array.from(document.querySelectorAll('form'));
      let target = null;
      for(const f of forms){
        const els = f.querySelectorAll('input,select');
        let matches = 0;
        for(const el of els){
          if(detectField(el)){
            matches++;
            if(matches >= 3) break;
          }
        }
        if(matches >= 3){ target = f; break; }
      }
      if(target){
        const bar=document.createElement('div');
        bar.id='zepra-helper-bar';
        bar.style.cssText='position:fixed;top:0;left:0;right:0;background:#111;color:#e2e8f0;padding:8px;z-index:2147483647;display:flex;justify-content:center;gap:10px;box-shadow:0 0 10px #39ff14;';
        bar.innerHTML=`<span>Zepra has detected a form. Would you like to fill it using your active identity?</span><button id="zepra-fill" style="background:#22c55e;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Fill Form</button><button id="zepra-dismiss" style="background:#dc2626;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Dismiss</button>`;
        document.body.prepend(bar);
        bar.querySelector('#zepra-fill').addEventListener('click',async ()=>{ await analyzeFormWithAI(target); bar.remove(); dismissed = true; });
        bar.querySelector('#zepra-dismiss').addEventListener('click',()=>{ bar.remove(); dismissed = true; });
      }
    };
    const mo=new MutationObserver(check);
    mo.observe(document.documentElement,{childList:true,subtree:true});
    check();
  }

  async function fillForm(form){
    if(!activeIdentity) return;
    const fields=form.querySelectorAll('input,textarea,select');
    for(const el of fields){
      const key=detectField(el);
      if(key && activeIdentity[key]){
        el.focus();
        await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
        await sleep(100);
      }
    }
  }

  async function analyzeFormWithAI(form){
    if(!activeIdentity) return fillForm(form);
    try {
      const html = form.innerHTML.slice(0,4000);
      const res = await chrome.runtime.sendMessage({ type: 'ANALYZE_FORM', html });
      if(!res?.ok) throw new Error('fetch');
      const mapping = JSON.parse(res.result);
      for(const [selector,key] of Object.entries(mapping)){
        const el=form.querySelector(selector);
        if(el && activeIdentity[key]){
          el.focus();
          await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
          await sleep(100);
        }
      }
    } catch(e){
      console.error('Form analysis failed, using fallback', e);
      await fillForm(form);
    }
  }

  // Create floating bubble
  function createFloatingBubble() {
    if (STATE.bubble || document.getElementById('zepra-bubble')) return;
    
    const bubble = document.createElement('div');
    bubble.id = 'zepra-bubble';
    bubble.innerHTML = `
      <div class="bubble-icon">
        <video autoplay loop muted src="${chrome.runtime.getURL('src/media/zepra.webm')}"></video>
        <div class="bubble-glow"></div>
      </div>
    `;
    
    bubble.style.cssText = `
      position: fixed;
      width: 60px;
      height: 60px;
      z-index: 2147483647;
      cursor: grab;
      border-radius: 50%;
      background: #000;
      box-shadow: 0 0 10px #39ff14, 0 0 20px #ffe600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
      border: 2px solid #39ff14;
      animation: bubbleFloat 3s ease-in-out infinite;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes bubbleFloat {
        0%, 100% { transform: translateY(0px) scale(1); }
        50% { transform: translateY(-10px) scale(1.05); }
      }
      
      #zepra-bubble:hover {
        transform: scale(1.1) !important;
        box-shadow: 0 6px 30px rgba(57,255,20,0.6), 0 0 20px rgba(255,230,0,0.5) !important;
      }

      .bubble-icon {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        overflow: hidden;
      }
      
      .bubble-icon video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: 50%;
      }
      
      .bubble-glow {
        position: absolute;
        top: -5px;
        left: -5px;
        right: -5px;
        bottom: -5px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(57,255,20,0.4) 0%, rgba(255,230,0,0.2) 40%, transparent 70%);
        animation: pulse 2s ease-in-out infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.1); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(bubble);
    STATE.bubble = bubble;

    // Position bubble using stored value or default
    chrome.storage.local.get('bubblePos', ({ bubblePos }) => {
      if (bubblePos && typeof bubblePos.top === 'number' && typeof bubblePos.left === 'number') {
        bubble.style.top = bubblePos.top + 'px';
        bubble.style.left = bubblePos.left + 'px';
        bubble.style.right = 'unset';
      } else {
        bubble.style.top = '20px';
        bubble.style.right = '20px';
      }
    });


    // Drag behaviour
    let drag = { active: false, moved: false, offsetX: 0, offsetY: 0 };

    bubble.addEventListener('mousedown', (e) => {
      drag.active = true;
      drag.moved = false;
      drag.offsetX = e.clientX - bubble.offsetLeft;
      drag.offsetY = e.clientY - bubble.offsetTop;
      bubble.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      if (!drag.active) return;
      drag.moved = true;
      const x = Math.min(window.innerWidth - bubble.offsetWidth, Math.max(0, e.clientX - drag.offsetX));
      const y = Math.min(window.innerHeight - bubble.offsetHeight, Math.max(0, e.clientY - drag.offsetY));
      bubble.style.left = x + 'px';
      bubble.style.top = y + 'px';
      bubble.style.right = 'unset';
    }

    function onUp() {
      if (!drag.active) return;
      drag.active = false;
      bubble.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      chrome.storage.local.set({ bubblePos: { top: parseInt(bubble.style.top, 10), left: parseInt(bubble.style.left, 10) } });
      setTimeout(() => { drag.moved = false; }, 0);
    }

    bubble.addEventListener('click', (e) => {
      if (drag.moved) return;
      showBubbleMenu();
    });
  }

  function showBubbleMenu() {
    if (document.getElementById('zepra-sidebar')) return;

    const menu = document.createElement('aside');
    menu.id = 'zepra-sidebar';
    menu.innerHTML = `
      <div class="zepra-particles"></div>
      <header class="sidebar-header">
        <svg class="zap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <div class="title-group">
          <h2>Zepra Menu</h2>
          <p>Chrome Extension Suite</p>
        </div>
        <button class="close-btn" aria-label="Close">&times;</button>
      </header>
      <nav class="sidebar-nav">
        <ul>
          <li><a href="#" data-action="ocr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg><span>OCR Capture</span></a></li>
          <li><a href="#" data-action="ocr-full"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg><span>OCR Full Page</span></a></li>
          <li><a href="#" data-action="write-last"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Write Last Answer</span></a></li>
          <li><a href="#" data-action="survey-agent"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M12 7V3"/><path d="M8 11h.01"/><path d="M16 11h.01"/><path d="M8 15h8"/></svg><span>وكيل الاستبيانات</span></a></li>
          <li><a href="#" data-action="clear-context"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Clear AI Context</span></a></li>
          <li><a href="#" data-action="ip-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>IP Information</span></a></li>
          <li><a href="#" data-action="ip-qual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg><span>IP Qualification</span></a></li>
          <li><a href="#" data-action="fake-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a7.5 7.5 0 0 1 13 0"/></svg><span>Generate Fake Info</span></a></li>
          <li><a href="#" data-action="temp-mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg><span>Temp Mail</span></a></li>
          <li><a href="#" data-action="custom-web"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Custom Web</span></a></li>
          <li><a href="#" data-action="ai-humanizer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7v4a7 7 0 0 0 7 7 7 7 0 0 0 7-7V9a7 7 0 0 0-7-7z"/><path d="M9 9h6"/><path d="M9 13h6"/></svg><span>AI Humanizer</span></a></li>
          <li><a href="#" data-action="real-address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/><path d="M9 22H5a2 2 0 0 1-2-2v-7"/><path d="M21 13v7a2 2 0 0 1-2 2h-4"/></svg><span>Generate Real Address</span></a></li>
          <li><a href="#" data-action="company-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 3v18"/><path d="M8 3v18"/><path d="M3 8h18"/><path d="M3 16h18"/></svg><span>Generate Company Info</span></a></li>
          <li><a href="#" data-action="identity-panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/></svg><span>Show Identity Data</span></a></li>
          <li><a href="#" data-action="zebra-vps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="8" rx="2"/><rect x="2" y="12" width="20" height="8" rx="2"/><path d="M6 8h.01"/><path d="M6 16h.01"/></svg><span>Zebra VPS</span></a></li>
        </ul>
      </nav>
      <footer class="sidebar-footer">
        <p>Powered by Advanced AI · Secure & Encrypted</p>
        <div class="footer-dots"><span></span><span></span><span></span></div>
      </footer>
    `;

    const menuStyle = document.createElement('style');
    menuStyle.textContent = `
      #zepra-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: 100%;
        max-width: 360px;
        background-color: rgba(0,0,0,0.8);
        backdrop-filter: blur(12px);
        border-left: 1px solid rgba(74,222,128,0.2);
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.4s ease-in-out;
        z-index: 2147483648;
        overflow-y: auto;
      }

      #zepra-sidebar.open { transform: translateX(0); }

      #zepra-sidebar .zepra-particles {
        position: absolute;
        inset: 0;
        overflow: hidden;
        z-index: -1;
      }

      #zepra-sidebar .zepra-particles span {
        position: absolute;
        display: block;
        border-radius: 50%;
        background: rgba(74,222,128,0.4);
        animation: float 6s linear infinite;
      }

      @keyframes float {
        0% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
        100% { transform: translateY(0); }
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(74,222,128,0.2);
      }

      .sidebar-header .title-group { flex: 1; margin-left: 8px; }
      .sidebar-header h2 {
        margin: 0;
        font-size: 1.2rem;
        color: #4ade80;
        text-shadow: 0 0 8px #4ade80;
      }
      .sidebar-header p {
        margin: 2px 0 0;
        font-size: 0.75rem;
        color: #94a3b8;
      }
      .zap-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        color: #4ade80;
        filter: drop-shadow(0 0 5px #4ade80);
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      .close-btn {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        transition: color 0.2s;
      }
      .close-btn:hover { color: #fff; }

      .sidebar-nav ul {
        list-style: none;
        padding: 8px;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sidebar-nav a {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        color: #4ade80;
        text-decoration: none;
        transition: all 0.2s ease;
      }

      .sidebar-nav a svg { width: 20px; height: 20px; flex-shrink: 0; }

      .sidebar-nav a::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #4ade80;
        opacity: 0;
        box-shadow: 0 0 6px #4ade80;
        transition: opacity 0.2s;
      }

      .sidebar-nav a:hover {
        background-color: rgba(74,222,128,0.1);
        transform: translateX(5px);
      }
      .sidebar-nav a:hover::before { opacity: 1; }

      .sidebar-footer {
        margin-top: auto;
        padding: 12px;
        border-top: 1px solid rgba(74,222,128,0.2);
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9ca3af;
        font-size: 0.75rem;
      }
      .footer-dots { display: flex; gap: 4px; margin-left: 4px; }
      .footer-dots span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse 2s infinite;
      }
    `;

    document.head.appendChild(menuStyle);
    document.body.appendChild(menu);

    // spawn particles
    const particleBox = menu.querySelector('.zepra-particles');
    for (let i = 0; i < 25; i++) {
      const s = document.createElement('span');
      const size = Math.random() * 4 + 2;
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDuration = `${Math.random() * 5 + 5}s`;
      s.style.animationDelay = `${Math.random() * 5}s`;
      particleBox.appendChild(s);
    }

    requestAnimationFrame(() => menu.classList.add('open'));

    const closeMenu = () => {
      menu.classList.remove('open');
      setTimeout(() => { menu.remove(); menuStyle.remove(); }, 400);
    };

    menu.querySelector('.close-btn').addEventListener('click', closeMenu);

    menu.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-action]');
      if (!link) return;
      e.preventDefault();
      const action = link.dataset.action;
      handleBubbleAction(action);
      closeMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', function outside(e) {
        if (!menu.contains(e.target) && !STATE.bubble.contains(e.target)) {
          closeMenu();
          document.removeEventListener('click', outside);
        }
      });
    }, 100);
  }

  async function handleBubbleAction(action) {
    switch (action) {
      case 'ocr':
        startOCRCapture();
        break;
      case 'ocr-full':
        startFullPageOCR();
        break;
      case 'write-last':
        try {
          const { lastAnswer = '' } = await chrome.storage.local.get('lastAnswer');
          showLastAnswerModal(lastAnswer);
        } catch (e) {
          showNotification('No last answer available');
        }
        break;
      case 'survey-agent':
        openSurveyAgentPanel();
        break;
      case 'clear-context':
        await chrome.storage.local.set({ contextQA: [] });
        showNotification('AI context cleared');
        break;
      case 'ip-info':
        try {
          const response = await chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' });
          if (response.ok) {
            showIPModal(response.info);
          } else {
            showNotification('Failed to get IP information: ' + (response.error || 'Unknown error'));
          }
        } catch (e) {
          showNotification('Failed to get IP information: ' + e.message);
        }
        break;
      case 'ip-qual':
        runIPQualification();
        break;
      case 'fake-info':
        showFakeInfoModal();
        break;
      case 'temp-mail':
        window.open('https://yopmail.com/', '_blank');
        break;
      case 'custom-web':
        await chrome.runtime.sendMessage({ type: 'OPEN_CUSTOM_WEB' });
        break;
      case 'ai-humanizer':
        await openAIHumanizer();
        break;
      case 'real-address':
        showCleanRealAddressModal();
        break;
      case 'company-info':
        showCompanyInfoModal();
        break;
      case 'zebra-vps':
        showZebraVPSModal();
        break;
      case 'identity-panel':
        toggleIdentityPanel();
        break;
    }
  }

  function showZebraVPSModal(){
    const content = `
      <style>
        .zvps-cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;color:#e2e8f0;}
        .zvps-card{background:rgba(0,0,0,0.6);border:2px solid #39ff14;border-radius:12px;padding:16px;width:180px;cursor:pointer;display:flex;flex-direction:column;align-items:center;text-align:center;transition:transform .2s,box-shadow .2s;}
        .zvps-card:hover{transform:scale(1.05);box-shadow:0 0 15px #39ff14;}
        .zvps-icon{font-size:36px;margin-bottom:8px;}
        .zvps-title{font-weight:bold;margin-bottom:4px;}
        .zvps-sub{font-size:12px;color:#ffe600;margin-bottom:8px;}
        .zvps-desc{font-size:12px;}
      </style>
      <div class="zvps-cards">
        <div class="zvps-card" data-mode="windows" data-url="https://app.apponfly.com/trial">
          <div class="zvps-icon">🪟</div>
          <div class="zvps-title">Windows Desktop</div>
          <div class="zvps-sub">20 Minute Session</div>
          <div class="zvps-desc">Access a temporary Windows desktop. You can repeat this process without limits.</div>
        </div>
        <div class="zvps-card" data-mode="android6">
          <div class="zvps-icon">🤖</div>
          <div class="zvps-title">Android VM</div>
          <div class="zvps-sub">6 Hour Session</div>
          <div class="zvps-desc">Opens a virtual Android environment and a Temp-Mail tab to help you sign up.</div>
        </div>
        <div class="zvps-card" data-mode="androidU" data-url="https://www.myandroid.org/run/start.php?apkid=com.koolextremeshooting.battlegroundsshooting.fpsgame&app=com-koolextremeshooting-battlegroundsshooting-fpsgame">
          <div class="zvps-icon">📱</div>
          <div class="zvps-title">Android Google Pixel</div>
          <div class="zvps-sub">Unlimited Session</div>
          <div class="zvps-desc">Run a cloud-based Android instance with a Google Pixel interface.</div>
        </div>
      </div>`;
    const modal = createStyledModal('Zebra VPS', content);
    modal.querySelectorAll('.zvps-card').forEach(card=>{
      card.addEventListener('click', async ()=>{
        const mode = card.dataset.mode;
        if(mode==='android6'){
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:'https://cloud.vmoscloud.com/', urls:['https://www.fakemail.net/','https://cloud.vmoscloud.com/'] });
        }else{
          const url = card.dataset.url;
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:url, urls:[url] });
        }
        modal.remove();
      });
    });
  }

  async function openAIHumanizer(){
    await chrome.runtime.sendMessage({ type:'OPEN_OR_FOCUS_CUSTOM_WEB', url:'https://bypassai.writecream.com/' });
  }

  async function runIPQualification(){
    try{
      const resp = await chrome.runtime.sendMessage({ type: 'GET_IP_QUALIFICATION' });
      if(resp?.ok){
        await chrome.storage.local.set({ lastIPQ: resp.data });
        showCleanIPQualificationModal(resp.data);
      }else{
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        showCleanIPQualificationModal(lastIPQ || null);
      }
    }catch(e){
      const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
      showCleanIPQualificationModal(lastIPQ || null);
    }
  }

  function showIPQualificationModal(data){
    if(!data){
      // Remove existing modal
      const existing = document.getElementById('zepra-ipq-modal');
      if (existing) existing.remove();

      // Create simple error modal
      const errorModal = document.createElement('div');
      errorModal.id = 'zepra-ipq-modal';
      errorModal.innerHTML = `
        <div class="ipq-modal-overlay">
          <div class="ipq-modal-container">
            <div class="ipq-modal-header">
              <h3>IP Qualification</h3>
              <button class="ipq-modal-close">&times;</button>
            </div>
            <div class="ipq-modal-body">
              <div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>
            </div>
          </div>
        </div>
      `;
      
      const errorStyle = document.createElement('style');
      errorStyle.textContent = `
        #zepra-ipq-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        }
        
        .ipq-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
        }
        
        .ipq-modal-container {
          position: relative;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 2px solid #f43f5e;
          border-radius: 20px;
          max-width: 400px;
          width: 90%;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(244, 63, 94, 0.3);
        }
        
        .ipq-modal-header {
          background: rgba(0, 0, 0, 0.4);
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(244, 63, 94, 0.2);
        }
        
        .ipq-modal-header h3 {
          margin: 0;
          color: #f43f5e;
          font-size: 18px;
          font-weight: bold;
        }
        
        .ipq-modal-close {
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .ipq-modal-close:hover {
          background: rgba(244, 63, 94, 0.2);
          color: #f43f5e;
        }
        
        .ipq-modal-body {
          padding: 24px;
        }
      `;
      
      document.head.appendChild(errorStyle);
      document.body.appendChild(errorModal);
      
      errorModal.querySelector('.ipq-modal-close').addEventListener('click', () => {
        errorModal.remove();
        errorStyle.remove();
      });
      
      errorModal.querySelector('.ipq-modal-overlay').addEventListener('click', (e) => {
        if (e.target === errorModal.querySelector('.ipq-modal-overlay')) {
          errorModal.remove();
          errorStyle.remove();
        }
      });
      
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    // Enhanced status logic with three states
    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    // Determine overall status
    let statusState = 'qualified'; // qualified, warning, not-qualified
    let statusText = 'QUALIFIED';
    let statusMessage = 'Your IP is clean and ready to use.';
    let statusClass = 'status-qualified';

    if (riskFail || !blacklistPass || !anonymityPass) {
      statusState = 'not-qualified';
      statusText = 'NOT QUALIFIED';
      statusClass = 'status-not-qualified';
      
      if (riskFail) {
        statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
      } else if (!blacklistPass) {
        statusMessage = 'Your IP is on a blacklist. You must change your connection.';
      } else if (!anonymityPass) {
        statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
      }
    } else if (riskWarning) {
      statusState = 'warning';
      statusText = 'WARNING';
      statusClass = 'status-warning';
      statusMessage = 'Your IP is moderately risky. Proceed with caution.';
    }

    // Enhanced particles with different counts based on status
    const particleCount = statusState === 'qualified' ? 20 : statusState === 'warning' ? 15 : 10;
    const particles = Array.from({ length: particleCount })
      .map((_, i) => `<span class="particle" style="--i:${i};"></span>`)
      .join('');

    // SVG Icons
    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    
    // Status-specific icons
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
    const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
    const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

    // Build checklist with enhanced logic
    const checks = [
      { 
        pass: riskPass, 
        warning: riskWarning,
        fail: riskFail,
        label: 'Risk Score Assessment', 
        icon: shieldSVG 
      },
      { 
        pass: blacklistPass, 
        warning: false,
        fail: !blacklistPass,
        label: 'Blacklist Verification', 
        icon: eyeSVG 
      },
      { 
        pass: anonymityPass, 
        warning: false,
        fail: !anonymityPass,
        label: 'Anonymity Detection', 
        icon: globeSVG 
      },
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;

    const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
    modal.querySelector('.styled-modal-content').classList.add(statusClass);
  }

  

    // Clean IP Qualification Modal - New Implementation
  function showCleanIPQualificationModal(data){
    if(!data){
      // Remove existing modal
      const existing = document.getElementById('zepra-ipq-modal');
      if (existing) existing.remove();

      // Create simple error modal
      const errorModal = document.createElement('div');
      errorModal.id = 'zepra-ipq-modal';
      errorModal.innerHTML = `
        <div class="ipq-modal-overlay">
          <div class="ipq-modal-container">
            <div class="ipq-modal-header">
              <h3>IP Qualification</h3>
              <button class="ipq-modal-close">&times;</button>
            </div>
            <div class="ipq-modal-body">
              <div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>
            </div>
          </div>
        </div>
      `;
      
      const errorStyle = document.createElement('style');
      errorStyle.textContent = `
        #zepra-ipq-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        }
        
        .ipq-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
        }
        
        .ipq-modal-container {
          position: relative;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 2px solid #f43f5e;
          border-radius: 20px;
          max-width: 400px;
          width: 90%;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(244, 63, 94, 0.3);
        }
        
        .ipq-modal-header {
          background: rgba(0, 0, 0, 0.4);
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(244, 63, 94, 0.2);
        }
        
        .ipq-modal-header h3 {
          margin: 0;
          color: #f43f5e;
          font-size: 18px;
          font-weight: bold;
        }
        
        .ipq-modal-close {
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .ipq-modal-close:hover {
          background: rgba(244, 63, 94, 0.2);
          color: #f43f5e;
        }
        
        .ipq-modal-body {
          padding: 24px;
        }
      `;
      
      document.head.appendChild(errorStyle);
      document.body.appendChild(errorModal);
      
      errorModal.querySelector('.ipq-modal-close').addEventListener('click', () => {
        errorModal.remove();
        errorStyle.remove();
      });
      
      errorModal.querySelector('.ipq-modal-overlay').addEventListener('click', (e) => {
        if (e.target === errorModal.querySelector('.ipq-modal-overlay')) {
          errorModal.remove();
          errorStyle.remove();
        }
      });
      
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    // Enhanced status logic with three states
    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    // Determine overall status
    let statusState = 'qualified'; // qualified, warning, not-qualified
    let statusText = 'QUALIFIED';
    let statusMessage = 'Your IP is clean and ready to use.';
    let statusClass = 'status-qualified';

    if (riskFail || !blacklistPass || !anonymityPass) {
      statusState = 'not-qualified';
      statusText = 'NOT QUALIFIED';
      statusClass = 'status-not-qualified';
      
      if (riskFail) {
        statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
      } else if (!blacklistPass) {
        statusMessage = 'Your IP is on a blacklist. You must change your connection.';
      } else if (!anonymityPass) {
        statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
      }
    } else if (riskWarning) {
      statusState = 'warning';
      statusText = 'WARNING';
      statusClass = 'status-warning';
      statusMessage = 'Your IP is moderately risky. Proceed with caution.';
    }

    // Enhanced particles with different counts based on status
    const particleCount = statusState === 'qualified' ? 20 : statusState === 'warning' ? 15 : 10;
    const particles = Array.from({ length: particleCount })
      .map((_, i) => `<span class="particle" style="--i:${i};"></span>`)
      .join('');

    // SVG Icons
    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    
    // Status-specific icons
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
    const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
    const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

    // Build checklist with enhanced logic
    const checks = [
      { 
        pass: riskPass, 
        warning: riskWarning,
        fail: riskFail,
        label: 'Risk Score Assessment', 
        icon: shieldSVG 
      },
      { 
        pass: blacklistPass, 
        warning: false,
        fail: !blacklistPass,
        label: 'Blacklist Verification', 
        icon: eyeSVG 
      },
      { 
        pass: anonymityPass, 
        warning: false,
        fail: !anonymityPass,
        label: 'Anonymity Detection', 
        icon: globeSVG 
      },
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;

    const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
    modal.querySelector('.styled-modal-content').classList.add(statusClass);
  }

  function showIPModal(info) {
    const {
      ip = 'Unknown',
      country = 'Unknown',
      city = 'Unknown',
      postal = 'Unknown',
      timezone = 'Unknown',
      isp = 'Unknown'
    } = info || {};

    const globe = `<svg class="ip-info-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    const mapPin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const mail = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>`;
    const clock = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const server = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
    const copySVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const modal = createStyledModal(`${globe} IP Information`, `
      <div class="ip-info-ip-box">
        <span class="ip-info-address">${ip}</span>
        <button class="ip-info-copy">${copySVG}<span>Copy</span></button>
      </div>
      <div class="ip-info-grid">
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mapPin}</div>
          <div>
            <div class="ip-info-card-label">Country</div>
            <div class="ip-info-card-value">${country}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mapPin}</div>
          <div>
            <div class="ip-info-card-label">City</div>
            <div class="ip-info-card-value">${city}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${mail}</div>
          <div>
            <div class="ip-info-card-label">Postal Code</div>
            <div class="ip-info-card-value">${postal}</div>
          </div>
        </div>
        <div class="ip-info-card">
          <div class="ip-info-card-icon">${clock}</div>
          <div>
            <div class="ip-info-card-label">Timezone</div>
            <div class="ip-info-card-value">${timezone}</div>
          </div>
        </div>
        <div class="ip-info-card ip-info-card-span">
          <div class="ip-info-card-icon">${server}</div>
          <div>
            <div class="ip-info-card-label">ISP</div>
            <div class="ip-info-card-value">${isp}</div>
          </div>
        </div>
      </div>
    `);

    const contentEl = modal.querySelector('.styled-modal-content');
    const headerEl = modal.querySelector('.styled-modal-header');
    const bodyEl = modal.querySelector('.styled-modal-body');
    contentEl.classList.add('ip-info-modal');
    headerEl.classList.add('ip-info-header');
    bodyEl.classList.add('ip-info-body');

    const style = document.createElement('style');
    style.textContent = `
      #zepra-styled-modal .ip-info-modal{background-color:rgba(17,24,39,0.8);backdrop-filter:blur(16px);border:1px solid rgba(56,189,248,0.2);box-shadow:0 0 30px rgba(56,189,248,0.1);border-radius:1.25rem;}
      #zepra-styled-modal .ip-info-header{background:linear-gradient(90deg,rgba(56,189,248,0.2),rgba(56,189,248,0));border-bottom:1px solid rgba(56,189,248,0.2);}
      #zepra-styled-modal .ip-info-header h3{margin:0;color:#fff;font-weight:700;display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .ip-info-header-icon{width:24px;height:24px;animation:spin 20s linear infinite;}
      #zepra-styled-modal .ip-info-body{padding:1.5rem;}
      #zepra-styled-modal .ip-info-ip-box{background-color:rgba(0,0,0,0.3);border:1px solid rgba(56,189,248,0.2);border-radius:0.75rem;padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;}
      #zepra-styled-modal .ip-info-address{font-family:monospace;font-size:1.25rem;color:#4ade80;text-shadow:0 0 8px #4ade80;}
      #zepra-styled-modal .ip-info-copy{display:flex;align-items:center;gap:0.25rem;background-color:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.4);color:#e2e8f0;padding:0.5rem 0.75rem;border-radius:0.5rem;cursor:pointer;transition:all 0.3s;}
      #zepra-styled-modal .ip-info-copy:hover{background-color:rgba(56,189,248,0.3);}
      #zepra-styled-modal .ip-info-copy.copied{background-color:rgba(74,222,128,0.25);border-color:#4ade80;color:#4ade80;}
      #zepra-styled-modal .ip-info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;}
      #zepra-styled-modal .ip-info-card{background-color:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .ip-info-card-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;background-color:rgba(56,189,248,0.15);border-radius:9999px;flex-shrink:0;}
      #zepra-styled-modal .ip-info-card-icon svg{width:18px;height:18px;}
      #zepra-styled-modal .ip-info-card-label{font-size:0.75rem;color:#d1d5db;}
      #zepra-styled-modal .ip-info-card-value{font-weight:600;color:#fff;}
      #zepra-styled-modal .ip-info-card-span{grid-column:span 2;}
      @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
    `;
    modal.appendChild(style);

    const copyBtn = modal.querySelector('.ip-info-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ip);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `${checkSVG}<span>Copied!</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = `${copySVG}<span>Copy</span>`;
        }, 1500);
      } catch (e) {}
    });
  }

  async function showFakeInfoModal() {
    const COUNTRY_CODES = "AF AX AL DZ AS AD AO AI AQ AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(' ');
    const datalist = `<datalist id="fiNatList">${COUNTRY_CODES.map(c=>`<option value="${c}">`).join('')}</datalist>`;
    const { fakeInfo } = await chrome.storage.local.get('fakeInfo');

    const icons = {
      userPlus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`,
      mail: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>`,
      phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/></svg>`,
      house: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
      cake: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></svg>`,
      copy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
      pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
      plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`
    };

    const content = `
      <div class="fi-controls">
        <select id="fiGender">
          <option value="">Any Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <input id="fiNat" list="fiNatList" placeholder="Country code (e.g., us)" />
      </div>
      ${datalist}
      <main id="fiMain" class="fi-main">
        <div id="fiLoader" class="fi-loader"></div>
        <div id="fiData" class="fi-data"></div>
      </main>
      <footer class="fi-footer">
        <button id="fiRegenerate" class="fi-regenerate"><span class="fi-regenerate-text">Regenerate Info</span></button>
      </footer>
    `;
    const modal = createStyledModal(`${icons.userPlus} Fake User Info`, content);

    const contentEl = modal.querySelector('.styled-modal-content');
    const headerEl = modal.querySelector('.styled-modal-header');
    const bodyEl = modal.querySelector('.styled-modal-body');
    contentEl.classList.add('fi-modal');
    headerEl.classList.add('fi-header');
    bodyEl.classList.add('fi-body');

    const style = document.createElement('style');
    style.textContent = `
      #zepra-styled-modal .fi-modal{background-color:rgba(17,24,39,0.7);backdrop-filter:blur(24px);border:1px solid rgba(74,222,128,0.2);box-shadow:0 0 40px rgba(10,70,30,0.5);border-radius:1.25rem;max-width:360px;width:90%;}
      #zepra-styled-modal .fi-header{background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-header h3{margin:0;display:flex;align-items:center;gap:0.5rem;color:#fff;font-weight:700;}
      #zepra-styled-modal .fi-header svg{width:20px;height:20px;color:#4ade80;stroke:#4ade80;filter:drop-shadow(0 0 6px #4ade80);}
      #zepra-styled-modal .fi-body{padding:1rem;display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-controls{display:flex;gap:0.5rem;}
      #zepra-styled-modal .fi-controls select,#zepra-styled-modal .fi-controls input{flex:1;background:rgba(0,0,0,0.3);border:1px solid #334155;border-radius:0.5rem;color:#e2e8f0;padding:0.5rem;font-size:0.875rem;}
      #zepra-styled-modal .fi-main{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-loader .fi-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;}
      #zepra-styled-modal .fi-loader .fi-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes fiPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      #zepra-styled-modal .fi-data{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-id-card{position:relative;display:flex;align-items:center;gap:0.75rem;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;}
      #zepra-styled-modal .fi-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(74,222,128,0.6);box-shadow:0 0 10px rgba(74,222,128,0.4);}
      #zepra-styled-modal .fi-pic-add{position:absolute;top:-8px;right:-8px;}
      #zepra-styled-modal .fi-name{font-weight:600;color:#fff;}
      #zepra-styled-modal .fi-age{font-size:0.875rem;color:#d1d5db;display:flex;align-items:center;gap:0.25rem;}
      #zepra-styled-modal .fi-age svg{width:16px;height:16px;}
      #zepra-styled-modal .fi-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.5rem 0.75rem;}
      #zepra-styled-modal .fi-info-left{display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .fi-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      #zepra-styled-modal .fi-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      #zepra-styled-modal .fi-info-label{font-size:0.75rem;color:#d1d5db;}
      #zepra-styled-modal .fi-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      #zepra-styled-modal .fi-actions{display:flex;gap:0.25rem;}
      #zepra-styled-modal .fi-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;}
      #zepra-styled-modal .fi-action:hover{background:rgba(74,222,128,0.15);}
      #zepra-styled-modal .fi-action svg{width:14px;height:14px;}
      #zepra-styled-modal .fi-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-4px);background:#000;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;}
      #zepra-styled-modal .fi-action:hover::after{opacity:1;}
      #zepra-styled-modal .fi-footer{padding-top:0.5rem;border-top:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:opacity 0.3s;}
      #zepra-styled-modal .fi-regenerate:disabled{opacity:0.5;cursor:not-allowed;}
      #zepra-styled-modal .fi-spinner{width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(style);

    const loader = modal.querySelector('#fiLoader');
    const dataEl = modal.querySelector('#fiData');
    const regenBtn = modal.querySelector('#fiRegenerate');

    function showLoader(){
      loader.innerHTML = `
        <div class="fi-skel-card"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
      `;
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="fi-spinner"></span><span>Generating...</span>';
      try {
        const gender = modal.querySelector('#fiGender').value;
        const nat = modal.querySelector('#fiNat').value.trim();
        const resp = await chrome.runtime.sendMessage({ type:'GENERATE_FAKE_INFO', gender, nat });
        if (!resp?.ok) throw new Error(resp?.error || 'Failed');
        await chrome.storage.local.set({ fakeInfo: resp.data });
        render(resp.data);
      } catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    function render(user){
      const name = `${user.name?.first || ''} ${user.name?.last || ''}`.trim();
      const address = `${user.location?.street?.number || ''} ${user.location?.street?.name || ''}, ${user.location?.city || ''}, ${user.location?.country || ''}`.trim();
      const age = user.dob?.age || '';
      const fields = [
        { label:'Email', value:user.email, key:'email', icon:icons.mail },
        { label:'Phone', value:user.phone, key:'phone', icon:icons.phone },
        { label:'Address', value:address, key:'address1', icon:icons.house }
      ];
      dataEl.innerHTML = `
        <div class="fi-id-card">
          ${user.picture?.large ? `<img class="fi-avatar" src="${user.picture.large}"/>` : ''}
          <div class="fi-id-info">
            <div class="fi-name">${name || 'Unknown'}</div>
            <div class="fi-age">${icons.cake} ${age ? `${age} years old` : ''}</div>
          </div>
          ${user.picture?.large ? `<button id="fiPicAdd" class="fi-action fi-pic-add" data-tip="Add Picture">${icons.plus}</button>` : ''}
        </div>
        ${fields.map((f,i)=>`
          <div class="fi-info-row">
            <div class="fi-info-left">
              <div class="fi-info-icon">${f.icon}</div>
              <div>
                <div class="fi-info-label">${f.label}</div>
                <div class="fi-info-value">${f.value || 'Unknown'}</div>
              </div>
            </div>
            <div class="fi-actions">
              <button class="fi-action" data-copy="${i}" data-tip="Copy">${icons.copy}</button>
              <button class="fi-action" data-write="${i}" data-tip="Write Here">${icons.pencil}</button>
              <button class="fi-action" data-add="${i}" data-tip="Add to Identity">${icons.plus}</button>
            </div>
          </div>
        `).join('')}
      `;
      hideLoader();
      dataEl.style.display = 'flex';
      regenBtn.disabled = false;
      regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';

      const picBtn = dataEl.querySelector('#fiPicAdd');
      if(picBtn){
        picBtn.addEventListener('click',()=>{
          addFieldToIdentity(picBtn, user.picture.large, 'profilePictureUrl', 'Picture Saved!');
        });
      }
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value || '');
          showNotification('Copied to clipboard');
        });
      });
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-write');
          const text = fields[idx].value || '';
          const m = document.getElementById('zepra-styled-modal');
          if (m) m.remove();
          typeAnswer(text);
        });
      });
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
    }

    regenBtn.addEventListener('click', async ()=>{
      await chrome.storage.local.remove('fakeInfo');
      generate();
    });

    if(fakeInfo){
      render(fakeInfo);
    }
  }
  async function showRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
      #zepra-real-address-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
      }
      
      .ra-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ra-modal-container {
        position: relative;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ra-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ra-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ra-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ra-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ra-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ra-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      
      .ra-input {
        background: rgba(0,0,0,0.3);
        border: 1px solid #334155;
        border-radius: 0.5rem;
        color: #e2e8f0;
        padding: 0.75rem;
        font-size: 0.875rem;
        transition: all 0.3s;
      }
      
      .ra-input:focus {
        outline: none;
        border-color: #4ade80;
        box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
      }
      
      .ra-generate-btn {
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
      }
      
      .ra-generate-btn:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-generate-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      
      .ra-generate-btn svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-loader {
        padding: 1rem;
      }
      
      .ra-skel-card {
        height: 80px;
        border-radius: 0.75rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
      }
      
      .ra-skel-line {
        height: 16px;
        border-radius: 0.25rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
        margin-top: 0.5rem;
      }
      
      @keyframes raPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      
      .ra-data {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      
      .ra-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(31,41,55,0.5);
        border: 1px solid #374151;
        border-radius: 0.75rem;
        padding: 0.75rem;
        transition: all 0.3s;
      }
      
      .ra-info-row:hover {
        background: rgba(31,41,55,0.8);
        border-color: #4ade80;
        transform: translateY(-1px);
      }
      
      .ra-info-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      
      .ra-info-icon {
        width: 32px;
        height: 32px;
        background: rgba(74,222,128,0.15);
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ra-info-icon svg {
        width: 18px;
        height: 18px;
        color: #4ade80;
        stroke: #4ade80;
      }
      
      .ra-info-content {
        flex: 1;
      }
      
      .ra-info-label {
        font-size: 0.75rem;
        color: #d1d5db;
        margin-bottom: 2px;
      }
      
      .ra-info-value {
        font-weight: 600;
        color: #fff;
        font-size: 0.875rem;
      }
      
      .ra-actions {
        display: flex;
        gap: 0.25rem;
      }
      
      .ra-action {
        position: relative;
        background: transparent;
        border: none;
        color: #e2e8f0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .ra-action:hover {
        background: rgba(74,222,128,0.15);
        transform: scale(1.1);
      }
      
      .ra-action svg {
        width: 14px;
        height: 14px;
      }
      
      .ra-action::after {
        content: attr(data-tip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translate(-50%,-8px);
        background: rgba(0,0,0,0.9);
        color: #fff;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        z-index: 1000;
      }
      
      .ra-action:hover::after {
        opacity: 1;
      }
      
      .ra-regenerate {
        width: 100%;
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
        margin-top: 1rem;
      }
      
      .ra-regenerate:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-regenerate svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(11,27,19,0.2);
        border-top-color: #0b1b13;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      const box = modal.querySelector('#raResult');
      box.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2l3 3"/><path d="M11 21H4a2 2 0 0 1-2-2v-7l14.5-14.5a2.12 2.12 0 0 1 3 3L8 17"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      `).join('');
      
      // Add regenerate button
      box.innerHTML += `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
          <span>Regenerate Info</span>
        </button>
      `;
      
      box.style.display='block';
      chrome.storage.local.set({realAddress: parts});
      box.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      box.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-write');
          const text=fields[idx].value||'';
          const m=document.getElementById('zepra-styled-modal');
          if(m) m.remove();
          typeAnswer(text);
        });
      });
      box.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
      
      box.querySelector('#raRegenerate').addEventListener('click', async ()=>{
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        showCleanRealAddressModal();
      });
    }

    if(saved){
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      try{
        const country=modal.querySelector('#raCountry').value.trim();
        const state=modal.querySelector('#raState').value.trim();
        const city=modal.querySelector('#raCity').value.trim();
        const resp=await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    modal.querySelector('#raGenerate').addEventListener('click', generate);
  }

  // Clean Real Address Modal - New Implementation
  async function showCleanRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
             @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
       #zepra-real-address-modal {
         position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647;
         display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s ease-out;
       }
      .ra-modal-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); }
      .ra-modal-container {
        position: relative; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 2px solid #4ade80;
        border-radius: 20px; max-width: 450px; width: 90%; max-height: 80vh; overflow: hidden;
        box-shadow: 0 0 50px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes modalSlideIn { from { opacity: 0; transform: scale(0.8) translateY(50px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .ra-modal-header { background: rgba(0, 0, 0, 0.4); padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(74, 222, 128, 0.2); }
      .ra-header-content { display: flex; align-items: center; gap: 12px; }
      .ra-header-content svg { width: 24px; height: 24px; color: #4ade80; stroke: #4ade80; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-header h3 { margin: 0; color: #4ade80; font-size: 18px; font-weight: bold; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-close { background: none; border: none; color: #e2e8f0; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
      .ra-modal-close:hover { background: rgba(74, 222, 128, 0.2); color: #4ade80; transform: scale(1.1); }
      .ra-modal-body { padding: 24px; overflow-y: auto; max-height: 60vh; }
      .ra-controls { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; }
      .ra-input { background: rgba(0,0,0,0.3); border: 1px solid #334155; border-radius: 0.5rem; color: #e2e8f0; padding: 0.75rem; font-size: 0.875rem; transition: all 0.3s; }
      .ra-input:focus { outline: none; border-color: #4ade80; box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2); }
      .ra-generate-btn { background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; }
      .ra-generate-btn:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-generate-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
      .ra-generate-btn svg { width: 16px; height: 16px; }
      .ra-loader { padding: 1rem; }
      .ra-skel-card { height: 80px; border-radius: 0.75rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; }
      .ra-skel-line { height: 16px; border-radius: 0.25rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; margin-top: 0.5rem; }
      @keyframes raPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      .ra-data { display: flex; flex-direction: column; gap: 1rem; }
      .ra-info-row { display: flex; align-items: center; justify-content: space-between; background: rgba(31,41,55,0.5); border: 1px solid #374151; border-radius: 0.75rem; padding: 0.75rem; transition: all 0.3s; }
      .ra-info-row:hover { background: rgba(31,41,55,0.8); border-color: #4ade80; transform: translateY(-1px); }
      .ra-info-left { display: flex; align-items: center; gap: 0.75rem; }
      .ra-info-icon { width: 32px; height: 32px; background: rgba(74,222,128,0.15); border-radius: 9999px; display: flex; align-items: center; justify-content: center; }
      .ra-info-icon svg { width: 18px; height: 18px; color: #4ade80; stroke: #4ade80; }
      .ra-info-content { flex: 1; }
      .ra-info-label { font-size: 0.75rem; color: #d1d5db; margin-bottom: 2px; }
      .ra-info-value { font-weight: 600; color: #fff; font-size: 0.875rem; }
      .ra-actions { display: flex; gap: 0.25rem; }
      .ra-action { position: relative; background: transparent; border: none; color: #e2e8f0; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
      .ra-action:hover { background: rgba(74,222,128,0.15); transform: scale(1.1); }
      .ra-action svg { width: 14px; height: 14px; }
      .ra-action::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translate(-50%,-8px); background: rgba(0,0,0,0.9); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 1000; }
      .ra-action:hover::after { opacity: 1; }
      .ra-regenerate { width: 100%; background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; margin-top: 1rem; }
      .ra-regenerate:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-regenerate svg { width: 16px; height: 16px; }
      .ra-spinner { width: 16px; height: 16px; border: 2px solid rgba(11,27,19,0.2); border-top-color: #0b1b13; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });

    // Get elements
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    // Utility functions
    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      
      dataEl.style.display = 'block';
      dataEl.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </button>
          </div>
        </div>
      `).join('') + `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span>Regenerate Address</span>
        </button>
      `;

      // Event listeners for actions
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-write');
          writeInFocusedInput(fields[idx].value||'');
        });
      });
      
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });

      // Regenerate button
      dataEl.querySelector('#raRegenerate').addEventListener('click', async () => {
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        raStyle.remove();
        showCleanRealAddressModal();
      });
    }

    // Generate function
    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      
      try{
        const country = modal.querySelector('#raCountry').value.trim();
        const state = modal.querySelector('#raState').value.trim();
        const city = modal.querySelector('#raCity').value.trim();
        
        const resp = await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
        
        await chrome.storage.local.set({ realAddress: parse(resp.result) });
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    // Event listener for generate button
    regenBtn.addEventListener('click', generate);

    // Check for saved data
    const saved = (await chrome.storage.local.get('realAddress')).realAddress;
    if (saved && (saved.a1 || saved.a2 || saved.zip)) {
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }
  }

  async function showCompanyInfoModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-company-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-company-modal';
    modal.innerHTML = `
      <div class="ci-modal-overlay">
        <div class="ci-modal-container">
          <div class="ci-modal-header">
            <div class="ci-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
              <h3>Generate Company Info</h3>
            </div>
            <button class="ci-modal-close">&times;</button>
          </div>
          <div class="ci-modal-body">
            <div id="ciLoader" class="ci-loader">
              <div class="ci-skel-card"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
            </div>
            <div id="ciResult" class="ci-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;
    
    // Add unified styling for company info
    const ciStyle = document.createElement('style');
    ciStyle.textContent = `
      #zepra-company-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .ci-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ci-modal-container {
        position: relative;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ci-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ci-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ci-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ci-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ci-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ci-loader{padding:1rem;}
      .ci-loader .ci-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;}
      .ci-loader .ci-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes ciPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      .ci-data{display:flex;flex-direction:column;gap:1rem;}
      .ci-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;transition:all 0.3s;}
      .ci-info-row:hover{background:rgba(31,41,55,0.8);border-color:#4ade80;transform:translateY(-1px);}
      .ci-info-left{display:flex;align-items:center;gap:0.75rem;}
      .ci-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      .ci-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      .ci-info-content{flex:1;}
      .ci-info-label{font-size:0.75rem;color:#d1d5db;margin-bottom:2px;}
      .ci-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      .ci-actions{display:flex;gap:0.25rem;}
      .ci-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;}
      .ci-action:hover{background:rgba(74,222,128,0.15);transform:scale(1.1);}
      .ci-action svg{width:14px;height:14px;}
      .ci-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-8px);background:rgba(0,0,0,0.9);color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:1000;}
      .ci-action:hover::after{opacity:1;}
      .ci-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:all 0.3s;margin-top:1rem;}
      .ci-regenerate:hover{background:#22d3ee;transform:translateY(-2px);box-shadow:0 8px 25px rgba(34,211,238,0.4);}
      .ci-regenerate svg{width:16px;height:16px;}
      .ci-spinner{width:16px;height:16px;border:2px solid rgba(11,27,19,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(ciStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ci-modal-close').addEventListener('click', () => {
      modal.remove();
      ciStyle.remove();
    });
    
    modal.querySelector('.ci-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ci-modal-overlay')) {
        modal.remove();
        ciStyle.remove();
      }
    });
    const loader = modal.querySelector('#ciLoader');
    const dataEl = modal.querySelector('#ciResult');
    try{
      const res = await chrome.runtime.sendMessage({ type:'GENERATE_COMPANY' });
      if(!res?.ok) throw new Error('fetch');
      let data;
      try {
        data = JSON.parse(res.result);
      } catch (err) {
        console.error('Zepra Debug: Failed to parse AI response. Raw response was:', res?.result);
        throw new Error('parse');
      }
      const fields = [
        {label:'Company Name', value:data.companyName, key:'companyName', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>`},
        {label:'Industry', value:data.companyIndustry, key:'companyIndustry', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`},
        {label:'Company Size', value:data.companySize, key:'companySize', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m22 21-3-3 3-3"/><path d="M16 8h.01"/></svg>`},
        {label:'Annual Revenue', value:data.companyAnnualRevenue, key:'companyAnnualRevenue', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`},
        {label:'Website', value:data.companyWebsite, key:'companyWebsite', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`},
        {label:'Address', value:data.companyAddress, key:'companyAddress', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`}
      ];
      
      loader.style.display = 'none';
      dataEl.innerHTML = fields.map((f,i)=>`
        <div class="ci-info-row">
          <div class="ci-info-left">
            <div class="ci-info-icon">${f.icon}</div>
            <div class="ci-info-content">
              <div class="ci-info-label">${f.label}</div>
              <div class="ci-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ci-actions">
            <button class="ci-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ci-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      `).join('');
      
      // Add regenerate button
      dataEl.innerHTML += `
        <button class="ci-regenerate" onclick="document.getElementById('zepra-styled-modal').remove(); showCompanyInfoModal();">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
          <span>Regenerate Company</span>
        </button>
      `;
      
      dataEl.style.display = 'block';
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
    }catch(e){
      loader.style.display = 'none';
      dataEl.style.display = 'block';
      if(e.message === 'parse') {
        dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: AI provided an invalid response format.</div>';
      } else {
        dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: Could not connect to the AI service. Please check your API key and network connection.</div>';
      }
    }
  }

  function showLastAnswerModal(answer) {
    const text = (answer || '').trim();
    if (!text) { showNotification('No last answer available'); return; }
    const modal = createStyledModal('Last Answer', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <div id="lastAnswerText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; color: #e2e8f0;">${text}</div>
        <div id="lastAnswerCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
        <div id="lastAnswerBtns" style="display: flex; justify-content: center; gap: 10px;">
          <button id="lastAnswerType" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Start Typing</button>
          <button id="lastAnswerCopy" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Manual Entry</button>
        </div>
      </div>
    `);

    setTimeout(() => {
      document.getElementById('lastAnswerType')?.addEventListener('click', async () => {
        const txt = document.getElementById('lastAnswerText');
        const cd = document.getElementById('lastAnswerCountdown');
        const btns = document.getElementById('lastAnswerBtns');
        if (txt) txt.style.display = 'none';
        if (btns) btns.style.display = 'none';
        if (cd) {
          cd.style.display = 'block';
          let count = 3;
          cd.textContent = count;
          const timer = setInterval(() => {
            count--;
            if (count > 0) {
              cd.textContent = count;
            } else {
              clearInterval(timer);
              const m = document.getElementById('zepra-styled-modal');
              if (m) m.remove();
              typeAnswer(text, { skipCountdown: true });
            }
          }, 1000);
        }
      });
      document.getElementById('lastAnswerCopy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
        showNotification('Answer copied to clipboard');
      });
    }, 100);
  }

  function showNewSurveyModal() {
    navigator.clipboard.readText().then(clipboardText => {
      const modal = createStyledModal('New Survey', `
        <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
          <p style="color: #e2e8f0; margin-bottom: 15px;">The text in your clipboard will be typed in human-like manner:</p>
          <div id="newSurveyText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 150px; overflow-y: auto;">
            <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${clipboardText || 'No text in clipboard'}</pre>
          </div>
          <div id="newSurveyCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
          <div id="newSurveyBtns" style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
            <button id="writeNowBtn" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Start Typing</button>
            <button id="manualEntryBtn" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Manual Entry</button>
          </div>
        </div>
      `, () => {
        // Clear new survey context
        chrome.runtime.sendMessage({ type: 'NEW_SURVEY_CONTEXT' });
      });

      // Add event listener for Write Now button
      setTimeout(() => {
        const writeBtn = document.getElementById('writeNowBtn');
        const manualBtn = document.getElementById('manualEntryBtn');
        const txt = document.getElementById('newSurveyText');
        const cd = document.getElementById('newSurveyCountdown');
        const btns = document.getElementById('newSurveyBtns');
        if (writeBtn) {
          writeBtn.addEventListener('click', () => {
            if (txt) txt.style.display = 'none';
            if (btns) btns.style.display = 'none';
            if (cd) {
              cd.style.display = 'block';
              let count = 3; cd.textContent = count;
              const interval = setInterval(() => {
                count--;
                if (count > 0) {
                  cd.textContent = count;
                } else {
                  clearInterval(interval);
                  const m = document.getElementById('zepra-styled-modal');
                  if (m) m.remove();
                  typeAnswer(clipboardText, { skipCountdown: true });
                }
              }, 1000);
            }
          });
        }
        if (manualBtn) {
          manualBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(clipboardText || '');
            const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
            showNotification('Answer copied to clipboard');
          });
        }
      }, 100);
    }).catch(() => {
      showNotification('Could not access clipboard');
    });
  }

  function startOCRCapture() {
    showOverlayAndSelect().then(async (rect) => {
      if (!rect) return;
      try {
        const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
        const response = await chrome.runtime.sendMessage({
          type: 'CAPTURE_AND_OCR',
          rect: rect,
          tabId: await getTabId(),
          ocrLang
        });
        if (response?.ok) {
          showOCRResultModal(response.text);
        } else {
          showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
        }
      } catch (e) {
        showNotification('OCR error: ' + e.message);
      }
    });
  }

  async function startFullPageOCR() {
    try {
      showNotification('Starting full page OCR...');
      const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_FULL_PAGE_OCR',
        tabId: await getTabId(),
        ocrLang
      });
      if (response?.ok) {
        showOCRResultModal(response.text);
      } else {
        showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
      }
    } catch (e) {
      showNotification('OCR error: ' + e.message);
    }
  }

  function showOCRResultModal(extractedText) {
    const modal = createStyledModal('OCR Result', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <p style="color: #e2e8f0; margin-bottom: 15px;">Extracted Text:</p>
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 300px; overflow-y: auto;">
          <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${extractedText}</pre>
        </div>
        <div style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
          <button id="sendToAI" style="background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Send to AI</button>
          <button id="retakeOCR" style="background: linear-gradient(45deg, #feca57, #ff9ff3); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Retake</button>
        </div>
      </div>
    `);

    // Add event listeners
    setTimeout(() => {
      const sendBtn = document.getElementById('sendToAI');
      const retakeBtn = document.getElementById('retakeOCR');
      
      if (sendBtn) {
        sendBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          createRainbowModal(extractedText);
        });
      }
      
      if (retakeBtn) {
        retakeBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          startOCRCapture();
        });
      }
    }, 100);
  }

  function createSurveyAgentPanel(title, bodyHtml, onClose) {
    const existing = document.getElementById('zepra-survey-agent-panel');
    if (existing && existing.isConnected) {
      if (typeof existing.__zepraCleanup === 'function') {
        try {
          existing.__zepraCleanup();
        } catch (err) {
          // ignore cleanup failures
        }
      }
      if (typeof existing.__zepraOnClose === 'function') {
        try {
          existing.__zepraOnClose();
        } catch (err) {
          // ignore stale callbacks
        }
      }
      existing.remove();
    }

    const panel = document.createElement('aside');
    panel.id = 'zepra-survey-agent-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', title);
    panel.innerHTML = bodyHtml || '';

    const closeBtn = panel.querySelector('.survey-agent-close');

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
    };

    const closePanel = () => {
      panel.classList.remove('is-open');
      panel.classList.add('is-closing');
      panel.__zepraCleanup?.();
      setTimeout(() => {
        if (panel.isConnected) {
          panel.remove();
        }
        panel.__zepraOnClose?.();
      }, 220);
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }

    panel.__zepraCleanup = () => {
      window.removeEventListener('keydown', handleEscape, true);
      if (closeBtn) {
        closeBtn.removeEventListener('click', closePanel);
      }
    };

    panel.__zepraOnClose = () => {
      if (typeof onClose === 'function') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape, true);

    document.body.appendChild(panel);
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
    });

    return panel;
  }

  function createStyledModal(title, content, onClose) {
    // Remove existing modal
    const existing = document.getElementById('zepra-styled-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'zepra-styled-modal';
    modal.innerHTML = `
      <div class="styled-modal-content">
        <div class="styled-modal-header">
          <h3>${title}</h3>
          <button class="styled-modal-close">&times;</button>
        </div>
        <div class="styled-modal-body">
          ${content}
        </div>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .styled-modal-content {
        background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
        border-radius: 15px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        border: 3px solid #39ff14;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      }
      
      .styled-modal-header {
        background: rgba(0,0,0,0.2);
        padding: 15px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #292d33;
      }
      
      .styled-modal-header h3 {
        margin: 0;
        color: #39ff14;
        font-size: 18px;
        font-weight: bold;
      }
      
      .styled-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .styled-modal-close:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .styled-modal-body {
        padding: 20px;
        color: #e2e8f0;
        overflow-y: auto;
        max-height: 60vh;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.styled-modal-close').addEventListener('click', () => {
      modal.remove();
      style.remove();
      if (onClose) onClose();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        style.remove();
        if (onClose) onClose();
      }
    });

    return modal;
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
      color: #e2e8f0;
      padding: 15px 20px;
      border-radius: 10px;
      box-shadow: 0 5px 20px rgba(0,0,0,0.3);
      z-index: 2147483649;
      font-size: 14px;
      white-space: pre-line;
      text-align: center;
      animation: slideDown 0.3s ease-out;
      border: 2px solid #39ff14;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideUp 0.3s ease-out forwards';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  async function createRainbowModal(selectedText, customPromptId = null) {
    if (STATE.modal) return;

    const { showReasoning = false } = await chrome.storage.local.get('showReasoning');

    const modal = document.createElement('div');
    modal.id = 'zepra-modal';
    modal.innerHTML = `
      <div class="za-modal">
        <header class="za-header">
          <h2>Zepra Answer</h2>
          <button class="modal-close">×</button>
        </header>
        <main class="za-body">
          <div class="za-question-box">${selectedText}</div>
          <div class="answer-container${showReasoning ? ' split' : ''}">
            <div class="loading"></div>
            ${showReasoning ? `
            <div class="split-pane" style="display:none;">
              <div class="pane-card answer-pane">
                <div class="pane-header">
                  <div class="pane-title">Answer</div>
                  <button class="pane-copy btn-copy-answer" type="button">Copy</button>
                </div>
                <div class="pane-body">
                  <div class="pane-text answer-text"></div>
                </div>
              </div>
              <div class="pane-card reason-pane">
                <div class="pane-header">
                  <div class="pane-title">Reason</div>
                  <button class="pane-copy btn-copy-reason" type="button">Copy</button>
                </div>
                <div class="pane-body">
                  <div class="pane-text reason-text"></div>
                </div>
              </div>
            </div>
            ` : `
            <div class="answer-text" style="display:none;"></div>
            `}
          </div>
        </main>
        <footer class="za-footer">
          <div class="modal-actions" style="display:none;">
            <button class="btn-write-here action-btn" data-color="cyan">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write Here</span>
            </button>
            <button class="btn-write-all action-btn" data-color="gray">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write All</span>
            </button>
            ${showReasoning ? '' : `<button class="btn-copy action-btn" data-color="pink">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <span>Copy</span>
            </button>`}
            <button class="btn-humanizer action-btn" data-color="teal">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 4V2" />
                <path d="M15 16v-2" />
                <path d="M8 9h2" />
                <path d="M20 9h2" />
                <path d="M17.8 11.8 19 13" />
                <path d="M15 9h.01" />
                <path d="M17.8 6.2 19 5" />
                <path d="m3 21 9-9" />
                <path d="M12.2 6.2 11 5" />
              </svg>
              <span>AI Humanizer</span>
            </button>
            <button class="btn-use-prompt action-btn" data-color="yellow">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
              </svg>
              <span>Use Custom Prompt</span>
            </button>
          </div>
        </footer>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .answer-container.split .split-pane {
        display:grid;
        gap:1rem;
        grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
      }

      .answer-container.split .pane-card {
        position:relative;
        display:flex;
        flex-direction:column;
        gap:0.75rem;
        padding:1.15rem;
        min-height:200px;
        border-radius:1rem;
        border:1px solid rgba(148,163,184,0.22);
        background:linear-gradient(165deg, rgba(12,18,32,0.94), rgba(17,24,39,0.82));
        box-shadow:0 24px 45px -35px rgba(15,23,42,0.95), 0 0 0 1px rgba(15,23,42,0.6);
        backdrop-filter:blur(12px);
        overflow:hidden;
      }

      .answer-container.split .pane-card::before {
        content:'';
        position:absolute;
        inset:-1px;
        border-radius:inherit;
        background:radial-gradient(circle at 20% -10%, rgba(59,130,246,0.18), transparent 60%);
        opacity:0.85;
        pointer-events:none;
        z-index:0;
      }

      .answer-container.split .answer-pane::before {
        background:radial-gradient(circle at 20% -10%, rgba(45,212,191,0.3), transparent 60%);
      }

      .answer-container.split .reason-pane::before {
        background:radial-gradient(circle at 20% -10%, rgba(250,204,21,0.32), rgba(244,114,182,0.22) 55%, transparent 80%);
      }

      .answer-container.split .pane-card > * {
        position:relative;
        z-index:1;
      }

      .answer-container.split .answer-pane {
        border-color:rgba(45,212,191,0.35);
        box-shadow:0 24px 40px -32px rgba(20,184,166,0.55), 0 0 0 1px rgba(20,184,166,0.3);
      }

      .answer-container.split .reason-pane {
        border-color:rgba(244,114,182,0.4);
        background:linear-gradient(170deg, rgba(23,16,32,0.95), rgba(27,20,35,0.82));
        box-shadow:0 24px 40px -32px rgba(236,72,153,0.55), 0 0 0 1px rgba(236,72,153,0.28);
      }

      .answer-container.split .pane-header {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:0.75rem;
        padding-bottom:0.5rem;
        border-bottom:1px solid rgba(148,163,184,0.18);
        flex-wrap:wrap;
      }

      .answer-container.split .pane-title {
        margin:0;
        font-weight:700;
        font-size:0.85rem;
        letter-spacing:0.08em;
        text-transform:uppercase;
        color:#bae6fd;
        line-height:1.1;
      }

      .answer-container.split .answer-pane .pane-title {
        color:#5eead4;
        text-shadow:0 0 12px rgba(94,234,212,0.35);
      }

      .answer-container.split .reason-pane .pane-title {
        color:#f9a8d4;
        text-shadow:0 0 12px rgba(244,114,182,0.35);
      }

      .answer-container.split .answer-pane .pane-header {
        border-color:rgba(45,212,191,0.2);
      }

      .answer-container.split .reason-pane .pane-header {
        border-color:rgba(244,114,182,0.24);
      }

      .answer-container.split .pane-body {
        flex:1;
        padding:0.9rem;
        border-radius:0.85rem;
        background:linear-gradient(160deg, rgba(10,16,28,0.85), rgba(15,23,42,0.7));
        border:1px solid rgba(148,163,184,0.18);
        box-shadow:inset 0 0 0 1px rgba(15,23,42,0.4);
        overflow-y:auto;
        max-height:min(300px,40vh);
      }

      .answer-container.split .answer-pane .pane-body {
        border-color:rgba(45,212,191,0.28);
        box-shadow:inset 0 0 0 1px rgba(13,148,136,0.3);
      }

      .answer-container.split .reason-pane .pane-body {
        border-color:rgba(244,114,182,0.3);
        box-shadow:inset 0 0 0 1px rgba(244,114,182,0.25);
        background:linear-gradient(160deg, rgba(23,16,32,0.92), rgba(27,20,35,0.82));
      }

      .answer-container.split .pane-body::-webkit-scrollbar {
        width:6px;
      }

      .answer-container.split .pane-body::-webkit-scrollbar-track {
        background:transparent;
      }

      .answer-container.split .answer-pane .pane-body::-webkit-scrollbar-thumb {
        background:rgba(45,212,191,0.45);
      }

      .answer-container.split .reason-pane .pane-body::-webkit-scrollbar-thumb {
        background:rgba(244,114,182,0.55);
      }

      .answer-container.split .pane-text {
        color:#f8fafc;
        font-size:0.95rem;
        line-height:1.6;
        white-space:pre-wrap;
        word-break:break-word;
        text-align:start;
        unicode-bidi:plaintext;
      }

      .answer-container.split .pane-copy {
        border:none;
        border-radius:999px;
        padding:0.4rem 0.95rem;
        font-size:0.7rem;
        letter-spacing:0.08em;
        text-transform:uppercase;
        font-weight:600;
        cursor:pointer;
        transition:transform .2s ease, box-shadow .2s ease, background .2s ease;
        color:#f8fafc;
        background:rgba(148,163,184,0.24);
        flex-shrink:0;
      }

      .answer-container.split .pane-copy:hover {
        transform:translateY(-1px);
      }

      .answer-container.split .pane-copy:focus-visible {
        outline:2px solid rgba(250,204,21,0.6);
        outline-offset:2px;
      }

      .answer-container.split .answer-pane .pane-copy {
        background:rgba(45,212,191,0.22);
        color:#5eead4;
        box-shadow:0 10px 25px -20px rgba(20,184,166,0.8), 0 0 0 1px rgba(45,212,191,0.35);
      }

      .answer-container.split .answer-pane .pane-copy:hover {
        background:rgba(45,212,191,0.32);
      }

      .answer-container.split .reason-pane .pane-copy {
        background:rgba(244,114,182,0.22);
        color:#f9a8d4;
        box-shadow:0 10px 25px -20px rgba(236,72,153,0.8), 0 0 0 1px rgba(244,114,182,0.35);
      }

      .answer-container.split .reason-pane .pane-copy:hover {
        background:rgba(244,114,182,0.32);
      }

      .za-modal {
        background-color: rgba(17,24,39,0.8);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(244,63,94,0.2);
        box-shadow: 0 0 30px rgba(244,63,94,0.1);
        border-radius: 1rem;
        width: 90%;
        max-width: 600px;
        max-height: 85vh;
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }

      .za-header,
      .za-footer {
        padding: 1rem 1.25rem;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom:1px solid rgba(244,63,94,0.2);
      }

      .za-footer {
        border-bottom:none;
        border-top:1px solid rgba(244,63,94,0.2);
      }

      .za-header h2 {
        color: #4ade80;
        margin:0;
        font-size:1.25rem;
        text-shadow:0 0 8px #4ade80;
      }

      .modal-close {
        background:none;
        border:none;
        color:#e2e8f0;
        font-size:1.25rem;
        width:2rem;
        height:2rem;
        border-radius:9999px;
        cursor:pointer;
        transition:background .2s;
      }

      .modal-close:hover {
        background:rgba(255,255,255,0.1);
      }

      .za-body {
        padding:1.25rem;
        color:#e2e8f0;
        overflow-y:auto;
      }

      .za-question-box {
        background:rgba(17,24,39,0.5);
        border-left:2px solid #facc15;
        box-shadow:-2px 0 8px #facc15;
        padding:1rem;
        border-radius:0.5rem;
        margin-bottom:1rem;
        max-height:200px;
        overflow-y:auto;
      }

      .answer-container {
        display:flex;
        flex-direction:column;
        gap:0.75rem;
        min-height:60px;
      }

      .answer-container:not(.split) .answer-text {
        display:none;
        flex-direction:column;
        gap:0.75rem;
      }

      .answer-container.split .answer-text,
      .answer-container.split .reason-text {
        display:block;
      }

      .answer-card {
        background-color:rgba(31,41,55,0.6);
        border:1px solid #374151;
        padding:1rem;
        border-radius:0.5rem;
      }

      .loading {
        text-align:center;
        padding:1rem;
        animation:pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%,100%{opacity:0.6;}
        50%{opacity:1;}
      }

      .modal-actions {
        display:flex;
        gap:0.75rem;
        width:100%;
      }

      .action-btn {
        flex:1;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:0.25rem;
        padding:0.75rem;
        border:none;
        border-radius:0.5rem;
        color:#f8fafc;
        cursor:pointer;
        position:relative;
        overflow:hidden;
        transition:transform .2s;
      }

      .action-btn .icon {
        width:24px;
        height:24px;
      }

      .action-btn::before {
        content:'';
        position:absolute;
        inset:0;
        border-radius:0.5rem;
        opacity:0;
        transition:opacity .2s;
        background:radial-gradient(circle at center, rgba(255,255,255,0.4), transparent 70%);
        filter:blur(12px);
      }

      .action-btn:hover::before {
        opacity:1;
      }

      .action-btn:hover {
        transform:translateY(-2px);
      }

      .action-btn[data-color="cyan"] { background:#06b6d4; }
      .action-btn[data-color="gray"] { background:#4b5563; }
      .action-btn[data-color="pink"] { background:#f472b6; }
      .action-btn[data-color="teal"] { background:#14b8a6; }
      .action-btn[data-color="yellow"] { background:#facc15; color:#1f2937; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    STATE.modal = modal;

    const loadEl = modal.querySelector('.loading');
    await setLoadingMessage(loadEl);

    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Generate answer
    generateAnswer(selectedText, customPromptId, showReasoning);
  }

  async function generateAnswer(questionText, customPromptId = null, forceReason = null) {
    try {
      const ctx = await getContext();
      const { showReasoning = false, reasonLang = 'English', cerebrasModel } = await chrome.storage.local.get(['showReasoning','reasonLang','cerebrasModel']);
      const useReason = forceReason !== null ? forceReason : showReasoning;
      const thinking = isThinkingModel(cerebrasModel);
      let raw = '';
      let promptName = 'auto';
      if (customPromptId) {
        const resp = await chrome.runtime.sendMessage({ type: 'RUN_CUSTOM_PROMPT', id: customPromptId, text: questionText });
        if (!resp?.ok) throw new Error(resp?.error || 'Generation failed');
        raw = resp.result;
        promptName = resp.promptName || 'custom';
        await chrome.storage.local.set({ lastCustomPromptId: customPromptId });
      } else {
        const prompt = buildPrompt('auto', questionText, ctx, { withReason: useReason, reasonLang, thinking });
        const response = await chrome.runtime.sendMessage({ type: 'CEREBRAS_GENERATE', prompt });
        if (!response?.ok) throw new Error(response?.error || 'Generation failed');
        raw = response.result;
      }
      const parsed = parseResponse(raw, useReason);
      let answer, reason;
      if (useReason) {
        answer = parsed.answer || '';
        reason = parsed.reason || '';
      } else {
        const joined = parsed.join('\n');
        answer = joined;
      }
      STATE.currentAnswer = answer;
      await chrome.storage.local.set({ lastAnswer: answer });

      // Update modal
      const modal = STATE.modal;
      if (modal) {
        const loadEl = modal.querySelector('.loading');
        loadEl.style.display = 'none';
        if (useReason) {
          const split = modal.querySelector('.split-pane');
          split.style.display = 'grid';
          const answerEl = modal.querySelector('.answer-pane .answer-text');
          const reasonEl = modal.querySelector('.reason-pane .reason-text');
          const answerBody = modal.querySelector('.answer-pane .pane-body');
          const reasonBody = modal.querySelector('.reason-pane .pane-body');
          if (answerEl) {
            answerEl.textContent = answer;
            answerEl.style.display = 'block';
            answerEl.setAttribute('dir', 'auto');
          }
          if (reasonEl) {
            reasonEl.textContent = reason;
            reasonEl.style.display = 'block';
            reasonEl.setAttribute('dir', 'auto');
          }
          if (answerBody) answerBody.scrollTop = 0;
          if (reasonBody) reasonBody.scrollTop = 0;
          modal.querySelector('.modal-actions').style.display = 'flex';
          modal.querySelector('.btn-copy-answer').addEventListener('click', () => {
            navigator.clipboard.writeText(answer);
            showNotification('Answer copied to clipboard!');
          });
          modal.querySelector('.btn-copy-reason').addEventListener('click', () => {
            navigator.clipboard.writeText(reason);
            showNotification('Reason copied to clipboard!');
          });
        } else {
          const ansEl = modal.querySelector('.answer-text');
          ansEl.style.display = 'flex';
          ansEl.innerHTML = answer.split('\n').map(a => `<div class="answer-card">${a}</div>`).join('');
          modal.querySelector('.modal-actions').style.display = 'flex';
          modal.querySelector('.btn-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(answer);
            showNotification('Answer copied to clipboard!');
          });
        }

        modal.querySelector('.btn-write-here').addEventListener('click', async () => {
          closeModal();
          if (useReason) {
            await typeAnswer(answer);
          } else {
            await typeAnswer(parsed[0] || '');
          }
        });

        modal.querySelector('.btn-write-all').addEventListener('click', async () => {
          closeModal();
          if (useReason) {
            await typeAnswer(answer, { skipCountdown: true });
          } else {
            for (const part of parsed) {
              await new Promise(r => setTimeout(r, 3000));
              await typeAnswer(part, { skipCountdown: true });
            }
          }
        });

        modal.querySelector('.btn-humanizer').addEventListener('click', async () => {
          await navigator.clipboard.writeText(answer);
          await openAIHumanizer();
        });

        modal.querySelector('.btn-use-prompt').addEventListener('click', () => {
          openPromptSelector(questionText);
        });
      }

      // Save context
      await saveContext({ q: questionText, a: answer, promptName });

    } catch (e) {
      if (STATE.modal) {
        STATE.modal.querySelector('.loading').textContent = 'Error: ' + (e.message || 'Failed to generate answer');
      }
    }
  }

  async function openPromptSelector(questionText){
    const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
    if(!customPrompts.length){ showNotification('No custom prompts'); return; }
    const content = `
      <input id="prFilter" placeholder="Filter by tag" style="margin-bottom:10px;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;width:100%;"/>
      <div id="prList"></div>
      <div class="pr-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:15px;">
        <button id="prRun" class="btn primary">Generate</button>
        <button id="prCancel" class="btn">Cancel</button>
      </div>`;
    const modal = createStyledModal('Custom Prompts', content, null);
    const style = document.createElement('style');
    style.textContent = `#prList{max-height:200px;overflow:auto;} .pr-item{padding:8px 12px;border:1px solid #334155;border-radius:6px;margin-bottom:8px;cursor:pointer;} .pr-item.selected{border-color:#ffd600;background:rgba(255,214,0,0.1);} .btn{background:#1f2937;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:8px 16px;cursor:pointer;transition:filter .2s;} .btn:hover{filter:brightness(1.1);} .btn.primary{background:#22c55e;border-color:#22c55e;color:#0b1215;font-weight:600;}`;
    modal.appendChild(style);
    const listEl = modal.querySelector('#prList');
    let filtered=[...customPrompts]; let selectedId=null;
    function render(){
      listEl.innerHTML = filtered.map(p=>`<div class="pr-item" data-id="${p.id}">${p.name}</div>`).join('');
      listEl.querySelectorAll('.pr-item').forEach(it=>{
        it.addEventListener('click',()=>{
          selectedId = it.dataset.id;
          listEl.querySelectorAll('.pr-item').forEach(x=>x.classList.remove('selected'));
          it.classList.add('selected');
        });
      });
    }
    render();
    modal.querySelector('#prFilter').addEventListener('input', e=>{
      const tag=e.target.value.trim();
      filtered = customPrompts.filter(p=>!tag || (p.tags||[]).includes(tag));
      selectedId=null; render();
    });
    modal.querySelector('#prCancel').addEventListener('click',()=>modal.remove());
    modal.querySelector('#prRun').addEventListener('click', async () => {
      const pr = customPrompts.find(p=>p.id===selectedId);
      if(!pr){ showNotification('Select a prompt'); return; }
      modal.remove();
      if(STATE.modal){
        const loadEl = STATE.modal.querySelector('.loading');
        const ansEl = STATE.modal.querySelector('.answer-text');
        const act = STATE.modal.querySelector('.modal-actions');
        loadEl.style.display='block';
        await setLoadingMessage(loadEl);
        ansEl && (ansEl.style.display='none');
        act.style.display='none';
        // Reuse the main generation function for consistency and maintainability.
        generateAnswer(questionText, pr.id);
      }
    });
  }

  function closeModal() {
    if (STATE.modal) {
      STATE.modal.remove();
      STATE.modal = null;
    }
  }

  async function typeAnswer(text, opts = {}) {
    if (STATE.isTyping) return;
    STATE.isTyping = true;

    try {
      const { typingSpeed = 'normal' } = await chrome.storage.local.get('typingSpeed');
      if (STATE.lastFocused) STATE.lastFocused.focus();
      if (!opts.skipCountdown) await showCountdown(3);
      await typeIntoFocusedElement(text, { speed: typingSpeed });
      showNotification('Answer typed successfully!');
    } catch (e) {
      showNotification('Failed to type answer: ' + e.message);
    } finally {
      STATE.isTyping = false;
    }
  }

  function extractJSON(text){
    try {
      const idx = text.lastIndexOf('{');
      if (idx === -1) return null;
      return JSON.parse(text.slice(idx));
    } catch { return null; }
  }

  function parseResponse(text, withReason){
    const obj = extractJSON(text);
    if (withReason) {
      return {
        answer: String(obj?.answer || '').trim(),
        reason: String(obj?.reason || '').trim()
      };
    }
    if (obj && Array.isArray(obj.answers)) {
      return obj.answers.map(a => String(a).trim());
    }
    return [text.trim()];
  }

  function isThinkingModel(model){
    return /thinking/i.test(model || '');
  }

  async function setLoadingMessage(el){
    const { cerebrasModel } = await chrome.storage.local.get('cerebrasModel');
    if (isThinkingModel(cerebrasModel)) {
      el.innerHTML = '<span class="thinking-icon">🧠</span><span>Thinking...</span>';
    } else {
      el.textContent = 'Generating answer...';
    }
  }

  function buildPrompt(mode, question, context, opts = {}) {
    const { withReason = false, reasonLang = 'English', thinking = false } = opts;
    const ctxLines = (context || []).map((c, i) => `Q${i + 1}: ${c.q}\nA${i + 1}: ${c.a}`).join('\n');
    let rules = `You are building a consistent survey profile. Use prior context if helpful and choose answers that keep the participant qualified for the survey.\nSTRICT OUTPUT RULES:\n`;
    if (withReason) {
      rules += `- Final response MUST be JSON: {"answer": "", "reason": ""}. Reason must be in ${reasonLang}.\n`;
    } else {
      rules += `- Respond ONLY with JSON: {"answers": ["answer1", "answer2", ...]}.\n`;
    }
    if (thinking) rules += '- After any reasoning, end with the JSON object.\n';
    rules += '- Language: match the question language.';
    const tasks = {
      open: 'Open-ended: write 1-3 short natural sentences.',
      mcq: 'Multiple Choice: return the EXACT option text from the provided question/options.',
      scale: 'Scale: return ONLY a single integer (e.g., 1-5 or 1-10).',
      yesno: 'Yes/No: return ONLY "Yes" or "No".',
      auto: 'Auto-detect the type (Open-ended, MCQ, Scale, Yes/No) and answer accordingly.'
    };
    const task = tasks[mode] || tasks.auto;
    return `${rules}\n${task}\n\nPRIOR CONTEXT (last Q/A):\n${ctxLines || 'None'}\n\nQUESTION:\n${question}\n\nANSWER:`;
  }

  async function getContext() {
    const o = await chrome.storage.local.get('contextQA');
    return o.contextQA || [];
  }

  async function saveContext(entry) {
    const list = await getContext();
    list.push(entry);
    while (list.length > 10) list.shift();
    await chrome.storage.local.set({ contextQA: list });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'PING':
            sendResponse({ ok: true });
            break;
          case 'GET_SELECTED_OR_DOM_TEXT':
            sendResponse({ ok: true, text: getSelectedOrDomText() });
            break;
          case 'SURVEY_AGENT_COLLECT_DOM': {
            const domTree = await collectSurveyDomTree(msg.options || {});
            sendResponse({ ok: true, tree: domTree });
            break;
          }
          case 'SURVEY_AGENT_EXECUTE_ACTION': {
            const result = await executeSurveyAgentAction(msg.action || {});
            sendResponse(result);
            break;
          }
          case 'SURVEY_AGENT_STATUS_UPDATE': {
            if (msg.message) {
              setSurveyAgentStatusMessage(String(msg.message), msg.tone || 'status');
            }
            sendResponse({ ok: true });
            break;
          }
          case 'START_OCR_SELECTION': {
            const rect = await showOverlayAndSelect();
            sendResponse({ ok: true, rect });
            break;
          }
          case 'TYPE_TEXT': {
            const { text, options } = msg;
            await showCountdown(3);
            await typeIntoFocusedElement(text, options || {});
            sendResponse({ ok: true });
            break;
          }
          case 'CROP_IMAGE_IN_CONTENT': {
            const { dataUrl, rect } = msg;
            const cropped = await cropInPage(dataUrl, rect);
            sendResponse({ ok: true, dataUrl: cropped });
            break;
          }
          case 'SHOW_ZEPRA_MODAL': {
            createRainbowModal(msg.text);
            sendResponse({ ok: true });
            break;
          }
          case 'GET_PAGE_DIMENSIONS': {
            sendResponse({ ok: true, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewHeight: window.innerHeight, dpr: window.devicePixelRatio });
            break;
          }
          case 'SCROLL_TO': {
            window.scrollTo(0, msg.y || 0);
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown message' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  });

  function getSelectedOrDomText() {
    const sel = window.getSelection();
    let t = sel && sel.toString ? sel.toString().trim() : '';
    if (t) return t;
    const el = document.activeElement;
    if (!el) return '';
    if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return (el.value || '').trim();
    return (el.innerText || el.textContent || '').trim();
  }

  function showOverlayAndSelect() {
    return new Promise((resolve) => {
      if (STATE.overlay) cleanup();
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.05)';
      const rectEl = document.createElement('div');
      rectEl.style.cssText = 'position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,.15);pointer-events:none;left:0;top:0;width:0;height:0;';
      overlay.appendChild(rectEl);
      document.documentElement.appendChild(overlay);
      STATE.overlay = overlay; STATE.rectEl = rectEl;
      let sx = 0, sy = 0, ex = 0, ey = 0, drag = false;
      const onDown = (e) => { drag = true; sx = e.clientX; sy = e.clientY; ex = sx; ey = sy; update(); };
      const onMove = (e) => { if (!drag) return; ex = e.clientX; ey = e.clientY; update(); };
      const onUp = () => { drag = false; const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); const dpr = window.devicePixelRatio || 1; cleanup(); resolve({ x, y, width: w, height: h, dpr }); };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      function update() { const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); Object.assign(rectEl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); }
      function cleanup() { overlay.removeEventListener('mousedown', onDown, true); overlay.removeEventListener('mousemove', onMove, true); overlay.removeEventListener('mouseup', onUp, true); window.removeEventListener('keydown', onKey, true); overlay.remove(); STATE.overlay = null; STATE.rectEl = null; }
      overlay.addEventListener('mousedown', onDown, true);
      overlay.addEventListener('mousemove', onMove, true);
      overlay.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
    });
  }

  async function cropInPage(dataUrl, rect) {
    const img = document.createElement('img');
    img.src = dataUrl; await img.decode();
    const dpr = rect.dpr || 1;
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * dpr));
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * dpr));
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function showCountdown(sec) {
    return new Promise((resolve) => {
      let count = sec;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:20px;right:20px;padding:8px 14px;background:rgba(0,0,0,0.7);color:#39ff14;font-size:24px;border-radius:8px;z-index:2147483647;';
      el.textContent = count;
      document.body.appendChild(el);
      const timer = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(timer);
          el.remove();
          resolve();
        } else {
          el.textContent = count;
        }
      }, 1000);
    });
  }

  async function typeIntoFocusedElement(text, options) {
    const el = document.activeElement || document.body;
    const speed = options.speed || 'normal';
    const delays = speed === 'fast' ? [5, 15] : speed === 'slow' ? [60, 120] : [25, 60];
    const isInput = (n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA');
    const isCE = (n) => n && n.isContentEditable;
    const dispatch = (node, type) => node && node.dispatchEvent(new Event(type, { bubbles: true }));
    const setter = isInput(el)
      ? (v) => { const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set; set ? set.call(el, v) : el.value = v; }
      : isCE(el)
        ? (v) => { el.textContent = v; }
        : (v) => { el.textContent = v; };
    const getter = isInput(el) ? () => el.value : () => (el.value ?? el.textContent ?? '');
    dispatch(el, 'focus');
    let cur = getter();
    // Clear existing value
    if (isInput(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    else if (isCE(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    for (const ch of (text || '')) {
      dispatch(el, 'keydown');
      setter(cur + ch);
      cur += ch;
      dispatch(el, 'input');
      dispatch(el, 'keyup');
      await sleep(rand(delays[0], delays[1]));
    }
    dispatch(el, 'change');
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function getTabId() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
      return response?.tabId || 0;
    } catch {
      return 0;
    }
  }

  function toggleHumanTyping() {
    // This would toggle between normal and human-like typing
    showNotification('Human typing mode toggled');
  }

  function handleSelection(e) {
    if (e && e.type === 'mouseup') {
      STATE.lastMouse = { x: e.clientX, y: e.clientY };
    }
    const sel = window.getSelection();
    const text = sel && sel.toString ? sel.toString().trim() : '';
    if (text) {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!(rect.width || rect.height)) {
        rect = { top: STATE.lastMouse.y, right: STATE.lastMouse.x, bottom: STATE.lastMouse.y, left: STATE.lastMouse.x };
      }
      showSelectionButton(rect, text);
    } else {
      removeSelectionButton();
    }
  }

  function showSelectionButton(rect, text) {
    removeSelectionButton();
    const btn = document.createElement('div');
    btn.id = 'zepra-gen-btn';
    btn.textContent = 'Generate Answer';
    document.body.appendChild(btn);
    const btnWidth = btn.offsetWidth || 120;
    const btnHeight = btn.offsetHeight || 24;
    let left = window.scrollX + rect.right + 5;
    let top = window.scrollY + rect.top - 30;
    left = Math.min(window.scrollX + window.innerWidth - btnWidth - 10, Math.max(window.scrollX + 10, left));
    top = Math.min(window.scrollY + window.innerHeight - btnHeight - 10, Math.max(window.scrollY + 10, top));
    btn.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:2147483647;background:#23272b;color:#39ff14;padding:4px 8px;border-radius:6px;font-size:12px;box-shadow:0 0 8px rgba(255,152,0,0.7);cursor:pointer;transition:transform 0.2s;`;
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      removeSelectionButton();
      createRainbowModal(text);
    });
    STATE.selBtn = btn;
  }

  function removeSelectionButton() {
    if (STATE.selBtn) { STATE.selBtn.remove(); STATE.selBtn = null; }
  }

  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('keyup', handleSelection);
  // Removed selectionchange to ensure Generate button remains clickable
  document.addEventListener('mousedown', (e) => {
    if (STATE.selBtn && !STATE.selBtn.contains(e.target)) removeSelectionButton();
  });

  // Initialize floating bubble when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingBubble);
  } else {
    createFloatingBubble();
  }
  watchForms();

  // Add CSS animations
  const globalStyle = document.createElement('style');
  globalStyle.textContent = `
    @keyframes slideDown {
      from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(0); opacity: 1; }
      to { transform: translateX(-50%) translateY(-20px); opacity: 0; }
    }
  `;
  document.head.appendChild(globalStyle);

}

chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
  if (loggedIn) init();
});
chrome.storage.onChanged.addListener((chg, area) => {
  if (area === 'local' && chg.loggedIn?.newValue) init();
});

// Clean Professional IP Qualification Modal
function showCleanIPQualificationModal(data) {
  if (!data) {
    createStyledModal(
      'IP Qualification',
      `<div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>`
    );
    return;
  }

  const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
  const ip = data.ip || data.query || '';
  const city = data.city || data.region_name || data.region || '';
  const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
  const isp = data.isp || data.org || '';
  const flag = cc ? cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

  const detection = data?.blacklists?.detection || 'none';
  const detectionEngines = Array.isArray(data?.blacklists?.engines)
    ? data.blacklists.engines
        .filter((engine) => engine?.listed)
        .map((engine) => engine?.name || engine?.engine)
        .filter(Boolean)
    : [];
  const proxy = !!data?.security?.proxy;
  const vpn = !!data?.security?.vpn;
  const tor = !!data?.security?.tor;

  const riskPass = risk < 30;
  const riskWarning = risk >= 30 && risk <= 50;
  const riskFail = risk > 50;
  const blacklistPass = detection === 'none' && detectionEngines.length === 0;
  const anonymityPass = !proxy && !vpn && !tor;

  let statusState = 'qualified';
  let statusText = 'Qualified';
  let statusMessage = 'Your IP is clean and ready to use.';
  let statusClass = 'status-qualified';

  if (riskFail || !blacklistPass || !anonymityPass) {
    statusState = 'not-qualified';
    statusText = 'Not Qualified';
    statusClass = 'status-not-qualified';

    if (riskFail) {
      statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
    } else if (!blacklistPass) {
      statusMessage = 'Your IP is on a blacklist. You must change your connection.';
    } else if (!anonymityPass) {
      statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
    }
  } else if (riskWarning) {
    statusState = 'warning';
    statusText = 'Warning';
    statusClass = 'status-warning';
    statusMessage = 'Your IP is moderately risky. Proceed with caution.';
  }

  const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const copySVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

  const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
  const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const checkCompactSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const detectionSources = detectionEngines.length
    ? detectionEngines
    : detection !== 'none' && detection
      ? [detection]
      : [];
  const formattedSources = detectionSources
    .map((src) => src.replace(/[_-]+/g, ' '))
    .map((src) => src.replace(/\b\w/g, (ch) => ch.toUpperCase()));

  const riskDetail = riskFail
    ? `High risk score detected • ${risk}/100`
    : riskWarning
      ? `Moderate risk profile • ${risk}/100`
      : `Low risk score • ${risk}/100`;
  const blacklistDetail = blacklistPass
    ? 'No blacklist matches detected'
    : `Listed on ${formattedSources.join(', ') || 'reported sources'}`;
  const anonymityFlags = [];
  if (proxy) anonymityFlags.push('Proxy');
  if (vpn) anonymityFlags.push('VPN');
  if (tor) anonymityFlags.push('Tor');
  const anonymityDetail = anonymityPass
    ? 'No proxy, VPN or Tor activity detected'
    : `Detected: ${anonymityFlags.join(', ') || 'Anonymity services'}`;

  const checks = [
    {
      key: 'risk',
      label: 'Risk Score Assessment',
      detail: riskDetail,
      state: riskFail ? 'fail' : riskWarning ? 'warn' : 'pass',
      icon: shieldSVG
    },
    {
      key: 'blacklist',
      label: 'Blacklist Verification',
      detail: blacklistDetail,
      state: blacklistPass ? 'pass' : 'fail',
      icon: eyeSVG
    },
    {
      key: 'anonymity',
      label: 'Anonymity Detection',
      detail: anonymityDetail,
      state: anonymityPass ? 'pass' : 'fail',
      icon: globeSVG
    }
  ];

  const stateBadges = {
    pass: { label: 'Passed', icon: checkSVG },
    warn: { label: 'Attention', icon: warningSVG },
    fail: { label: 'Failed', icon: xSVG }
  };

  const checkHTML = checks
    .map((item) => {
      const badge = stateBadges[item.state];
      return `
        <div class="ipq-check-card ipq-${item.state}">
          <div class="ipq-check-left">
            <div class="ipq-check-icon">${item.icon}</div>
            <div class="ipq-check-titles">
              <span class="ipq-check-title">${item.label}</span>
              <span class="ipq-check-detail">${item.detail}</span>
            </div>
          </div>
          <div class="ipq-check-status">${badge.icon}<span>${badge.label}</span></div>
        </div>`;
    })
    .join('');

  const locationParts = [city, cc].filter(Boolean).join(', ');
  const locationDisplay = locationParts ? `${flag ? `${flag} ` : ''}${locationParts}` : 'Unknown';
  const ispDisplay = isp || 'Unknown';

  const html = `
    <style>
      #zepra-styled-modal .styled-modal-content.ipq-shell {
        background: linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(11,15,25,0.92) 100%);
        border: none;
        border-radius: 20px;
        box-shadow: 0 25px 50px -12px rgba(15,23,42,0.8);
        max-width: 420px;
        width: min(420px, 92vw);
        overflow: hidden;
      }
      #zepra-styled-modal .ipq-shell {
        --ipq-accent: #22c55e;
        --ipq-accent-soft: rgba(34,197,94,0.2);
        --ipq-accent-strong: rgba(34,197,94,0.35);
      }
      #zepra-styled-modal .ipq-shell.status-warning {
        --ipq-accent: #f59e0b;
        --ipq-accent-soft: rgba(245,158,11,0.18);
        --ipq-accent-strong: rgba(245,158,11,0.32);
      }
      #zepra-styled-modal .ipq-shell.status-not-qualified {
        --ipq-accent: #ef4444;
        --ipq-accent-soft: rgba(239,68,68,0.18);
        --ipq-accent-strong: rgba(239,68,68,0.32);
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header {
        background: linear-gradient(90deg, rgba(148,163,184,0.14), rgba(148,163,184,0));
        border-bottom: 1px solid rgba(148,163,184,0.18);
        padding: 18px 22px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header h3 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        color: #f8fafc;
        font-size: 17px;
        font-weight: 700;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header svg {
        width: 22px;
        height: 22px;
        stroke: var(--ipq-accent);
        color: var(--ipq-accent);
      }
      #zepra-styled-modal .ipq-shell .styled-modal-close {
        color: #94a3b8;
        border-radius: 10px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-close:hover {
        background: rgba(148,163,184,0.16);
        color: #e2e8f0;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body {
        padding: 1.5rem;
        background: radial-gradient(circle at top, rgba(30,41,59,0.65), rgba(15,23,42,0.92));
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-height: 65vh;
        overflow-y: auto;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body::-webkit-scrollbar {
        width: 6px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body::-webkit-scrollbar-thumb {
        background: rgba(148,163,184,0.35);
        border-radius: 999px;
      }
      .ipq-status-card {
        background: rgba(15,23,42,0.55);
        border: 1px solid rgba(148,163,184,0.2);
        border-radius: 1rem;
        padding: 1.2rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        box-shadow: inset 0 0 0 1px rgba(15,23,42,0.35);
      }
      .ipq-status-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .ipq-status-head {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
      }
      .ipq-status-label {
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.14em;
        font-weight: 600;
        color: var(--ipq-accent);
      }
      .ipq-status-message {
        margin: 0;
        color: #e2e8f0;
        font-size: 0.92rem;
        line-height: 1.45;
      }
      .ipq-risk-block {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
        min-width: 0;
      }
      .ipq-risk-caption {
        font-size: 0.72rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .ipq-risk-value {
        font-size: 2.6rem;
        font-weight: 700;
        color: var(--ipq-accent);
        font-family: 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace;
        line-height: 1;
      }
      .ipq-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0.75rem;
      }
      .ipq-meta-card {
        background: rgba(15,23,42,0.5);
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 0.9rem;
        padding: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 0;
      }
      .ipq-meta-card.ipq-span {
        grid-column: span 2;
      }
      .ipq-meta-label {
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .ipq-meta-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .ipq-meta-value {
        color: #f8fafc;
        font-weight: 600;
        word-break: break-word;
      }
      .ipq-ip-value {
        font-family: 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace;
        font-size: 1.1rem;
        color: var(--ipq-accent);
      }
      .ipq-copy-btn {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        background: rgba(148,163,184,0.12);
        border: 1px solid rgba(148,163,184,0.28);
        color: #e2e8f0;
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .ipq-copy-btn:hover {
        background: rgba(148,163,184,0.24);
      }
      .ipq-copy-btn svg {
        width: 14px;
        height: 14px;
      }
      .ipq-copy-btn.copied {
        background: var(--ipq-accent-soft);
        border-color: var(--ipq-accent);
        color: var(--ipq-accent);
      }
      .ipq-copy-btn.error {
        background: rgba(239,68,68,0.18);
        border-color: rgba(239,68,68,0.4);
        color: #f87171;
      }
      .ipq-check-grid {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .ipq-check-card {
        background: rgba(15,23,42,0.48);
        border: 1px solid rgba(148,163,184,0.16);
        border-radius: 0.9rem;
        padding: 0.95rem 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-width: 0;
      }
      .ipq-check-left {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        min-width: 0;
      }
      .ipq-check-icon {
        width: 34px;
        height: 34px;
        border-radius: 0.8rem;
        background: rgba(148,163,184,0.12);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .ipq-check-icon svg {
        width: 18px;
        height: 18px;
        stroke-width: 2;
      }
      .ipq-check-titles {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
      }
      .ipq-check-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #f8fafc;
      }
      .ipq-check-detail {
        color: #94a3b8;
        font-size: 0.82rem;
        line-height: 1.35;
      }
      .ipq-check-status {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-weight: 600;
        font-size: 0.85rem;
        flex-shrink: 0;
      }
      .ipq-check-status svg {
        width: 18px;
        height: 18px;
      }
      .ipq-check-card.ipq-pass .ipq-check-icon {
        background: var(--ipq-accent-soft);
        color: var(--ipq-accent);
      }
      .ipq-check-card.ipq-pass .ipq-check-status {
        color: var(--ipq-accent);
      }
      .ipq-check-card.ipq-warn .ipq-check-icon {
        background: rgba(245,158,11,0.18);
        color: #f59e0b;
      }
      .ipq-check-card.ipq-warn .ipq-check-status {
        color: #f59e0b;
      }
      .ipq-check-card.ipq-fail .ipq-check-icon {
        background: rgba(239,68,68,0.18);
        color: #ef4444;
      }
      .ipq-check-card.ipq-fail .ipq-check-status {
        color: #ef4444;
      }
      .ipq-footer-note {
        font-size: 0.75rem;
        color: #64748b;
        text-align: center;
      }
      @media (max-width: 520px) {
        #zepra-styled-modal .ipq-shell .styled-modal-body {
          padding: 1.25rem;
        }
        .ipq-status-top {
          flex-direction: column;
          align-items: flex-start;
        }
        .ipq-risk-block {
          align-items: flex-start;
        }
        .ipq-meta-card.ipq-span {
          grid-column: span 1;
        }
      }
    </style>
    <div class="ipq-body">
      <section class="ipq-status-card">
        <div class="ipq-status-top">
          <div class="ipq-status-head">
            <span class="ipq-status-label">${statusText.toUpperCase()}</span>
            <p class="ipq-status-message">${statusMessage}</p>
          </div>
          <div class="ipq-risk-block">
            <span class="ipq-risk-caption">Risk Score</span>
            <span class="ipq-risk-value">${risk}</span>
          </div>
        </div>
      </section>
      <section class="ipq-meta-grid">
        <div class="ipq-meta-card ipq-span">
          <div class="ipq-meta-label">IP Address</div>
          <div class="ipq-meta-row">
            <span class="ipq-meta-value ipq-ip-value">${ip || 'Unknown'}</span>
            ${ip ? `<button class="ipq-copy-btn" data-copy="${ip}">${copySVG}<span>Copy</span></button>` : ''}
          </div>
        </div>
        <div class="ipq-meta-card">
          <div class="ipq-meta-label">Location</div>
          <div class="ipq-meta-value">${locationDisplay}</div>
        </div>
        <div class="ipq-meta-card">
          <div class="ipq-meta-label">ISP</div>
          <div class="ipq-meta-value">${ispDisplay}</div>
        </div>
      </section>
      <section class="ipq-check-grid">${checkHTML}</section>
      <p class="ipq-footer-note">Scores are provided by ip-score.com and refreshed on each request.</p>
    </div>`;

  const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
  const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
  const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;

  let headerIcon = shieldCheckSVG;
  if (statusState === 'warning') headerIcon = shieldWarningSVG;
  else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

  const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
  const shell = modal.querySelector('.styled-modal-content');
  shell.classList.add('ipq-shell', statusClass);

  const copyBtn = modal.querySelector('.ipq-copy-btn');
  if (copyBtn && copyBtn.dataset.copy) {
    const original = copyBtn.innerHTML;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        copyBtn.classList.remove('error');
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `${checkCompactSVG}<span>Copied</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = original;
        }, 1600);
      } catch (err) {
        copyBtn.classList.remove('copied');
        copyBtn.classList.add('error');
        copyBtn.innerHTML = `<span>Copy failed</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('error');
          copyBtn.innerHTML = original;
        }, 1600);
      }
    });
  }
}

