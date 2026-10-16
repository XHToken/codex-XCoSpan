#!/usr/bin/env node

/**
 * Local, dependency-free MCP server for edge-cloud collaboration and redaction.
 * stdout is reserved for JSON-RPC; diagnostics go to stderr.
 */
import { englishMessages, responseLanguage } from "../ui/src/messages.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { collectMatches, normalizedText, assessRouting } from "./routing.mjs";
import { detectContent, loadConfig, DetectionError } from "./detection.mjs";
import { boundary } from "./detection-core.mjs";
import { analysisSubagentInstructions } from "./subagent-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_NAME = "codex-local-privacy-router";
const VERSION = "0.1.0";
const UI_URI = "ui://codex-local-privacy-router/contract-redaction-review.html";
const MAX_CONTENT_CHARS = 200_000;
const REVIEW_TTL_MS = 30 * 60 * 1000;
const reviews = new Map();
const modelSelections = new Map();
const SUBAGENT_MODEL_POLICY = {
  tool: "select_subagent_model",
  multiple_models: "wait_for_user_selection",
  cloud_large_models_only: true,
  explicit_spawn_model_required: true,
};

const TYPE_LABELS = {
  government_id: "ID",
  bank_card: "Account",
  principal: "Principal",
  bank: "Bank",
  address: "Address",
  account: "Account",
  tax_id: "TaxID",
  phone: "Phone",
  amount: "Amount",
  email: "Email",
  id_number: "ID",
};

const TYPE_ORDER = [
  "id_number",
  "tax_id",
  "account",
  "phone",
  "email",
  "amount",
  "bank",
  "address",
  "principal",
];

