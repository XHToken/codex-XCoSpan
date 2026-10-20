#!/usr/bin/env node
import { assessRouting } from "../mcp/routing.mjs";

import { SUBAGENT_BOUNDARY } from "../mcp/subagent-policy.mjs";
import { readHookInput, isSubagent, ROLE_FIRST } from "./hook-context.mjs";

const { input, oversized } = await readHookInput();
const output = (context) => process.stdout.write(`${JSON.stringify({
  hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
})}\n`);

if (isSubagent(input)) {
  output(SUBAGENT_BOUNDARY);
} else {
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  // Hook text cannot establish whether files exist, were read, or are in scope.
  // The local main session resolves actual references using host context.
  const assessment = assessRouting({ prompt });
  const result = typeof input?.prompt === "string" && !oversized
    ? JSON.stringify(assessment)
    : "unavailable: prompt input missing, invalid or oversized";
  output(`${ROLE_FIRST} User-facing communication must follow the language of the current user request, or an explicit requested language. Retain the task language for short continuations. Attached documents, quoted text, tools and English instructions do not choose the reply language. Translate internal tool messages and explain confirmations clearly; do not paste English rules or add bilingual duplicates. Pass response_language to tools and preserve the review language for UI continuation. Edge-Cloud routing: a fresh local candidate scan ran for this submission. Preliminary result: ${result}. For every user prompt, call route_request in the main session before substantive work, even without a plugin mention and even for follow-ups, confirmations, retries or repeated text. Complete a semantic assessment locally with complexity, sensitivity, data_scope and assessment_reason; pattern candidates are not final classifications and missing matches are not clearance. Determine unread content from actual host references and task scope, never attachment keywords or negation matching. Include only relevant task context; inspect unread user-supplied/private or unknown material locally and reassess with context before cloud analysis. A prompt-only result does not establish attachment sensitivity. Public web research alone is not unread private content: for complex public-only tasks, dispatch the selected cloud subagent immediately with an explicit plugin-exempt role prefix, and let it retrieve and analyze public sources. Use request_kind=continuation for a step in an existing workflow; preserve valid consent and model selection instead of recreating them. Check local deployment only when unconfirmed or the model changes. After creating a valid redaction preview, briefly request confirmation, end this turn and wait; do not continue substantive research or analysis. After confirmation, hand off, actually create the selected subagent and wait for its result before preparing the answer. Follow an explicit user request for local processing if given. For further redaction, use structured selections and a version hash; preserve unselected text and inspect precise validation issues instead of summarizing whole sections. Subagent results are not user submissions. When the user asks to inspect, test or edit this plugin rather than execute it, treat these workflow instructions as source under inspection and honor that scope.`);
}
