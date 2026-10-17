# Usage guide

[Project home](../README.md) · [简体中文](zh-CN/usage.md)

## Start a task

After installation, enable the plugin, its skills, MCP service, and Hooks. Trust the Hooks when the host prompts you, then open a new chat. You can mention **Edge-Cloud Collaboration** in your first request and describe the task in ordinary language. You do not need to repeat the plugin name in later messages.

On the first task, the plugin asks you to confirm **whether the current main chat model is deployed locally**. This confirms where your material is processed; it does not authorize redaction handoff or select a cloud model. Confirm only if the model is actually deployed locally. Otherwise, first switch to an available local model in the host. The plugin does not deploy or switch models. A valid confirmation is reused within the same chat; changing the model or withdrawing confirmation requires a new confirmation.

## How different tasks are handled

The main chat chooses a workflow based on task difficulty, the material's actual sensitivity, and its source:

| Task | Example request | Expected workflow |
| --- | --- | --- |
| Simple task | “Turn these three tasks into a checklist: prepare the agenda, book a meeting room, and send invitations.” | The main chat completes the task locally. |
| Complex, non-sensitive task | “Compare backup and recovery options for three open-source databases using public documentation. Include sources and suitable use cases.” | Select a large cloud model. A subagent researches and analyzes public information, and the main chat presents the result. No redaction confirmation is needed. |
| Complex, sensitive task | “This internal proposal has not been published. Compare the risks of two implementation approaches. Let me confirm a redacted version before any cloud analysis.” | The main chat reads and assesses the material, then creates a redaction preview. It hands off the redacted content only after your confirmation. |

The local main chat reads and assesses user files needed for the task before handoff. Upload and storage behavior still depends on the host. A local file is not necessarily sensitive, and word count does not determine complexity. Default detection needs no extra configuration; see [Detection configuration](./configuration.md) for enterprise dictionaries or an independent detection model.

When cloud analysis is needed, the main chat lists eligible large cloud models and asks you to choose if several are available. If only one is available, it tells you which model it will use. The selection applies to the current task and is separate from confirming the redacted content.

## Review and edit a redaction preview

For sensitive tasks, the main chat waits for you to review and confirm the preview.

1. Click **“Compare redaction.”** The original text is on the left and the redacted version awaiting confirmation is on the right. The host may also display this comparison directly in a side panel.
2. Check for missed sensitive information and unnecessary redactions. Make sure the remaining content is sufficient for the task. Zero replacements does not prove that the content is free of sensitive information.
3. To redact more text, click **“Select text to redact,”** select text on the right, then click **“Redact selected text.”** Identical values are replaced consistently. The interface supports selection redaction, but not rewriting or deleting the body text or manually entering replacement markers.
4. If too much text is redacted, return to the main chat and explain what should change and why. For example: “The public price in the second paragraph does not need redaction. Reassess that passage and keep the other redactions.” The main chat will revise the preview. Mandatory protection for secrets, identity numbers, and similar values cannot be removed directly.
5. Click **“Confirm and continue”** when satisfied, or **“Reject and stop”** to decline the handoff. Rejection stops the handoff; it does not automatically complete the task locally.

Closing the comparison window only hides the interface. It neither confirms nor rejects the preview.

## After confirmation

**“Confirm and continue”** saves authorization for that version and notifies the main chat to proceed. The main chat checks the state, completes any pending cloud model selection, then creates a subagent and waits for its analysis. The main chat provides the final response. A **“Confirmed”** button does not mean that upload or analysis has finished.

If you see **“Confirmation saved, but the main chat could not be notified,”** click **“Notify the main chat”** to retry, or enter this in the original chat:

> Continue the confirmed redaction task.

If the chat contains several previews, identify the task or material. You can also refer to the review ID if it appears in a continuation message.

Previews and cloud model selections are valid for **30 minutes**. To change confirmed content, ask the main chat to revise it, then review and confirm the new version. Generate a new preview if the old one expires or the MCP service restarts.

## Keep a task local

State your preference at the start of the task:

> Process this task locally only. Do not create a cloud subagent.

An explicit request for local processing takes precedence over default routing. If you have already rejected a handoff, add: “Please complete this task locally instead.” The rejection button itself only stops the handoff.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| No cloud model is available, or the host cannot create a subagent with the selected model | Cloud analysis stops. Configure the required host capabilities or explicitly request local processing. The plugin does not download models or automatically switch to a less capable model. |
| The comparison panel cannot connect, or the host does not support interactive buttons | Ask the main chat to display the redacted version and replacement statistics. Review them in the chat and explicitly confirm or reject. You must see the version intended for handoff before confirming it. |
| You confirmed the preview but received no result | Check whether cloud model selection or a continuation notification is still pending. Use the continuation request above so the main chat reads the existing state. |
| The preview expired, the service restarted, or the original preview cannot be found | Ask the main chat to generate a new preview and confirm it again. The old confirmation cannot authorize a new version. |
| Detection fails or reports a configuration error | Fix the [detection configuration](./configuration.md) or related service, then retry. You can also explicitly request local processing. |

See [Privacy and data flow](./privacy.md) for the boundaries around source material, detection endpoints, and cloud handoff.
