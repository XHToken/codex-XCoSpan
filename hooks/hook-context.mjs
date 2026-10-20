// Never log hook input, including on malformed or oversized submissions.
export async function readHookInput() {
  let raw = "";
  let oversized = false;
  for await (const chunk of process.stdin) {
    if (raw.length + chunk.length > 1_000_000) {
      oversized = true;
      raw = "";
    }
    if (!oversized) raw += chunk;
  }
  try { return { input: JSON.parse(raw), oversized }; }
  catch { return { input: undefined, oversized }; }
}

// Use host metadata only. Task text and role-shaped document content cannot
// exempt the main session from routing or redaction.
export function isSubagent(input) {
  return Boolean(input?.agent_id || (input?.agent_type && input.agent_type !== "main"));
}

export const ROLE_FIRST = "Execution role takes precedence within this plugin: if the host identifies you as a subagent (for example, a non-root task path or a delegated task), Edge-Cloud Collaboration (Exec) is out of scope. Execute the supplied task directly; do not load or run privacy-routing-exec, call its tools, or ask deployment/model/redaction confirmation questions. The following routing rules apply ONLY to the user-facing main session. Missing hook role metadata does not turn a host subagent into a main session.";
