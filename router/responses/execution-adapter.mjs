import {
  backendUnavailable,
  invalidRequest,
  requestTimeout
} from "./error-mapper.mjs";

function containsAttachments(
  items
) {
  return items.some(
    item => {
      if (
        item.kind === "message"
      ) {
        return item.content.some(
          part =>
            part.kind ===
            "attachment"
        );
      }

      if (
        item.kind ===
          "function_call_output" &&
        item.output.kind ===
          "content"
      ) {
        return item.output.content.some(
          part =>
            part.kind ===
            "attachment"
        );
      }

      return false;
    }
  );
}

function renderMessages(items) {
  return items
    .map(
      item => {
        if (
          item.kind !== "message"
        ) {
          return null;
        }

        const text =
          item.content
            .filter(
              part =>
                part.kind ===
                "text"
            )
            .map(
              part =>
                part.text
            )
            .join("\n");

        return `[${item.role}]\n${text}`;
      }
    )
    .filter(Boolean)
    .join("\n\n");
}

export function buildBrowserExecutionInput(
  normalized
) {
  if (
    containsAttachments(
      normalized.input
    ) ||
    containsAttachments(
      normalized.instructions
        ?.items ?? []
    )
  ) {
    throw invalidRequest(
      "Image/file execution is not enabled in Phase 1. The request was normalized successfully, but the current browser execution adapter is text-only.",
      "input",
      "attachment_execution_not_implemented"
    );
  }

  if (
    normalized.tools.length > 0
  ) {
    throw invalidRequest(
      "Tool execution is not enabled in Phase 1.",
      "tools",
      "tool_execution_not_implemented"
    );
  }

  if (
    normalized.input.some(
      item =>
        item.kind ===
        "function_call_output"
    )
  ) {
    throw invalidRequest(
      "function_call_output execution is not enabled in Phase 1.",
      "input",
      "function_call_output_not_implemented"
    );
  }

  const sections = [];

  if (
    normalized.instructions
      ?.items?.length
  ) {
    sections.push(
      renderMessages(
        normalized.instructions.items
      )
    );
  }

  sections.push(
    renderMessages(
      normalized.input
    )
  );

  return sections
    .filter(Boolean)
    .join("\n\n");
}

export async function executeNormalizedRequest(
  normalized,
  {
    fetchImpl =
      globalThis.fetch,
    browserRunUrl =
      "http://127.0.0.1:8788/browser/run",
    healthUrl =
      "http://127.0.0.1:8788/health",
    timeoutMs = 300000
  } = {}
) {
  if (
    typeof fetchImpl !==
      "function"
  ) {
    throw backendUnavailable(
      "No fetch implementation is available."
    );
  }

  const input =
    buildBrowserExecutionInput(
      normalized
    );

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const healthResponse =
      await fetchImpl(
        healthUrl,
        {
          signal:
            controller.signal
        }
      );

    if (!healthResponse.ok) {
      throw backendUnavailable(
        `Execution backend health check failed with HTTP ${healthResponse.status}.`
      );
    }

    let health;

    try {
      health =
        await healthResponse.json();
    } catch {
      throw backendUnavailable(
        "Execution backend health check returned invalid JSON.",
        "invalid_backend_response"
      );
    }

    if (
      !health
        ?.extension_connected
    ) {
      throw backendUnavailable(
        "Browser extension execution backend is unavailable.",
        "extension_not_connected"
      );
    }

    const response =
      await fetchImpl(
        browserRunUrl,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json"
          },
          body:
            JSON.stringify({
              input,
              timeout_ms:
                timeoutMs
            }),
          signal:
            controller.signal
        }
      );

    let payload;

    try {
      payload =
        await response.json();
    } catch {
      throw backendUnavailable(
        "Execution backend returned invalid JSON.",
        "invalid_backend_response"
      );
    }

    if (!response.ok) {
      if (
        response.status === 504
      ) {
        throw requestTimeout(
          payload?.error ||
          "Execution backend timed out."
        );
      }

      throw backendUnavailable(
        payload?.error ||
        `Execution backend failed with HTTP ${response.status}.`
      );
    }

    if (
      typeof payload?.output_text !==
        "string"
    ) {
      throw backendUnavailable(
        "Execution backend response did not contain output_text.",
        "invalid_backend_response"
      );
    }

    return {
      output_text:
        payload.output_text,
      backend_job_id:
        payload.id ??
        payload.job_id ??
        null,
      model_selection_verified:
        false
    };
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw requestTimeout(
        `Timed out after ${timeoutMs}ms.`
      );
    }

    if (error?.status) {
      throw error;
    }

    throw backendUnavailable(
      "Execution backend could not be reached.",
      "backend_connection_failed"
    );
  } finally {
    clearTimeout(timer);
  }
}
