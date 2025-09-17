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
    'status',
    'ip_info',
    'ip_check',
    'custom_open',
    'note_save',
    'open_tab',
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
    '- You may navigate to other URLs or tabs when the instructions require visiting different pages.',
    '- Use "status" actions to update the status bar (msg/tone) instead of adding chat entries.',
    '- Use "ip_info" to open the IP information panel and "ip_check" to run qualification when needed.',
    '- Use "custom_open" to launch custom web helpers (siteKey or url) and summarise results.',
    '- Use "note_save" with {title, content} to archive important outputs in notes.',
    '- Use "open_tab" to spawn helper tabs without blocking the current page.',
    '- Propose exactly ONE next action (chunked planning).',
    '- Keep operator-facing explanations and follow-up questions in Arabic, concise and friendly.',
    '- Ask for clarification only when necessary, using a single direct Arabic question.',
    '- Never copy the operator\'s raw chat message into any form field or action text.'
  ].join('\n');

  const DEFAULT_FORMAT_GUIDE = '{\n'
    + '  "status": "continue" | "done" | "abort",\n'
    + '  "explanation": "Short natural language reasoning",\n'
    + '  "step": {\n'
    + '    "type": "click" | "type" | "select" | "scroll" | "navigate" | "back" | "forward" | "reload" | "wait" | "status" | "ip_info" | "ip_check" | "custom_open" | "note_save" | "open_tab",\n'
    + '    "locator": { "highlightIndex": number?, "xpath": string?, "cssSelector": string? },\n'
    + '    "text": string?,\n'
    + '    "url": string?,\n'
    + '    "ms": number?,\n'
    + '    "intent": string?,\n'
    + '    "message": string?,\n'
    + '    "tone": string?,\n'
    + '    "siteKey": string?,\n'
    + '    "title": string?,\n'
    + '    "content": string?,\n'
    + '    "active": boolean?\n'
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
    'Respond with the JSON schema shown above.{{EXTRA_INSTRUCTIONS}}',
    '',
    'Wrap your final reply like this:',
    '{',
    '  "thought": "...",',
    '  "needsOCR": [ { "reason": "...", "rect": [x,y,w,h] | null } ],',
    '  "actions": [ { "cmd":"dom.scan","id":"S1" }, { "cmd":"click","args":{"css":"button.next"},"id":"S2" } ],',
    '  "finishWhen": "Plain-EN condition e.g. DOM contains text \'Thank you\'",',
    '  "user_followup": false',
    '}',
    'ZEPRA_PLAN```'
  ].join('\n');

  globalThis.SURVEY_AGENT_DEFAULT_PROMPT_TEMPLATE = DEFAULT_PROMPT_TEMPLATE;

  function safeJsonParse(text) {
    if (!text) return null;
    const rawText = typeof text === 'string' ? text : JSON.stringify(text);
    const cleaned = stripPlanWrappers(rawText);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        const candidate = cleaned.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch (nestedErr) {
          return null;
        }
      }
      return null;
    }
  }

  function stripPlanWrappers(text) {
    if (!text) return '';
    let output = String(text);
    if (output.includes('ZEPRA_PLAN')) {
      output = output.split('ZEPRA_PLAN')[0];
    }
    output = output.replace(/```json/gi, '');
    output = output.replace(/```/g, '');
    return output.trim();
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
      if (node.isRequired) summary.required = true;
      const currentValue = typeof node.currentValue === 'string' ? node.currentValue.trim() : '';
      const selectedTexts = Array.isArray(node.selectedTexts) ? node.selectedTexts.filter(Boolean) : [];
      const selectedValues = Array.isArray(node.selectedValues) ? node.selectedValues.filter(Boolean) : [];
      const hasSelection = selectedTexts.length || selectedValues.length;
      if (currentValue) summary.value = truncate(currentValue, MAX_ATTR_LENGTH);
      if (hasSelection) {
        const combined = selectedTexts.length ? selectedTexts.join(', ') : selectedValues.join(', ');
        summary.selected = truncate(combined, MAX_ATTR_LENGTH * 2);
      }
      if (typeof node.isChecked === 'boolean') summary.checked = node.isChecked;
      if (node.isMultiple) summary.multiple = true;
      const isFormField =
        (node.tagName && ['input', 'textarea', 'select'].includes(String(node.tagName).toLowerCase())) ||
        currentValue !== '' ||
        hasSelection ||
        typeof node.isChecked === 'boolean';
      if (isFormField) {
        const hasValue =
          Boolean(summary.value && summary.value.trim()) ||
          Boolean(summary.selected && summary.selected.trim()) ||
          summary.checked === true;
        summary.filled = hasValue;
      }
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
        if (entry.required) parts.push('required');
        if (entry.text) parts.push(`text="${entry.text}"`);
        if (entry.value) parts.push(`value="${entry.value}"`);
        if (entry.selected) parts.push(`selected="${truncate(entry.selected, 160)}"`);
        if (entry.checked === true) parts.push('checked');
        if (entry.checked === false && entry.tag && entry.tag.toLowerCase() === 'input') parts.push('unchecked');
        if (entry.filled === false) parts.push('empty');
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
    if (page.formProgress) lines.push(`- Form progress: ${page.formProgress}`);
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

  function buildPlannerPrompt({
    domSummaryText,
    historyText,
    goal,
    instructions,
    template,
    identityText,
    mediaText,
    pageText,
    chatText,
    preferences,
  }) {
    const allowedActions = Array.from(ALLOWED_ACTION_TYPES)
      .map((type) => `- ${type}`)
      .join('\n');
    const goalSection = goal ? `Goal: ${goal}` : 'Goal: Complete the requested task carefully.';
    const extraParts = [];
    if (instructions) {
      extraParts.push(`Additional operator note: ${instructions}`);
    }
    if (preferences) {
      if (preferences.useIdentityAnswers === true) {
        extraParts.push('Identity autofill is enabled: prefer the provided profile data for matching fields and avoid inventing conflicting answers.');
      } else if (preferences.useIdentityAnswers === false) {
        extraParts.push('Identity autofill is disabled: craft suitable values yourself instead of relying on identity placeholders.');
      }
      if (preferences.deliberateMode) {
        extraParts.push('Work methodically: avoid repeating the same action without change, ensure every required field is filled exactly once, and insert wait or scroll actions when the page needs time to update.');
      }
    }
    const extra = extraParts.length ? `\n${extraParts.join('\n')}` : '';
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
      if (rawStep.typingSpeed) normalized.typingSpeed = String(rawStep.typingSpeed);
      if (rawStep.replace !== undefined) normalized.replace = rawStep.replace !== false;
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
    if (type === 'status') {
      const message = rawStep.message ?? rawStep.text;
      if (!message) return null;
      normalized.message = String(message);
      if (rawStep.tone) normalized.tone = String(rawStep.tone);
      if (rawStep.persist !== undefined) normalized.persist = rawStep.persist === true;
    }
    if (type === 'ip_info' || type === 'ip_check') {
      if (rawStep.mode) normalized.mode = String(rawStep.mode);
    }
    if (type === 'custom_open') {
      if (rawStep.siteKey) normalized.siteKey = String(rawStep.siteKey);
      if (rawStep.url) normalized.url = String(rawStep.url);
      if (!normalized.siteKey && !normalized.url) return null;
    }
    if (type === 'note_save') {
      const content = rawStep.content ?? rawStep.text ?? rawStep.value;
      if (!content) return null;
      normalized.content = String(content);
      if (rawStep.title || rawStep.name || rawStep.label) {
        normalized.title = String(rawStep.title || rawStep.name || rawStep.label);
      }
    }
    if (type === 'open_tab') {
      if (!rawStep.url) return null;
      normalized.url = String(rawStep.url);
      if (rawStep.active !== undefined) normalized.active = rawStep.active !== false;
    }
    return normalized;
  }

  function buildLocatorFromCommandArgs(args = {}) {
    const locator = {};
    if (Number.isInteger(args.highlightIndex)) locator.highlightIndex = args.highlightIndex;
    const css = args.css || args.selector || args.sel;
    if (typeof css === 'string' && css.trim()) locator.cssSelector = css.trim();
    const xpath = args.xpath || args.path;
    if (typeof xpath === 'string' && xpath.trim()) locator.xpath = xpath.trim();
    const nodeId = args.nodeId || args.id;
    if (typeof nodeId === 'string' && nodeId.trim()) locator.nodeId = nodeId.trim();
    if (Array.isArray(args.frameChain)) {
      locator.frameChain = args.frameChain
        .map((frame) => ({
          xpath: frame && frame.xpath ? String(frame.xpath).slice(0, 400) : undefined,
          index: Number.isInteger(frame?.index) ? frame.index : undefined,
        }))
        .filter((frame) => frame.xpath || Number.isInteger(frame.index));
    }
    return locator;
  }

  function mapCommandToStep(action = {}) {
    if (!action || typeof action !== 'object') return null;
    const cmd = typeof action.cmd === 'string' ? action.cmd.toLowerCase() : '';
    if (!cmd) return null;
    const args = action.args || {};
    switch (cmd) {
      case 'click': {
        const locator = buildLocatorFromCommandArgs(args);
        return normalizeStep({ type: 'click', locator, intent: action.intent });
      }
      case 'type': {
        const locator = buildLocatorFromCommandArgs(args);
        const text = args.text ?? args.value;
        if (text === undefined) return null;
        return normalizeStep({
          type: 'type',
          locator,
          text,
          intent: action.intent,
          typingSpeed: args.mode,
          replace: args.replace,
        });
      }
      case 'set': {
        const locator = buildLocatorFromCommandArgs(args);
        const text = args.text ?? args.value;
        if (text === undefined) return null;
        return normalizeStep({
          type: 'type',
          locator,
          text,
          intent: action.intent,
          replace: true,
        });
      }
      case 'select': {
        const locator = buildLocatorFromCommandArgs(args);
        const text = args.text ?? args.value;
        if (text === undefined) return null;
        return normalizeStep({ type: 'select', locator, text, intent: action.intent });
      }
      case 'scroll': {
        const locator = buildLocatorFromCommandArgs(args);
        const offset = Number.isFinite(args.y) ? Number(args.y) : Number(args.offset);
        const percent = Number.isFinite(args.percent) ? Number(args.percent) : undefined;
        const mode = args.mode || (Object.keys(locator).length ? 'element' : args.target === 'page' ? 'page' : undefined);
        return normalizeStep({
          type: 'scroll',
          locator: Object.keys(locator).length ? locator : undefined,
          offset,
          percent,
          behavior: args.behavior,
          mode,
          intent: action.intent,
        });
      }
      case 'status': {
        const message = args.msg ?? args.message ?? args.text;
        if (!message) return null;
        return normalizeStep({
          type: 'status',
          message,
          tone: args.tone || args.level,
          persist: args.persist,
          intent: action.intent,
        });
      }
      case 'ip.check':
      case 'ip_check': {
        return normalizeStep({
          type: 'ip_check',
          mode: args.mode || args.target,
          intent: action.intent,
        });
      }
      case 'ip.info':
      case 'ip_info': {
        return normalizeStep({
          type: 'ip_info',
          mode: args.mode || args.section,
          intent: action.intent,
        });
      }
      case 'custom.open':
      case 'custom_open': {
        return normalizeStep({
          type: 'custom_open',
          siteKey: args.siteKey || args.key || args.slot,
          url: args.url,
          intent: action.intent,
        });
      }
      case 'note.save':
      case 'note_save': {
        return normalizeStep({
          type: 'note_save',
          title: args.title || args.name || args.label,
          content: args.content ?? args.text ?? args.value,
          intent: action.intent,
        });
      }
      case 'open.tab':
      case 'open_tab': {
        return normalizeStep({
          type: 'open_tab',
          url: args.url,
          active: args.active !== false,
          intent: action.intent,
        });
      }
      case 'wait': {
        const ms = Number.isFinite(args.ms) ? Number(args.ms) : Number(args.duration);
        return normalizeStep({ type: 'wait', ms: Number.isFinite(ms) ? ms : 0, intent: action.intent });
      }
      default:
        return null;
    }
  }

  function translateZepraPlanEnvelope(envelope = {}) {
    if (!envelope || typeof envelope !== 'object') return null;
    const result = {
      status: 'continue',
      explanationParts: [],
      needsOCR: Array.isArray(envelope.needsOCR) ? envelope.needsOCR : [],
      finishWhen: envelope.finishWhen,
      userFollowup: envelope.user_followup === true,
      actionsPlanned: Array.isArray(envelope.actions) ? envelope.actions.length : 0,
      rawEnvelope: envelope,
      steps: [],
    };
    if (envelope.thought) {
      const thought = String(envelope.thought).trim();
      if (thought) result.explanationParts.push(thought);
    }

    const actions = Array.isArray(envelope.actions) ? envelope.actions : [];
    for (const action of actions) {
      const cmd = typeof action?.cmd === 'string' ? action.cmd.toLowerCase() : '';
      if (!cmd) continue;
      if (cmd === 'dom.scan') {
        result.steps.push({
          kind: 'dom_scan',
          id: action?.id || null,
          args: action?.args || {},
        });
        continue;
      }
      if (cmd === 'done') {
        result.status = 'done';
        const message = action?.args?.summary || action?.args?.message || '';
        if (message) result.explanationParts.push(String(message));
        result.steps.push({
          kind: 'done',
          id: action?.id || null,
          args: action?.args || {},
        });
        result.step = null;
        break;
      }
      if (cmd === 'status') {
        const message = action?.args?.msg || action?.args?.message || action?.args?.text;
        if (message) {
          const tone = action?.args?.tone || action?.args?.level;
          const persist = action?.args?.persist === true;
          if (!Array.isArray(result.statusUpdates)) result.statusUpdates = [];
          result.statusUpdates.push({
            message: String(message),
            tone: tone ? String(tone) : undefined,
            persist,
          });
          result.explanationParts.push(String(message));
        }
        continue;
      }
      if (cmd === 'ocr.capture') {
        const rect = Array.isArray(action?.args?.rect) ? action.args.rect : null;
        if (!result.needsOCR.length) {
          result.needsOCR = [{ reason: action?.args?.reason || 'planner-request', rect }];
        }
        result.steps.push({
          kind: 'ocr_capture',
          id: action?.id || null,
          args: action?.args || {},
          rect,
          reason: action?.args?.reason || action?.args?.label || null,
        });
        continue;
      }
      const step = mapCommandToStep(action);
      if (step) {
        if (!result.step) {
          result.step = step;
        }
        result.steps.push({
          kind: 'action',
          id: action?.id || null,
          step,
          raw: action,
        });
        continue;
      }
    }

    if (!result.step && result.status === 'continue' && result.userFollowup) {
      result.status = 'abort';
      if (!result.explanationParts.length) {
        result.explanationParts.push('بحاجة إلى توضيح إضافي.');
      }
    }

    result.explanation = result.explanationParts.join(' ').trim();
    return result;
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
      preferences: options.preferences || {},
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

    let payload = parsed;
    let translated = null;
    if (Array.isArray(parsed.actions) || parsed.user_followup !== undefined || parsed.thought !== undefined) {
      translated = translateZepraPlanEnvelope(parsed);
      if (!translated) {
        const err = new Error('INVALID_PLAN_ENVELOPE');
        err.code = 'INVALID_PLAN_ENVELOPE';
        err.details = { raw, parsed };
        throw err;
      }
      payload = {
        status: translated.status,
        explanation: translated.explanation,
        confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : null,
        step: translated.step || null,
      };
    }

    const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : 'continue';
    const explanation = payload.explanation ? String(payload.explanation) : '';
    const confidence = Number.isFinite(payload.confidence) ? Number(payload.confidence) : null;
    const normalizedStep = translated ? (translated.step || null) : normalizeStep(payload.step || payload.action || {});

    if (status === 'continue' && !normalizedStep) {
      const err = new Error('PLANNER_STEP_REQUIRED');
      err.code = 'PLANNER_STEP_REQUIRED';
      err.details = { raw, parsed };
      throw err;
    }

    const stepList = Array.isArray(translated?.steps)
      ? translated.steps
      : normalizedStep
      ? [
          {
            kind: 'action',
            id: null,
            step: normalizedStep,
          },
        ]
      : [];

    const meta = {
      nodesConsidered: summaries.length,
      historyCount: Array.isArray(history) ? history.length : 0,
    };
    if (translated) {
      if (Array.isArray(translated.needsOCR) && translated.needsOCR.length) {
        meta.needsOCR = translated.needsOCR;
      }
      if (translated.finishWhen) meta.finishWhen = translated.finishWhen;
      if (translated.userFollowup === true) meta.userFollowup = true;
      if (Number.isFinite(translated.actionsPlanned)) meta.actionsPlanned = translated.actionsPlanned;
      if (Array.isArray(translated.statusUpdates) && translated.statusUpdates.length) {
        meta.statusUpdates = translated.statusUpdates;
      }
      meta.planEnvelope = translated.rawEnvelope;
      if (Array.isArray(translated.steps)) {
        meta.planSteps = translated.steps;
      }
    }

    return {
      ok: true,
      status,
      step: normalizedStep || null,
      steps: stepList,
      explanation,
      confidence,
      raw,
      meta,
    };
  }

  globalThis.surveyAgentPlanner = {
    summarizeDomTree: buildNodeSummaryEntries,
    planNext,
  };
})(self);
