// Pure local text analysis shared by prompt hooks and MCP routing. No I/O or logging.
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizedText(value) {
  return typeof value === "string" ? value.normalize("NFKC") : "";
}

export function sensitiveSignals(text) {
  return [...new Set(collectMatches(normalizedText(text)).map(({ type }) => type))];
}

// The local main-session model assesses meaning and provenance. Pattern matches
// are review candidates, never proof of sensitivity; absence is not clearance.
export function assessRouting(args = {}) {
  const text = [args.prompt, args.context].filter((value) => typeof value === "string").join("\n");
  const complexity = ["simple", "complex"].includes(args.complexity) ? args.complexity : "unknown";
  const sensitivity = ["high", "medium", "low"].includes(args.sensitivity) ? args.sensitivity : "unknown";
  const scope = ["public", "private", "mixed", "none", "unknown"].includes(args.data_scope) ? args.data_scope : "unknown";
  const reasonPresent = typeof args.assessment_reason === "string" && Boolean(args.assessment_reason.trim()) && args.assessment_reason.length <= 2000;
  const missing = [];
  if (complexity === "unknown") missing.push("complexity");
  if (sensitivity === "unknown") missing.push("sensitivity");
  if (!["public", "private", "mixed", "none", "unknown"].includes(args.data_scope)) missing.push("data_scope");
  if (!reasonPresent) missing.push("assessment_reason");
  if (complexity === "complex" && sensitivity === "low" && scope === "unknown") missing.push("known_data_scope");
  return {
    route: args.content_pending === true ? "inspect_content"
      : missing.length ? "assessment_required"
      : complexity === "simple" ? "local"
      : sensitivity === "low" ? "cloud_exec" : "redaction_required",
    complexity: { level: complexity, source: complexity === "unknown" ? "unassessed" : "main_session" },
    sensitivity: { level: sensitivity, source: sensitivity === "unknown" ? "unassessed" : "main_session", candidate_signals: sensitiveSignals(text) },
    data_scope: scope,
    assessment_required: missing.length > 0,
    missing_assessment: missing,
    content_assessment: args.content_pending === true ? "pending" : "supplied_text_only",
  };
}

export function collectMatches(text, customPatterns = []) {
  const matches = [];
  const add = (type, start, end, value, priority = 1) => {
    if (!value || end <= start) return;
    if (/^【[^】]+】$/.test(value.trim())) return;
    matches.push({ type, start, end, value, priority });
  };
  const addGlobal = (type, regex, group = 0, priority = 1) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      if (match[0].length === 0) {
        // Advance zero-width global expressions so a custom rule cannot hang the server.
        regex.lastIndex += 1;
        continue;
      }
      const value = match[group];
      const offset = group === 0 ? match.index : match.index + match[0].indexOf(value);
      add(type, offset, offset + value.length, value, priority);
      if (!regex.global) break;
    }
  };

  // Scan field prefixes independently. Table separators delimit values, so a
  // masked value cannot swallow the next field or the rest of a flattened row.
  const addLabel = (type, names) => {
    const prefixes = [
      new RegExp(`(?:${names})[ \t]*[:：][ \t]*`, "g"),
      new RegExp(`(?:^|\\n)[ \t]*(?:${names})[ \t]+(?![:： \t])`, "g"),
    ];
    for (const prefix of prefixes) {
      let match;
      while ((match = prefix.exec(text))) {
        const start = prefix.lastIndex;
        const remaining = text.slice(start);
        const boundary = remaining.search(/[\n，,；;。|｜]|(?:^|[ \t])\/(?=[ \t]*(?:[\p{L}\p{N}_][\p{L}\p{N}_ \t]*[:：]|$))/u);
        const value = remaining.slice(0, boundary < 0 ? undefined : boundary).trimEnd();
        if (/[\p{L}\p{N}]/u.test(value)) add(type, start, start + value.length, value, 5);
      }
    }
  };
  addLabel("bank", "开户行|收款银行|银行");
  addLabel("address", "银行地址|开户地址|注册地址|地址");
  addLabel("principal", "甲方|乙方|公司名称|户名|单位名称");
  addGlobal("account", /(?<!\d)(?:\d[ -]?){13,19}(?!(?:[ -]?\d))/g, 0, 4);
  addGlobal("id_number", /\b\d{17}[0-9X]\b/gi, 0, 4);
  addGlobal("tax_id", /\b[0-9A-Z]{18}\b/g, 0, 4);
  addGlobal("phone", /(?<!\d)1[3-9]\d{9}(?!\d)/g, 0, 4);
  addGlobal("phone", /(?<!\d)0\d{2,3}[ -]?\d{7,8}(?!\d)/g, 0, 4);
  addGlobal("email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 0, 4);
  addGlobal("amount", /(?:人民币|RMB|￥|¥)\s*[\d,]+(?:\.\d+)?\s*(?:元)?|\b[\d,]+(?:\.\d+)?\s*元/g, 0, 2);

  for (const item of Array.isArray(customPatterns) ? customPatterns : []) {
    if (!isObject(item) || typeof item.name !== "string" || typeof item.pattern !== "string") continue;
    try {
      if (!item.pattern.trim()) continue;
      addGlobal(item.name.slice(0, 24), new RegExp(item.pattern, item.flags?.includes("g") ? item.flags : `${item.flags || ""}g`), 0, 2);
    } catch {
      // Invalid custom rules are ignored; the response reports valid changes only.
    }
  }

  const sorted = matches.sort((a, b) =>
    a.start - b.start || b.priority - a.priority || (b.end - b.start) - (a.end - a.start),
  );
  const selected = [];
  for (const candidate of sorted) {
    const prior = selected.at(-1);
    if (prior && candidate.start < prior.end) {
      // Keep the established label but cover the full protected union. Dropping a
      // partially overlapping match can leave its tail unprotected.
      prior.end = Math.max(prior.end, candidate.end);
      prior.value = text.slice(prior.start, prior.end);
    } else selected.push({ ...candidate });
  }
  return selected.sort((a, b) => a.start - b.start);
}

