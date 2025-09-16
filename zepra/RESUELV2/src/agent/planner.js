/*
 * Survey Agent planner
 * Builds chunked action plans from DOM summaries using Cerebras chat completions.
 */
(function attachSurveyAgentPlanner(globalThis) {
  const ALLOWED_ACTION_TYPES = new Set([
    'click',
    'type',
    'select',
    'scroll',
    'navigate',
    'back',
    'forward',
    'reload',
    'wait',
  ]);

  const MAX_HISTORY_ITEMS = 12;
  const MAX_CHAT_ITEMS = 12;
  const MAX_NODE_SUMMARY = 140;
  const MAX_ATTR_LENGTH = 80;
  const MAX_NODES = 120;

  const DEFAULT_RULES_TEXT = [
    '- Respond with JSON ONLY. No code fences, markdown, or commentary.',
    '- Reference elements by their highlight index when available.',
    '- Use status "done" only when the survey appears complete.',
    '- Use status "abort" if the task cannot progress.',
    '- For "type" actions include the "text" field.',
    '- For dropdowns or multiple choice, use "select" with the desired option text.',
    '- When filling known profile information, set step.intent to "identity.<field>" and use text "{{IDENTITY.<field>}}".',
    '- Prefer profile data over inventing new answers when identity placeholders are available.',
    '- Consider OCR hints when planning steps for image-based questions.',
    '- Propose exactly ONE next action (chunked planning).'
  ].join('\n');

  const DEFAULT_FORMAT_GUIDE = '{\n'
    + '  "status": "continue" | "done" | "abort",\n'
    + '  "explanation": "Short natural language reasoning",\n'
    + '  "step": {\n'
    + '    "type": "click" | "type" | "select" | "scroll" | "navigate" | "back" | "forward" | "reload" | "wait",\n'
    + '    "locator": { "highlightIndex": number?, "xpath": string?, "cssSelector": string? },\n'
    + '    "text": string?,\n'
    + '    "url": string?,\n'
    + '    "ms": number?,\n'
    + '    "intent": string?\n'
    + '  },\n'
    + '  "confidence": number (0-1)\n'
    + '}';

  const DEFAULT_PROMPT_TEMPLATE = [
    "You are Zepra's survey automation planner. You see a DOM snapshot of a survey page and a short history of executed actions.",
    'Plan ONLY the next action needed to progress towards completing the survey.',
    '',
    '{{GOAL_SECTION}}',
    '',
    'Allowed action types:',
    '{{ALLOWED_ACTIONS}}',
    '',
    'Response format:',
    '{{FORMAT_GUIDE}}',
    '',
    'Rules:',
    '{{RULES}}',
    '',
    'DOM summary:',
    '{{DOM_SUMMARY}}',
    '',
    'Recent history:',
    '{{HISTORY}}',
    '',
    'Operator chat history:',
    '{{CHAT_HISTORY}}',
    '',
    'Identity profile:',
    '{{IDENTITY}}',
    '',
    'Image/OCR hints:',
    '{{MEDIA_HINTS}}',
    '',
    'Page context:',
    '{{PAGE_CONTEXT}}',
    '',
    'Respond with the JSON schema shown above.{{EXTRA_INSTRUCTIONS}}'
  ].join('\n');

  globalThis.SURVEY_AGENT_DEFAULT_PROMPT_TEMPLATE = DEFAULT_PROMPT_TEMPLATE;

  function safeJsonParse(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        const candidate = text.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch (nestedErr) {
          return null;
        }
      }
      return null;
    }
  }

  function truncate(str, max = MAX_NODE_SUMMARY) {
    if (!str) return '';
    const s = String(str).trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
  }

  function collectTextFromNode(nodeId, map, visited, limit) {
    if (!nodeId || !map || visited.has(nodeId)) return '';
    visited.add(nodeId);
    const node = map[nodeId];
    if (!node) return '';
    if (typeof node.text === 'string') {
      return truncate(node.text, limit);
    }
    let buffer = '';
    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        if (buffer.length >= limit) break;
        buffer += ` ${collectTextFromNode(childId, map, visited, limit - buffer.length)}`;
      }
    }
    if (buffer) return truncate(buffer, limit);
    if (node.attributes) {
      const labelAttr = node.attributes['aria-label'] || node.attributes['aria-labelledby'];
      if (labelAttr) return truncate(labelAttr, limit);
      const placeholder = node.attributes.placeholder;
      if (placeholder) return truncate(placeholder, limit);
      const value = node.attributes.value;
      if (value) return truncate(value, limit);
      const name = node.attributes.name;
      if (name) return truncate(name, limit);
    }
    return '';
  }

  function buildNodeSummaryEntries(tree, options = {}) {
    const map = tree && tree.map ? tree.map : null;
    if (!map) return [];
    const summaries = [];
    const maxNodes = Number.isInteger(options.maxNodes) ? options.maxNodes : MAX_NODES;
    for (const [id, node] of Object.entries(map)) {
      if (!node || typeof node !== 'object') continue;
      const highlightIndex = Number.isInteger(node.highlightIndex) ? node.highlightIndex : null;
      const hasOcr = typeof node.ocrText === 'string' && node.ocrText.trim().length;
      const isInteractive = Boolean(node.isInteractive || node.isTopElement || highlightIndex !== null);
      if (!isInteractive && !hasOcr) continue;
      const text = collectTextFromNode(id, map, new Set(), MAX_NODE_SUMMARY);
      const attributes = node.attributes || {};
      const attrPairs = [];
      for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined || value === null || value === '') continue;
        const printable = truncate(value, MAX_ATTR_LENGTH);
        attrPairs.push(`${key}="${printable}"`);
      }
      const attrSummary = attrPairs.length ? attrPairs.join(' ') : '';
      const summary = {
        id,
        highlightIndex,
        tag: node.tagName || node.type || 'node',
        xpath: node.xpath ? truncate(node.xpath, 200) : undefined,
        attr: attrSummary,
        text,
        isInteractive: Boolean(node.isInteractive),
        isVisible: node.isVisible !== false,
        inViewport: node.isInViewport !== false,
      };
      if (node.identityKey) summary.identityKey = node.identityKey;
      if (node.identityPreview) summary.identityPreview = truncate(node.identityPreview, MAX_NODE_SUMMARY);
      if (hasOcr) summary.ocrText = truncate(node.ocrText, 200);
      summaries.push(summary);
    }
    summaries.sort((a, b) => {
      const ai = a.highlightIndex === null || a.highlightIndex === undefined ? Number.POSITIVE_INFINITY : a.highlightIndex;
      const bi = b.highlightIndex === null || b.highlightIndex === undefined ? Number.POSITIVE_INFINITY : b.highlightIndex;
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
    return summaries.slice(0, maxNodes);
  }

  function formatSummaryForPrompt(entries) {
    if (!entries.length) return 'No interactive nodes detected.';
    return entries
      .map((entry) => {
        const parts = [];
        if (entry.highlightIndex !== null && entry.highlightIndex !== undefined) {
          parts.push(`#${entry.highlightIndex}`);
        }
        parts.push(`<${entry.tag}>`);
        if (entry.attr) parts.push(entry.attr);
        if (entry.text) parts.push(`text="${entry.text}"`);
        parts.push(entry.isVisible ? 'visible' : 'hidden');
        if (!entry.inViewport) parts.push('offViewport');
        if (entry.identityKey) {
          const preview = entry.identityPreview ? ` (${truncate(entry.identityPreview, 60)})` : '';
          parts.push(`identity=${entry.identityKey}${preview}`);
        }
        if (entry.ocrText) parts.push(`ocr="${truncate(entry.ocrText, 120)}"`);
        if (entry.xpath) parts.push(`xpath=${entry.xpath}`);
        return parts.join(' | ');
      })
      .join('\n');
  }

  function formatHistoryForPrompt(history) {
    if (!Array.isArray(history) || history.length === 0) return 'None.';
    const recent = history.slice(-MAX_HISTORY_ITEMS);
    return recent
      .map((item, idx) => {
        const step = item?.step || item?.action || {};
        const result = item?.result || item || {};
        const type = (step.type || '').toLowerCase();
        const hi = step.locator && Number.isInteger(step.locator.highlightIndex)
          ? `#${step.locator.highlightIndex}`
          : '';
        const value = step.text || step.url || step.option || step.ms || '';
        const status = result.status || (result.ok === false ? 'fail' : 'ok');
        const code = result.code ? ` (${result.code})` : '';
        const err = result.error ? ` error="${truncate(result.error, 80)}"` : '';
        return `${idx + 1}. ${type || 'unknown'} ${hi} ${value ? `value="${truncate(value, 60)}" ` : ''}-> ${status}${code}${err}`;
      })
      .join('\n');
  }

  function formatConversationForPrompt(conversation) {
    if (!Array.isArray(conversation) || conversation.length === 0) return 'None.';
    const recent = conversation.slice(-MAX_CHAT_ITEMS);
    const lines = [];
    for (const entry of recent) {
      if (!entry || typeof entry.text !== 'string') continue;
      const role = entry.role === 'agent' ? 'Agent' : entry.role === 'system' ? 'System' : 'Operator';
      lines.push(`${role}: ${truncate(entry.text, 180)}`);
    }
    return lines.length ? lines.join('\n') : 'None.';
  }

  function formatIdentityContext(identity = {}, preview = {}) {
    const entries = Object.entries(identity || {}).filter(([, value]) => typeof value === 'string' && value.trim());
    if (!entries.length) return 'None.';
    return entries
      .slice(0, 24)
      .map(([key, value]) => {
        const shown = preview && typeof preview[key] === 'string' && preview[key].trim()
          ? preview[key]
          : value;
        return `- ${key}: ${truncate(shown, 160)}`;
      })
      .join('\n');
  }

  function formatMediaHints(entries) {
    const hints = [];
    for (const entry of entries || []) {
      if (!entry || !entry.ocrText) continue;
      const label = entry.highlightIndex !== null && entry.highlightIndex !== undefined
        ? `#${entry.highlightIndex}`
        : `<${entry.tag}>`;
      hints.push(`${label}: ${truncate(entry.ocrText, 160)}`);
    }
    return hints.length ? hints.join('\n') : 'None.';
  }

  function formatPageContext(page = {}) {
    const lines = [];
    if (page.url) lines.push(`- URL: ${page.url}`);
    if (page.title) lines.push(`- Title: ${page.title}`);
    if (page.language) lines.push(`- Language: ${page.language}`);
    return lines.length ? lines.join('\n') : 'None.';
  }

  function applyTemplate(template, mapping) {
    let output = String(template ?? '');
    for (const [key, value] of Object.entries(mapping || {})) {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      output = output.replace(pattern, () => String(value ?? ''));
    }
    return output;
  }

  function buildPlannerPrompt({ domSummaryText, historyText, goal, instructions, template, identityText, mediaText, pageText, chatText }) {
    const allowedActions = Array.from(ALLOWED_ACTION_TYPES)
      .map((type) => `- ${type}`)
      .join('\n');
    const goalSection = goal ? `Goal: ${goal}` : 'Goal: Complete the survey accurately.';
    const extra = instructions ? `\nAdditional operator note: ${instructions}` : '';
    const source = template && String(template).trim().length ? template : DEFAULT_PROMPT_TEMPLATE;

    let promptText = applyTemplate(source, {
      GOAL_SECTION: goalSection,
      ALLOWED_ACTIONS: allowedActions,
      FORMAT_GUIDE: DEFAULT_FORMAT_GUIDE,
      RULES: DEFAULT_RULES_TEXT,
      DOM_SUMMARY: domSummaryText,
      HISTORY: historyText,
      CHAT_HISTORY: chatText && chatText.trim() ? chatText : 'None.',
      IDENTITY: identityText && identityText.trim() ? identityText : 'None.',
      MEDIA_HINTS: mediaText && mediaText.trim() ? mediaText : 'None.',
      PAGE_CONTEXT: pageText && pageText.trim() ? pageText : 'None.',
      EXTRA_INSTRUCTIONS: extra,
    });

    if (!source.includes('{{CHAT_HISTORY}}') && chatText && chatText.trim() && chatText.trim() !== 'None.') {
      promptText = `${promptText}\n\nOperator chat history:\n${chatText}`;
    }
    if (!source.includes('{{IDENTITY}}') && identityText && identityText.trim()) {
      promptText = `${promptText}\n\nIdentity profile:\n${identityText}`;
    }
    if (!source.includes('{{MEDIA_HINTS}}') && mediaText && mediaText.trim() && mediaText.trim() !== 'None.') {
      promptText = `${promptText}\n\nImage/OCR hints:\n${mediaText}`;
    }
    if (!source.includes('{{PAGE_CONTEXT}}') && pageText && pageText.trim()) {
      promptText = `${promptText}\n\nPage context:\n${pageText}`;
    }

    if (typeof globalThis.STRICT_JSON === 'string' && globalThis.STRICT_JSON.trim()) {
      promptText = `${promptText}\n\n${globalThis.STRICT_JSON}`;
    }

    return promptText;
  }

  function normalizeLocator(locator = {}) {
    if (!locator || typeof locator !== 'object') return {};
    const out = {};
    if (Number.isInteger(locator.highlightIndex)) out.highlightIndex = locator.highlightIndex;
    if (locator.nodeId) out.nodeId = String(locator.nodeId);
    if (locator.xpath) out.xpath = String(locator.xpath).slice(0, 400);
    if (locator.cssSelector) out.cssSelector = String(locator.cssSelector).slice(0, 400);
    if (Array.isArray(locator.frameChain)) {
      out.frameChain = locator.frameChain
        .map((frame) => ({
          xpath: frame && frame.xpath ? String(frame.xpath).slice(0, 400) : undefined,
          index: Number.isInteger(frame?.index) ? frame.index : undefined,
        }))
        .filter((frame) => frame.xpath || Number.isInteger(frame.index));
    }
    return out;
  }

  function normalizeStep(rawStep = {}) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    const type = typeof rawStep.type === 'string' ? rawStep.type.toLowerCase() : '';
    if (!ALLOWED_ACTION_TYPES.has(type)) return null;
    const normalized = { type };
    if (rawStep.intent) normalized.intent = String(rawStep.intent).slice(0, 160);
    const locator = normalizeLocator(rawStep.locator);
    if (Object.keys(locator).length) normalized.locator = locator;
    if (type === 'type' || rawStep.text) {
      if (rawStep.text === undefined) return null;
      normalized.text = String(rawStep.text);
    }
    if (type === 'select' && rawStep.text !== undefined) {
      normalized.text = String(rawStep.text);
    }
    if (type === 'scroll') {
      if (rawStep.mode) normalized.mode = String(rawStep.mode);
      if (rawStep.percent !== undefined) normalized.percent = Number(rawStep.percent);
      if (rawStep.behavior) normalized.behavior = String(rawStep.behavior);
      if (rawStep.offset !== undefined) normalized.offset = Number(rawStep.offset);
    }
    if (type === 'navigate' && rawStep.url) {
      normalized.url = String(rawStep.url);
    }
    if (type === 'wait') {
      const ms = Number(rawStep.ms ?? rawStep.duration ?? 0);
      if (!Number.isFinite(ms) || ms < 0) return null;
      normalized.ms = ms;
    }
    return normalized;
  }

  async function planNext(params = {}) {
    const { domTree, history = [], goal, instructions, options = {}, context = {}, conversation = [] } = params;
    if (!domTree) {
      const err = new Error('MISSING_DOM_TREE');
      err.code = 'MISSING_DOM_TREE';
      throw err;
    }
    if (typeof globalThis.callCerebras !== 'function') {
      const err = new Error('LLM_UNAVAILABLE');
      err.code = 'LLM_UNAVAILABLE';
      throw err;
    }

    const summaries = buildNodeSummaryEntries(domTree, options);
    const domSummaryText = formatSummaryForPrompt(summaries);
    const historyText = formatHistoryForPrompt(history);
    const chatText = formatConversationForPrompt(conversation);

    let customTemplate = null;
    try {
      const stored = await chrome.storage.local.get('surveyPlannerPromptTemplate');
      const tpl = stored?.surveyPlannerPromptTemplate;
      if (typeof tpl === 'string' && tpl.trim().length) {
        customTemplate = tpl;
      }
    } catch (err) {
      console.warn('Survey planner: failed to load custom prompt template', err);
    }

    const identityText = formatIdentityContext(context.identity || {}, context.identityPreview || {});
    const mediaText = formatMediaHints(summaries);
    const pageText = formatPageContext(context.page || {});

    const prompt = buildPlannerPrompt({
      domSummaryText,
      historyText,
      goal,
      instructions,
      template: customTemplate,
      identityText,
      mediaText,
      pageText,
      chatText,
    });

    let raw;
    try {
      raw = await globalThis.callCerebras(prompt);
    } catch (err) {
      err.code = err.code || 'LLM_CALL_FAILED';
      throw err;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('INVALID_JSON_RESPONSE');
      err.code = 'INVALID_JSON_RESPONSE';
      err.details = { raw };
      throw err;
    }

    const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : 'continue';
    const explanation = parsed.explanation ? String(parsed.explanation) : '';
    const confidence = Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : null;
    const normalizedStep = normalizeStep(parsed.step || parsed.action || {});

    if (status === 'continue' && !normalizedStep) {
      const err = new Error('PLANNER_STEP_REQUIRED');
      err.code = 'PLANNER_STEP_REQUIRED';
      err.details = { raw, parsed };
      throw err;
    }

    return {
      ok: true,
      status,
      step: normalizedStep || null,
      explanation,
      confidence,
      raw,
      meta: {
        nodesConsidered: summaries.length,
        historyCount: Array.isArray(history) ? history.length : 0,
      },
    };
  }

  globalThis.surveyAgentPlanner = {
    summarizeDomTree: buildNodeSummaryEntries,
    planNext,
  };
})(self);