const MODEL_WARNING_MESSAGES = {
  en: "To continue with local processing and cloud analysis, I need to confirm where this chat’s model runs. The plugin cannot detect this automatically. Does it run on your own computer or server?",
  zh: "为了按本地处理和云端分析的流程继续，需要先确认当前对话的模型部署在哪里。插件无法自动检测：你现在使用的模型，是在你自己的电脑或服务器上运行的吗？",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelGuard(model, userConfirmedSmallModel = false, language = "en") {
  const confirmed = userConfirmedSmallModel === true;
  return {
    current_model: typeof model === "string" && model.trim() ? model : null,
    is_small_model: null, // Legacy field; capability cannot be inferred from a name.
    user_confirmed_small_model: confirmed,
    model_switch_required: false,
    model_confirmation_required: !confirmed,
    message: confirmed
      ? (/^zh(?:-|$)/i.test(language) ? "已确认当前对话使用本地部署的模型，可以继续处理。" : "Local model deployment confirmed. Continue with the task.")
      : MODEL_WARNING_MESSAGES[/^zh(?:-|$)/i.test(language) ? "zh" : "en"],
  };
}

function detectionCandidates(content, findings) {
  return findings.map((item) => ({ ...item, value: content.slice(item.start, item.end) }));
}
function requiredSpans(content, findings) {
  const spans = [];
  const seen = new Set();
  for (const item of findings.filter((item) => item.protection === "required")) {
    const value = content.slice(item.start, item.end);
    const key = `${item.type}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let at = content.indexOf(value); at >= 0; at = content.indexOf(value, at + value.length)) {
      if (spans.length >= 20000) throw new DetectionError("finding_limit");
      spans.push({ type: item.type, start: at, end: at + value.length,
        ...(value.includes("\n") ? { scope: "passage", reason: "Required protection of a detected multiline secret." } : {}) });
    }
  }
  return spans;
}
function selectionWithRequired(content, spans, findings) {
  return [...requiredSpans(content, findings), ...spans];
}
async function inspectContent(args) {
  if (args.audience !== "main") return errorPayload("Only the main session may inspect content.", "audience_denied");
  const result = await detectContent(args.content, { patterns: args.custom_patterns });
  return { ok: true, ...result, semantic_review_required: true,
    next_step: "Review these UTF-16 candidates locally using the task purpose and provenance. Required findings remain protected. Decide contextual candidates individually and add missed semantic facts. Pass the complete sensitive_spans to create_redaction_review; detection alone does not authorize cloud handoff." };
}

function redactText(text, customPatterns = [], sensitiveSpans, previousChanges = []) {
  // Semantic spans can cover confidential meaning in any language, including
  // material that has no recognizable account, phone or document label.
  const candidates = (sensitiveSpans === undefined
    ? collectMatches(text, customPatterns)
    : sensitiveSpans.map((span) => ({ ...span, semantic: true })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const matches = [];
  for (const candidate of candidates) {
    const previous = matches.at(-1);
    if (previous && candidate.start < previous.end) {
      previous.end = Math.max(previous.end, candidate.end);
      if (candidate.semantic && !previous.semantic) previous.type = candidate.type;
      previous.semantic ||= candidate.semantic;
      if (candidate.scope === "passage") { previous.scope = "passage"; previous.reason = candidate.reason; }
      previous.value = text.slice(previous.start, previous.end);
    } else matches.push({ ...candidate, value: text.slice(candidate.start, candidate.end) });
  }
  const counters = new Map();
  const stableTokens = new Map(previousChanges.map((change) => [`${change.type}\u0000${change.original}`, change.token]));
  const usedTokens = new Set([...previousChanges.map((change) => change.token), ...[...text.matchAll(/【[^】]*】/g)].map((match) => match[0])]);
  const tokenFor = (type, value) => {
    const key = `${type}\u0000${value}`;
    if (stableTokens.has(key)) return stableTokens.get(key);
    let count = counters.get(type) || 0;
    let token;
    do { token = `【${(Object.hasOwn(TYPE_LABELS, type) ? TYPE_LABELS[type] : type)}${++count}】`; } while (usedTokens.has(token));
    counters.set(type, count);
    usedTokens.add(token);
    stableTokens.set(key, token);
    return token;
  };
  const changes = matches.map((match) => ({
    type: match.type,
    token: tokenFor(match.type, match.value),
    original: match.value,
    start: match.start,
    end: match.end,
    scope: match.scope || "field",
    ...(match.reason ? { reason: match.reason } : {}),
  }));
  let sanitized = text;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    sanitized = `${sanitized.slice(0, change.start)}${change.token}${sanitized.slice(change.end)}`;
  }
  let delta = 0;
  for (const change of changes) {
    change.sanitized_start = change.start + delta;
    change.sanitized_end = change.sanitized_start + change.token.length;
    delta += change.token.length - (change.end - change.start);
  }
  return { sanitized, changes };
}

function publicChanges(changes) {
  return changes.map(({ type, token, original, start, end, sanitized_start, sanitized_end }) => ({
    type,
    token,
    original,
    replacement: token,
    start,
    end,
    sanitized_start,
    sanitized_end,
  }));
}

function safeChanges(changes) {
  return changes.map(({ type, token, start, end, sanitized_start, sanitized_end }) => ({ type, token, start, end, sanitized_start, sanitized_end }));
}

function changeSummary(changes) {
  const counts = new Map();
  for (const { type } of changes) counts.set(type, (counts.get(type) || 0) + 1);
  return {
    total: changes.length,
    categories: [...counts].map(([type, count]) => ({ type, label: (Object.hasOwn(TYPE_LABELS, type) ? TYPE_LABELS[type] : type), count })),
  };
}

const candidateKey = (match) => `${match.type}\u0000${normalizedText(match.value)}`;
const markers = (text) => [...text.matchAll(/【[^】]*】/g)];
function maskedView(text, review) {
  const known = new Set(review.sourceChanges.map((change) => change.token));
  return text.replace(/【[^】]*】/g, (token) => known.has(token) ? " ".repeat(token.length) : token);
}
function unapprovedMatches(text, review) {
  const masked = maskedView(text, review);
  return [...collectMatches(masked), ...collectMatches(normalizedText(masked))]
    .filter((match) => !review.allowedCandidates.has(candidateKey(match)));
}
function containsOriginal(review, text) {
  const normalized = normalizedText(maskedView(text, review));
  return review.sourceChanges.some((change) => normalized.includes(normalizedText(change.original)));
}
function validationFailure(code, stage, issues) {
  return { ...errorPayload("Local validation failed. Inspect the reported positions and categories; preserve unrelated text and revise structured redaction spans instead of summarizing or deleting clauses.", code), validation: { stage, status: "failed", issues } };
}
function textIssues(review, text, checkMarkers = true) {
  const issues = [];
  const masked = maskedView(text, review);
  for (const change of review.sourceChanges) {
    const start = masked.indexOf(change.original);
    if (start >= 0 || normalizedText(masked).includes(normalizedText(change.original))) {
      issues.push({ kind: "original_value", type: change.type, start: Math.max(0, start), end: start >= 0 ? start + change.original.length : text.length });
    }
  }
  for (const match of unapprovedMatches(text, review)) issues.push({ kind: "pattern_candidate", type: match.type, start: match.start, end: Math.min(text.length, match.end) });
  if (checkMarkers) {
    const known = new Set([...review.sourceChanges.map((change) => change.token), ...markers(review.original).map((match) => match[0])]);
    for (const match of markers(text)) if (!known.has(match[0])) issues.push({ kind: "unregistered_placeholder", type: "placeholder", start: match.index, end: match.index + match[0].length });
  }
  return [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()];
}
function validateBody(review, text = review.sanitized, stage = "preview") {
  if (review.detection && hash(JSON.stringify(loadConfig())) !== review.detection.policy_hash) {
    review.token = null;
    review.status = "awaiting_confirmation";
    return errorPayload("Detection policy changed. Recreate the review and confirm the new version.", "detection_policy_changed");
  }
  const issues = textIssues(review, text);
  if (issues.length) return validationFailure(issues.every((issue) => issue.kind === "unregistered_placeholder") ? "unregistered_placeholder" : "sensitive_value_detected", stage, issues);
  return null;
}
function validateSpanScopes(content, spans, stage) {
  const broad = spans.filter((span) => content.slice(span.start, span.end).split(/\r?\n/).filter((line) => line.trim()).length > 1
    && (span.scope !== "passage" || !span.reason?.trim()));
  return broad.length ? validationFailure("span_scope_required", stage, broad.map((span) => ({ kind: "multi_block_selection", type: span.type, start: span.start, end: span.end }))) : null;
}
function validateSpans(content, spans, stage) {
  if (!Array.isArray(spans) || spans.some((span) => !isObject(span)
      || !Number.isInteger(span.start) || !Number.isInteger(span.end)
      || !boundary(content, span.start) || !boundary(content, span.end) || span.end <= span.start || !content.slice(span.start, span.end).trim()
      || typeof span.type !== "string" || !/^[a-z][a-z0-9_]{0,63}$/i.test(span.type)
      || (span.scope !== undefined && !["field", "passage"].includes(span.scope))
      || (span.reason !== undefined && (typeof span.reason !== "string" || span.reason.length > 2000)))) {
    return validationFailure("invalid_sensitive_spans", stage, [{ kind: "invalid_span", type: "selection" }]);
  }
  return validateSpanScopes(content, spans, stage);
}

function reviewMetrics(review) {
  const redacted = review.sourceChanges.reduce((sum, change) => sum + change.end - change.start, 0);
  const passages = review.sourceChanges.filter((change) => review.original.slice(change.start, change.end).split(/\r?\n/).filter((line) => line.trim()).length > 1).length;
  return { original_chars: review.original.length, redacted_chars: redacted, retained_chars: review.original.length - redacted, passage_selections: passages };
}
function versionFields(review) {
  return { sanitized_sha256: review.hash, detection: review.detection ? { status: "completed", policy_version: review.detection.policy_version, detectors: review.detection.detectors, semantic_guarantee: false } : undefined, validation: { status: "passed", scope: "local_rules", semantic_guarantee: false }, content_retention: reviewMetrics(review) };
}
// Guidance for existing review states; the host model still controls its turn
// and subagent tools. These messages do not enforce host execution.
function reviewNextStep(review) {
  switch (review.status) {
    case "awaiting_confirmation":
      return "The preview is ready. Briefly ask the user to review and confirm it, then end this turn and wait. Do not continue substantive research, analysis or a final answer while awaiting confirmation. Local inspection needed to correct redaction remains permitted.";
    case "confirmed":
      return "Redaction is confirmed. Resolve cloud model selection for this task, reusing a valid explicit choice for the same task. Call handoff_to_subagent with the current token and sanitized hash, then immediately create the host subagent using the returned spawn_parameters and only subagent_payload as its message. Wait for its result before preparing the final response; do not perform the substantive analysis yourself.";
    case "handed_off":
      return "Only a handoff package has been generated; this status does not prove a subagent started or finished. If not yet created, use the successful handoff response's spawn_parameters and subagent_payload to create it now. Otherwise wait for or read that subagent's result, then check and present its findings. Do not consume the token again or duplicate the analysis locally. If creation fails, report the limitation; do not silently switch to local analysis.";
    default:
      return "Authorization was rejected or revoked. Stop this handoff. Do not create a subagent or silently continue the analysis locally. Follow a new explicit user request if the task changes.";
  }
}
function updateEditedSanitized(review, edited) {
  if (edited.length > MAX_CONTENT_CHARS) return errorPayload("edited_sanitized is too large.", "content_too_large");
  const error = validateBody(review, edited, "edit");
  if (error) return error;
  if (edited !== review.sanitized) return validationFailure("structured_redaction_required", "edit", [{ kind: "non_redaction_edit", type: "content", start: 0, end: edited.length }]);
  return null;
}
function originalOffset(review, offset, side) {
  let delta = 0;
  for (const change of review.sourceChanges) {
    if (offset <= change.sanitized_start) return offset + delta;
    if (offset < change.sanitized_end) return side === "start" ? change.start : change.end;
    delta += (change.end - change.start) - change.token.length;
  }
  return offset + delta;
}
function reviseReview(review, args) {
  const modes = ["sensitive_spans", "redactions", "edited_sanitized"].filter((key) => args[key] !== undefined);
  if (modes.length > 1) return errorPayload("Use one structured redaction operation at a time.", "invalid_request");
  if (!modes.length) return null;
  if (args.expected_sanitized_sha256 !== undefined && args.expected_sanitized_sha256 !== review.hash) return errorPayload("The preview version changed. Read it again before editing.", "version_mismatch");
  if (modes[0] === "edited_sanitized") return typeof args.edited_sanitized === "string" ? updateEditedSanitized(review, args.edited_sanitized) : errorPayload("edited_sanitized must be text.");
  if (!args.expected_sanitized_sha256) return errorPayload("Read the current preview hash before applying structured redactions.", "version_required");
  let spans = args.sensitive_spans;
  if (args.redactions !== undefined) {
    const invalid = validateSpans(review.sanitized, args.redactions, "selection");
    if (invalid) return invalid;
    const additions = args.redactions.flatMap((span) => {
      const start = originalOffset(review, span.start, "start"), end = originalOffset(review, span.end, "end");
      const value = review.original.slice(start, end);
      const occurrences = [];
      for (let at = review.original.indexOf(value); at >= 0; at = review.original.indexOf(value, at + value.length)) {
        occurrences.push({ ...span, start: at, end: at + value.length });
      }
      return occurrences;
    });
    spans = [...review.sourceChanges.map(({ start, end, type, scope, reason }) => ({ start, end, type, scope, reason })), ...additions];
  }
  const invalid = validateSpans(review.original, spans, "selection");
  if (invalid) return invalid;
  spans = selectionWithRequired(review.original, spans, review.detection.findings);
  const { sanitized, changes } = redactText(review.original, [], spans, review.sourceChanges);
  const next = { ...review, sanitized, changes, sourceChanges: changes, hash: hash(sanitized),
    allowedCandidates: new Set(detectionCandidates(review.original, review.detection.findings).filter((match) => !changes.some((change) => match.start < change.end && match.end > change.start)).map(candidateKey)) };
  const error = validateBody(next, sanitized, "preview");
  if (error) return error;
  if (sanitized !== review.sanitized) { next.token = null; next.status = "awaiting_confirmation"; }
  Object.assign(review, next);
  return null;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, review] of reviews) {
    if (review.expiresAt <= now) reviews.delete(id);
  }
}

function responsePayload(payload, toolName) {
  const widgetOnly = (toolName === "create_redaction_review" || toolName === "preview_redaction") && payload?.ok !== false
    ? {
        review_id: payload.review_id,
        original_content: payload.original_content,
        changes: payload.changes,
        original_changes: payload.original_changes,
        ui_translations: payload.ui_translations,
      }
    : null;
  const modelPayload = widgetOnly
    ? { ...payload, ui_translations: undefined, original_content: undefined, original_changes: undefined, changes: safeChanges(payload.changes || []), change_count: (payload.changes || []).length, change_summary: changeSummary(payload.changes || []) }
    : payload;
  const result = {
    content: [{ type: "text", text: JSON.stringify(modelPayload) }],
    structuredContent: modelPayload,
    isError: payload?.ok === false,
  };
  if (["create_redaction_review", "preview_redaction"].includes(toolName)) {
    result._meta = {
      ui: { resourceUri: UI_URI },
      "ui/resourceUri": UI_URI,
      "openai/outputTemplate": UI_URI,
      "openai/widgetAccessible": true,
    };
    if (widgetOnly) result._meta.redaction = widgetOnly;
  }
  return result;
}

function errorPayload(message, code = "invalid_request") {
  return { ok: false, error: { code, message } };
}

// The host supplies its current spawnable cloud model IDs. This MCP process
// cannot discover host availability or verify a user's choice independently.
function selectSubagentModel(args) {
  const now = Date.now();
  for (const [id, selection] of modelSelections) {
    if (selection.expiresAt <= now) modelSelections.delete(id);
  }
  if (!Array.isArray(args.available_models) || args.available_models.length === 0) {
    return errorPayload("Read the host's available cloud subagent models first; do not use an implicit default.", "available_models_required");
  }
  if (args.available_models.length > 128 || args.available_models.some((model) =>
    typeof model !== "string" || !model.trim() || model.length > 200 || /^(unknown|cloud|default|auto|configured host model)$/i.test(model.trim()))) {
    return errorPayload("available_models must contain actual host-supported cloud model IDs.", "invalid_available_models");
  }
  const hostModels = [...new Set(args.available_models.map((model) => model.trim()))];
  if (!Array.isArray(args.large_model_ids) || args.large_model_ids.some((model) =>
    typeof model !== "string" || !hostModels.includes(model))) {
    return errorPayload("Identify cloud large models from host capability descriptions, using exact IDs from available_models. An unknown capability is not eligible.", "large_model_classification_required");
  }
  const available = hostModels.filter((model) => args.large_model_ids.includes(model));
  const selected = typeof args.selected_model === "string" ? args.selected_model.trim() : "";
  if (selected && !hostModels.includes(selected)) {
    return errorPayload("The selected model is unavailable. Refresh the host list and let the user choose again; do not downgrade silently.", "model_unavailable");
  }
  if (selected && !available.includes(selected)) {
    return errorPayload("Complex analysis requires a cloud large model. Lightweight or unclassified models cannot be selected.", "cloud_large_model_required");
  }
  if (available.length === 0) {
    return errorPayload("No eligible cloud large model is available. Keep the data local and explain the limitation; do not fall back to a lightweight model.", "no_cloud_large_model");
  }
  if (available.length > 1 && (!selected || args.user_confirmed_selection !== true)) {
    return {
      ok: true,
      selection_required: true,
      available_models: available,
      next_step: "Show every eligible cloud large model to the user and wait for their explicit choice. Do not create a subagent or consume a redaction token yet.",
    };
  }
  const model = selected || available[0];
  const id = `model_${crypto.randomBytes(12).toString("hex")}`;
  modelSelections.set(id, { model, expiresAt: now + REVIEW_TTL_MS });
  return {
    ok: true,
    selection_required: false,
    model_selection_id: id,
    selected_model: model,
    spawn_parameters: { model, fork_turns: "none" },
    subagent_instructions: analysisSubagentInstructions({ language: args.response_language }),
    next_step: "Tell the user which cloud large model will run. Use spawn_parameters as actual host tool arguments, not as text in the task message. For route=subagent, create the subagent now using subagent_instructions as the mandatory role prefix and minimum non-sensitive task/context. Public-source retrieval and analysis belong to the subagent; do not first retrieve or extract public material in the main session. No redaction or review token is needed. For sensitive handoffs, use only the payload from handoff_to_subagent instead of this direct-task prefix. For sensitive content, complete local redaction and consent first. Return analysis to the local-model main session for final presentation.",
  };
}

function routeRequest(args) {
  const guard = modelGuard(args.model, args.user_confirmed_small_model, args.response_language);
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const context = typeof args.context === "string" ? args.context : "";
  if (prompt.length + context.length > MAX_CONTENT_CHARS) return errorPayload(`prompt and context exceed ${MAX_CONTENT_CHARS} characters. Split them in the main session first.`, "content_too_large");
  const assessment = assessRouting({ ...args, prompt, context });
  const base = { ok: true, ...guard, ...assessment };
  if (args.content_pending === true) {
    return { ...base, next_step: "Inspect the referenced content locally, then call route_request again with the same prompt and relevant extracted content in context. Unread attachments are not evidence of low sensitivity. Do not hand off content before this assessment is complete." };
  }
  purgeExpired();
  const review = typeof args.review_id === "string" ? reviews.get(args.review_id) : null;
  if (args.request_kind === "continuation") {
    if (args.review_id && !review) return errorPayload("review_id is unknown or expired. Recover the intended workflow; do not silently start a new review.", "review_not_found");
    return {
      ...base,
      route: "resume",
      assessment_required: false,
      missing_assessment: [],
      request_kind: "continuation",
      ...(review ? { review_id: review.id, workflow_status: review.status } : {}),
      next_step: review
        ? `Read the existing review with preview_redaction using audience=main and no edits. ${reviewNextStep(review)} Do not recreate the review or repeat valid confirmation. This routing decision does not grant consent or expose handoff tokens.`
        : "Resume the current workflow using relevant main-session context. Preserve valid model and redaction confirmations and task-scoped model selection. A routing decision alone does not authorize a handoff. If scope or material changed, assess it as a task with its actual content before analysis.",
    };
  }
  if (args.review_id && !review) return errorPayload("review_id is unknown or expired. Recover the existing review instead of bypassing its state.", "review_not_found");
  if (assessment.route === "redaction_required" || review) {
    if (review?.status === "confirmed") {
      return {
        ...base,
        route: "subagent_after_confirmation",
        assessment_required: false,
        missing_assessment: [],
        review_id: review.id,
        subagent_model_policy: SUBAGENT_MODEL_POLICY,
        next_step: reviewNextStep(review),
      };
    }
    return {
      ...base,
      route: "redaction_required",
      ...(review ? { assessment_required: false, missing_assessment: [] } : {}),
      subagent_model_policy: SUBAGENT_MODEL_POLICY,
      next_step: review ? reviewNextStep(review) : "Create a redaction review, briefly request confirmation, then end this turn and wait. Do not continue substantive research or analysis while awaiting confirmation. Before handoff, resolve the cloud model with select_subagent_model and wait for the user's choice when multiple eligible cloud large models are available. Then hand off only sanitized content.",
    };
  }
  if (assessment.route === "assessment_required") {
    return { ...base, next_step: "The local main-session model must assess task complexity, actual sensitivity and data provenance, then call route_request with complexity, sensitivity, data_scope and a brief assessment_reason without quoting sensitive values. Use task meaning and relevant context, not keyword counts or model names. Pattern candidates are advisory: public values can be non-sensitive, and confidential meaning can be sensitive without any pattern match. Unknown source scope cannot be cleared for cloud analysis. This is local reasoning, not a request for another user confirmation. Inspect actual unread referenced material when needed." };
  }
  if (assessment.route === "subagent") {
    return {
      ...base,
      subagent_model_policy: SUBAGENT_MODEL_POLICY,
      subagent_instructions: analysisSubagentInstructions({ language: args.response_language }),
      next_step: "Call select_subagent_model with the host's available cloud models and host-identified large_model_ids and wait for the user's choice when multiple eligible cloud large models are available. Explicitly pass the returned spawn_parameters to the host subagent tool with minimum non-sensitive context directly; no redaction review, confirmation or handoff token is needed. Include subagent_instructions as the mandatory role prefix. For public-information tasks, give it the research objective and public links if already known; let it search, retrieve public material, verify and analyze. Do not first retrieve or extract public material in the main session. Return its result to the main session.",
    };
  }
  return { ...base, next_step: "Complete in the current local-model main session." };
}

async function routeWithDetection(args) {
  // Contextual format matches remain advisory; mandatory protection cannot be cleared
  // merely by declaring the same content low-sensitivity.
  if (args.request_kind !== "continuation" && args.content_pending !== true && args.complexity === "complex" && args.sensitivity === "low") {
    const content = [args.prompt, args.context].filter((v) => typeof v === "string").join("\n");
    if (content.trim()) {
      const detection = await detectContent(content);
      if (detection.findings.some((item) => item.protection === "required")) {
        const result = routeRequest({ ...args, sensitivity: "high" });
        return { ...result, ...(result.sensitivity ? { sensitivity: { ...result.sensitivity, source: "required_detectors" } } : {}), required_protection_detected: true };
      }
    }
  }
  return routeRequest(args);
}

async function createReview(args) {
  const language = args.response_language;
  let translations = {};
  if (!/^(zh|en)(?:-|$)/i.test(language)) {
    const supplied = isObject(args.ui_translations) ? args.ui_translations : {};
    const keys = Object.keys(englishMessages);
    const continuation = "（预览编号：{review_id}）";
    if (keys.some((key) => typeof supplied[key] !== "string" || !supplied[key].trim() || supplied[key].length > 2000)
        || !supplied[continuation]?.includes("{review_id}")) {
      return { ...errorPayload("Prepare the complete UI translations locally in the requested language, then retry. Preserve {review_id} in the continuation message. Do not ask the user to translate the interface.", "ui_translation_required"), ui_translation_source: englishMessages };
    }
    translations = Object.fromEntries(keys.map((key) => [key, supplied[key]]));
  }
  const guard = modelGuard(args.model, args.user_confirmed_small_model, args.response_language);
  if (args.audience !== "main") return errorPayload("Only the main session may create a review.", "audience_denied");
  const content = typeof args.content === "string" ? args.content : "";
  if (!content.trim()) return errorPayload("content is required.");
  if (content.length > MAX_CONTENT_CHARS) return errorPayload(`content exceeds ${MAX_CONTENT_CHARS} characters. Split it in the main session first.`, "content_too_large");
  const spans = args.sensitive_spans;
  if (spans !== undefined) {
    const invalid = validateSpans(content, spans, "selection");
    if (invalid) return invalid;
  }
  const detection = await detectContent(content, { patterns: args.custom_patterns });
  const selection = selectionWithRequired(content, spans === undefined ? detection.findings : spans, detection.findings);
  const { sanitized, changes } = redactText(content, [], selection);
  const scopeError = validateSpanScopes(content, changes, "selection");
  if (scopeError) return scopeError;
  const id = `review_${crypto.randomBytes(8).toString("hex")}`;
  const review = {
    id,
    responseLanguage: language,
    uiTranslations: translations,
    original: content,
    detection,
    sanitized,
    changes,
    sourceChanges: changes.map((change) => ({ ...change })),
    status: "awaiting_confirmation",
    hash: hash(sanitized),
    createdAt: Date.now(),
    expiresAt: Date.now() + REVIEW_TTL_MS,
    filename: typeof args.filename === "string" ? args.filename : null,
    customPatterns: Array.isArray(args.custom_patterns) ? args.custom_patterns : [],
    // Explicit semantic spans are the main session's contextual redaction policy.
    // Unselected original candidates may remain; new unreviewed values may not.
    allowedCandidates: new Set(spans === undefined ? [] : detectionCandidates(content, detection.findings)
      .filter((match) => !changes.some((change) => match.start < change.end && match.end > change.start))
      .map(candidateKey)),
    token: null,
  };
  const validationError = validateBody(review);
  if (validationError) return validationError;
  reviews.set(id, review);
  return {
    ok: true,
    ...guard,
    response_language: review.responseLanguage,
    ui_translations: review.uiTranslations,
    review_id: id,
    status: review.status,
    expires_at: new Date(review.expiresAt).toISOString(),
    filename: review.filename,
    ...versionFields(review),
    sensitive_count: changes.length,
    changes: publicChanges(changes),
    original_changes: publicChanges(review.sourceChanges),
    original_content: content,
    sanitized_content: sanitized,
    original_storage: "main_process_memory_only",
    subagent_access: "blocked_until_human_confirmation",
    confirmation_required: true,
    next_step: reviewNextStep(review),
  };
}

function getReview(args, allowSubagent = false) {
  purgeExpired();
  const review = reviews.get(args.review_id);
  if (!review) return { error: errorPayload("review_id is unknown or expired.", "review_not_found") };
  if (!allowSubagent && args.audience !== "main") {
    return { error: errorPayload("Original content is available only to the main session.", "audience_denied") };
  }
  return { review };
}

function previewReview(args) {
  const result = getReview(args);
  if (result.error) return result.error;
  const { review } = result;
  const editError = reviseReview(review, args);
  if (editError) return editError;
  const validationError = validateBody(review);
  if (validationError) return validationError;
  return {
    ok: true,
    review_id: review.id,
    status: review.status,
    filename: review.filename,
    response_language: review.responseLanguage,
    ui_translations: review.uiTranslations,
    original_content: review.original,
    sanitized_content: review.sanitized,
    changes: publicChanges(review.changes),
    original_changes: publicChanges(review.sourceChanges),
    confirmation_required: review.status !== "confirmed",
    handoff_ready: review.status === "confirmed",
    handoff_token: review.status === "confirmed" ? review.token : null,
    ...versionFields(review),
    expires_at: new Date(review.expiresAt).toISOString(),
    next_step: reviewNextStep(review),
  };
}

function confirmReview(args) {
  const result = getReview(args);
  if (result.error) return result.error;
  const { review } = result;
  if (args.confirmed !== true) {
    review.status = "rejected";
    review.token = null;
    return { ok: true, review_id: review.id, status: review.status, handoff_ready: false, next_step: reviewNextStep(review) };
  }
  if (typeof args.edited_sanitized === "string") {
    const error = updateEditedSanitized(review, args.edited_sanitized);
    if (error) return error;
  }
  if (args.expected_sanitized_sha256 !== undefined && args.expected_sanitized_sha256 !== review.hash) return errorPayload("The preview changed before confirmation.", "version_mismatch");
  const validationError = validateBody(review, review.sanitized, "confirm");
  if (validationError) return validationError;
  review.status = "confirmed";
  review.token ||= crypto.randomBytes(24).toString("base64url");
  return {
    ok: true,
    review_id: review.id,
    status: review.status,
    handoff_ready: true,
    handoff_token: review.token,
    ...versionFields(review),
    subagent_access: "sanitized_content_only",
    change_count: review.changes.length,
    change_summary: changeSummary(review.changes),
    next_step: reviewNextStep(review),
  };
}

function revokeReview(args) {
  const result = getReview(args);
  if (result.error) return result.error;
  const { review } = result;
  review.status = "revoked";
  review.token = null;
  return { ok: true, review_id: review.id, status: review.status, handoff_ready: false, next_step: reviewNextStep(review) };
}

async function handoff(args) {
  purgeExpired();
  const review = reviews.get(args.review_id);
  if (!review) return errorPayload("review_id is unknown or expired.", "review_not_found");
  if (args.audience !== "subagent") return errorPayload("handoff_to_subagent requires audience=subagent.", "audience_required");
  if (typeof args.model !== "string" || !args.model.trim()) return errorPayload("A cloud-model name is required for subagent handoff.", "model_required");
  if (review.status !== "confirmed" || !review.token || args.handoff_token !== review.token) {
    return errorPayload("Human confirmation is required and the one-time handoff token must match.", "confirmation_required");
  }
  if (args.expected_sanitized_sha256 !== undefined && args.expected_sanitized_sha256 !== review.hash) {
    return errorPayload("The sanitized version has changed. Read the current review before handing it off.", "version_mismatch");
  }
  const selection = modelSelections.get(args.model_selection_id);
  if (!selection || selection.expiresAt <= Date.now()) {
    return errorPayload("Resolve the cloud model with select_subagent_model before handoff. Multiple available models require the user's choice.", "model_selection_required");
  }
  if (selection.model !== args.model) {
    return errorPayload("The handoff model must match the resolved model; do not fall back to the host default.", "model_selection_mismatch");
  }
  const bodyError = validateBody(review, review.sanitized, "handoff");
  if (bodyError) return bodyError;
  const task = typeof args.task === "string" ? args.task : "Analyze the sanitized material and return evidence-based findings.";
  if (containsOriginal(review, task) || unapprovedMatches(task, review).length > 0) {
    return validationFailure("sensitive_value_detected", "task", textIssues(review, task, false));
  }
  const checkedToken = review.token, checkedHash = review.hash;
  const taskDetection = await detectContent(task, { patterns: review.customPatterns });
  const issues = detectionCandidates(task, taskDetection.findings)
    .filter((item) => item.protection === "required" || !review.allowedCandidates.has(candidateKey(item)));
  if (issues.length) return validationFailure("sensitive_value_detected", "task", issues.map(({ type, start, end }) => ({ kind: "pattern_candidate", type, start, end })));
  // Detection is asynchronous: consent, edits, expiry or a competing handoff may change state.
  if (review.status !== "confirmed" || review.token !== checkedToken || review.hash !== checkedHash
      || review.expiresAt <= Date.now() || selection.expiresAt <= Date.now()) return errorPayload("Authorization changed during detection. Read the current review.", "version_mismatch");
  const finalError = validateBody(review, review.sanitized, "handoff");
  if (finalError) return finalError;
  review.token = null;
  review.status = "handed_off";
  return {
    ok: true,
    review_id: review.id,
    status: review.status,
    spawn_parameters: { model: selection.model, fork_turns: "none" },
    next_step: reviewNextStep(review),
    subagent_payload: {
      execution_role: "sanitized_analysis_subagent",
      subagent_instructions: analysisSubagentInstructions({ sanitized: true, language: review.responseLanguage }),
      task,
      sanitized_content: review.sanitized,
    },
  };
}

const spanSchema = { type: "array", items: { type: "object", properties: {
  start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 },
  type: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" },
  scope: { type: "string", enum: ["field", "passage"], description: "Default field. Multi-block selections require passage and a reason; prefer precise values to whole clauses." },
  reason: { type: "string", maxLength: 2000, description: "Explain why an entire passage is sensitive without quoting private values. Do not broaden scope merely to satisfy a pattern check." },
}, required: ["start", "end", "type"] } };
function toolDefinitions() {
  return [
    {
      name: "check_model",
      title: "Check the main-session model",
      description: "Only the main session checks local deployment when it is not already confirmed or the model changes. A small-model name does not prove local deployment. Continue after confirmation without forcing a switch or blocking execution. Subagents do not call this tool. Reuse the session confirmation for follow-up prompts.",
      inputSchema: { type: "object", properties: { model: { type: "string" }, user_confirmed_small_model: { type: "boolean", description: "Set to true only after the user explicitly confirms that the current main session uses a locally deployed model." } }, required: ["model"] },
    },
    {
      name: "route_request",
      title: "Route the current request",
      description: "Call in the main session for every user prompt, including follow-ups, confirmations and retries. For tasks, supply semantic complexity, sensitivity, data_scope and assessment_reason. Missing assessment returns assessment_required and never clears cloud analysis. Contextual pattern matches are advisory; required detector findings override a low-sensitivity declaration. Include only relevant task context and locally extracted attachment content. Use content_pending for unread material and request_kind=continuation to resume existing workflow state without repeating consent. Reassess changed scope or content as a task. Subagents do not call this tool. Complex sensitive analysis requires redaction confirmation before cloud handoff.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string" },
          user_confirmed_small_model: { type: "boolean", description: "Set to true only after the user explicitly confirms that the current main session uses a locally deployed model." },
          prompt: { type: "string" },
          context: { type: "string", description: "Relevant prior task context and locally extracted content. Exclude unrelated earlier tasks. Never pass original data to a cloud subagent." },
          content_pending: { type: "boolean", description: "True for unread user-supplied files, attachments or private/unknown referenced material that needs local inspection. Public web research alone does not set this flag; the non-sensitive subagent retrieves public sources." },
          request_kind: { type: "string", enum: ["task", "continuation"], description: "Use continuation only to advance an existing workflow without changed scope or material; every prompt is still assessed." },
          complexity: { type: "string", enum: ["simple", "complex"], description: "Judge reasoning depth, synthesis, uncertainty and steps from task meaning, irrespective of domain vocabulary or prompt length." },
          sensitivity: { type: "string", enum: ["low", "medium", "high"], description: "Main-session semantic judgment of actual content, including confidential meaning without pattern matches. Public amounts or entity names are not automatically sensitive." },
          data_scope: { type: "string", enum: ["public", "private", "mixed", "none", "unknown"], description: "Provenance of the material actually in scope, assessed locally. Public requires verified public provenance for supplied material, or a research objective confined to public sources. Unknown cannot clear complex cloud analysis." },
          assessment_reason: { type: "string", minLength: 1, maxLength: 2000, description: "Brief local rationale for complexity, sensitivity and provenance. Address any pattern candidates without quoting private values. Do not ask the user to supply this reasoning." },
          review_id: { type: "string" },
        },
        required: ["model", "prompt"],
      },
    },
    {
      name: "select_subagent_model",
      title: "Select a cloud analysis model",
      description: "Call from the main session before creating a subagent for complex analysis. Supply the complete host cloud model list and large-model IDs identified from host capability descriptions. Choose only among cloud large models and wait for user selection when several are eligible. Eligibility is based on host capability descriptions, never substrings in a model name. Models the host classifies as lightweight or unknown are ineligible. This tool does not create a subagent.",
      inputSchema: {
        type: "object",
        properties: {
          available_models: { type: "array", minItems: 1, maxItems: 128, items: { type: "string", minLength: 1, maxLength: 200 }, description: "Actual cloud model IDs from the host subagent tool description or model enumeration API. Do not invent IDs from memory or supply only the default model." },
          large_model_ids: { type: "array", maxItems: 128, items: { type: "string", minLength: 1, maxLength: 200 }, description: "Cloud large-model IDs from available_models, identified using host capability descriptions. Exclude lightweight models and models with unknown capabilities. Use capability descriptions for every candidate; model names do not determine eligibility." },
          selected_model: { type: "string", description: "The exact model ID selected by the user. May be omitted when only one candidate is eligible." },
          user_confirmed_selection: { type: "boolean", description: "Set to true only after the user explicitly selects this cloud model. Redaction confirmation is not a model choice." },
        },
        required: ["available_models", "large_model_ids"],
      },
    },
    {
      name: "detect_sensitive_content",
      title: "Inspect privacy candidates locally",
      description: "Run local rules, enterprise dictionary and an optional configured local model. Return only UTF-16 positions, types and protection requirements, never original values. All enabled detectors must succeed. Main session reviews contextual findings against the task and source; zero findings do not certify privacy.",
      inputSchema: { type: "object", properties: { audience: { type: "string", enum: ["main"] }, content: { type: "string", maxLength: 200000 }, custom_patterns: { type: "array", items: { type: "object" } } }, required: ["audience", "content"] },
    },
    {
      name: "create_redaction_review",
      title: "Create a redaction comparison",
      description: "Identify sensitive information in the main session and create a two-column comparison. After creating the preview, briefly request confirmation, end this turn and wait. Do not continue substantive analysis or research. Keep original text only in local memory; do not hand it to a subagent before human confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string" },
          user_confirmed_small_model: { type: "boolean", description: "Set to true only after the user explicitly confirms that the current main session uses a locally deployed model." },
          audience: { type: "string", enum: ["main"] },
          content: { type: "string" },
          filename: { type: "string" },
          custom_patterns: { type: "array", items: { type: "object" } },
          sensitive_spans: { ...spanSchema, description: "Complete contextual redaction selection in original content, with UTF-16 offsets. Preserve all unselected text. Select narrow sensitive values; multi-block passages require scope=passage and reason. Unselected contextual candidates may remain. Required secrets, identity numbers and configured mandatory categories are always protected. Omit only for an automatic candidate preview requiring local semantic review." },
        },
        required: ["model", "audience", "content"],
      },
      _meta: { ui: { resourceUri: UI_URI, visibility: ["model", "app"] }, "openai/outputTemplate": UI_URI, "ui/resourceUri": UI_URI, "openai/widgetAccessible": true },
    },
    {
      name: "preview_redaction",
      title: "View redaction comparison",
      description: "Only the main session may read or revise a review. To continue redaction, send redactions in current sanitized coordinates, or sensitive_spans as a complete corrected selection in original coordinates, with expected_sanitized_sha256. The server preserves all unselected text, creates registered tokens and recomputes statistics. Do not rewrite or summarize edited_sanitized; only unchanged legacy text is accepted. Failed validation includes positions/categories without values.",
      inputSchema: { type: "object", properties: { review_id: { type: "string" }, audience: { type: "string", enum: ["main"] }, edited_sanitized: { type: "string", description: "Compatibility only: must equal the current canonical text. Use structured spans to redact more." },
        redactions: { ...spanSchema, description: "Additional sensitive selections in the CURRENT sanitized text. Identical values elsewhere are masked consistently; existing masks are preserved." },
        sensitive_spans: { ...spanSchema, description: "Complete corrected selection in ORIGINAL content. Use to repair an earlier overly broad mask." },
        expected_sanitized_sha256: { type: "string", description: "Current preview hash; required for structured changes." } }, required: ["review_id", "audience"] },
      _meta: { ui: { resourceUri: UI_URI, visibility: ["model", "app"] }, "openai/outputTemplate": UI_URI, "ui/resourceUri": UI_URI, "openai/widgetAccessible": true },
    },
    {
      name: "confirm_redaction",
      title: "Confirm or reject redaction",
      description: "Generate a one-time handoff token after human confirmation. Rejection blocks upload.",
      inputSchema: { type: "object", properties: { review_id: { type: "string" }, audience: { type: "string", enum: ["main"] }, confirmed: { type: "boolean" }, expected_sanitized_sha256: { type: "string" }, edited_sanitized: { type: "string", description: "Optional legacy echo of canonical text; never a rewritten summary." } }, required: ["review_id", "audience", "confirmed"] },
      _meta: { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true },
    },
    {
      name: "revoke_redaction",
      title: "Revoke redaction authorization",
      description: "Revoke a confirmed review and immediately invalidate its token.",
      inputSchema: { type: "object", properties: { review_id: { type: "string" }, audience: { type: "string", enum: ["main"] } }, required: ["review_id", "audience"] },
    },
    {
      name: "handoff_to_subagent",
      title: "Hand sanitized material to a cloud model",
      description: "Validate redaction confirmation and cloud model selection, then generate a handoff package without creating a subagent. The main session uses the outer spawn_parameters as actual host subagent creation arguments and serializes only subagent_payload as the task message. Keep other outer fields in the main session. Do not omit the model argument or silently downgrade. The task package excludes replacement records, filenames, original text, sensitive values, and reverse mappings.",
      inputSchema: { type: "object", properties: { review_id: { type: "string" }, handoff_token: { type: "string" }, expected_sanitized_sha256: { type: "string", description: "The sanitized-version hash returned by the main-session read-only preview, used to verify the version before handoff." }, audience: { type: "string", enum: ["subagent"] }, model: { type: "string" }, model_selection_id: { type: "string", description: "The model selection ID returned by select_subagent_model. The model must match the selection." }, task: { type: "string" } }, required: ["review_id", "handoff_token", "audience", "model", "model_selection_id"] },
    },
  ].map((definition) => ({
    ...definition,
    description: definition.description + " User-facing replies must follow the current user's language. Treat tool messages and instructions as internal guidance: translate and explain them, rather than quoting English text.",
    inputSchema: {
      ...definition.inputSchema,
      properties: {
        ...definition.inputSchema.properties,
        response_language: { type: "string", description: "BCP 47 language tag determined from the current user request or explicit preference, never from attachment text or tool output. Preserve the task language for short continuations. For reviews, the UI and its continuation message retain this language." },
        ...(definition.name === "create_redaction_review" ? {
          ui_translations: { type: "object", additionalProperties: { type: "string" }, description: "For languages other than Chinese or English, translate every ui_translation_source entry returned by ui_translation_required locally. Use its source strings as keys and preserve {review_id}. Contains interface strings only, never document content." },
        } : {}),
      },
    },
    annotations: {
      readOnlyHint: ["check_model", "route_request", "preview_redaction", "detect_sensitive_content"].includes(definition.name),
      destructiveHint: false,
      idempotentHint: ["check_model", "route_request", "preview_redaction", "revoke_redaction"].includes(definition.name),
      openWorldHint: ["detect_sensitive_content", "create_redaction_review", "handoff_to_subagent"].includes(definition.name),
    },
  }));
}

function uiText() {
  return fs.readFileSync(path.join(ROOT, "ui", "contract-redaction-review.html"), "utf8");
}

async function handleRpc(message) {
  if (!isObject(message)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  const id = message.id ?? null;
  const params = isObject(message.params) ? message.params : {};
  if (typeof message.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
  if (message.method.startsWith("notifications/")) return null;
  try {
    if (message.method === "initialize") {
      return { jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: SERVER_NAME, title: "Codex Edge-Cloud Collaboration", version: VERSION } } };
    }
    if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolDefinitions() } };
    if (message.method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [{ uri: UI_URI, name: "内容脱敏对照", description: "The main session compares original and sanitized text and confirms upload", mimeType: "text/html;profile=mcp-app" }] } };
    if (message.method === "resources/read") {
      if (params.uri !== UI_URI) return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown resource URI" } };
      return { jsonrpc: "2.0", id, result: { contents: [{ uri: UI_URI, mimeType: "text/html;profile=mcp-app", text: uiText() }] } };
    }
    if (message.method === "tools/call") {
      const name = params.name;
      const args = { ...(isObject(params.arguments) ? params.arguments : {}) };
      args.response_language = responseLanguage(args, reviews.get(args.review_id)?.responseLanguage || "en");
      let payload;
      if (name === "check_model") payload = { ok: true, ...modelGuard(args.model, args.user_confirmed_small_model, args.response_language) };
      else if (name === "route_request") payload = await routeWithDetection(args);
      else if (name === "select_subagent_model") payload = selectSubagentModel(args);
      else if (name === "detect_sensitive_content") payload = await inspectContent(args);
      else if (name === "create_redaction_review") payload = await createReview(args);
      else if (name === "preview_redaction") payload = previewReview(args);
      else if (name === "confirm_redaction") payload = confirmReview(args);
      else if (name === "revoke_redaction") payload = revokeReview(args);
      else if (name === "handoff_to_subagent") payload = await handoff(args);
      else payload = errorPayload(`Unknown tool: ${name}`, "unknown_tool");
      return { jsonrpc: "2.0", id, result: responsePayload(name === "handoff_to_subagent" ? payload : { response_language: args.response_language, ...payload }, name) };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  } catch (error) {
    if (error instanceof DetectionError) return { jsonrpc: "2.0", id, result: responsePayload(errorPayload("Local detection did not complete. Fix the detector configuration or retry locally; cloud handoff remains blocked.", error.code), params.name) };
    console.error(`[${SERVER_NAME}]`, error?.stack || error);
    return { jsonrpc: "2.0", id, error: { code: -32000, message: error?.message || String(error) } };
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    return;
  }
  const result = await handleRpc(message);
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
});

if (process.argv.includes("--self-check")) {
  console.error(`${SERVER_NAME} ${VERSION} ready`);
}
