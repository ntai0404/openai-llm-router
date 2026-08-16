import {
  backendUnavailable,
  invalidRequest,
  requestTimeout
} from "./error-mapper.mjs";

import {
  collectBrowserAttachments
} from "./attachment-adapter.mjs";

import {
  buildToolProtocol,
  parseToolProtocolOutput,
  renderFunctionCallOutput
} from "./tool-call-adapter.mjs";

function renderMessage(item) {
  const text =
    item.content
      .filter(
        part =>
          part.kind === "text"
      )
      .map(
        part =>
          part.text
      )
      .join("\n");

  return `[${item.role}]\n${text}`;
}

function renderItems(
  items,
  rootParam
) {
  return items
    .map(
      (item, index) => {
        if (
          item.kind ===
          "message"
        ) {
          return renderMessage(
            item
          );
        }
        if (
          item.kind ===
          "function_call"
        ) {
          return [
            `[function_call call_id=${item.call_id} name=${item.name}]`,
            item.arguments
          ].join("\n");
        }


        if (
          item.kind ===
          "function_call_output"
        ) {
          return renderFunctionCallOutput(
            item,
            `${rootParam}[${index}]`
          );
        }

        return null;
      }
    )
    .filter(Boolean)
    .join("\n\n");
}

export function buildBrowserExecutionRequest(
  normalized,
  options = {}
) {
  const sections = [];

  if (
    normalized.instructions
      ?.items?.length
  ) {
    sections.push(
      renderItems(
        normalized.instructions.items,
        "instructions"
      )
    );
  }

  sections.push(
    renderItems(
      normalized.input,
      "input"
    )
  );

  const toolProtocol =
    buildToolProtocol(
      normalized,
      options.toolProtocol ?? {}
    );

  if (toolProtocol) {
    sections.push(
      toolProtocol.prompt
    );
  }

  const input =
    sections
      .filter(Boolean)
      .join("\n\n");

  const attachments =
    collectBrowserAttachments(
      normalized
    );

  if (
    !input &&
    attachments.length === 0
  ) {
    throw invalidRequest(
      "The request contains no executable text or attachments.",
      "input"
    );
  }

  return {
    input,
    attachments,
    tool_protocol:
      toolProtocol
  };
}

export function buildBrowserExecutionInput(
  normalized
) {
  return buildBrowserExecutionRequest(
    normalized
  ).input;
}

function backendErrorMessage(
  payload,
  fallback
) {
  if (
    typeof payload?.error ===
    "string"
  ) {
    return payload.error;
  }

  if (
    typeof payload?.error?.message ===
    "string"
  ) {
    return payload.error.message;
  }

  return fallback;
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

    timeoutMs =
      300000,

    toolProtocol =
      {}
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

  const executionRequest =
    buildBrowserExecutionRequest(
      normalized,
      {
        toolProtocol
      }
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
          method:
            "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              input:
                executionRequest.input,

              attachments:
                executionRequest.attachments,

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
        response.status ===
        504
      ) {
        throw requestTimeout(
          backendErrorMessage(
            payload,
            "Execution backend timed out."
          )
        );
      }

      throw backendUnavailable(
        backendErrorMessage(
          payload,
          `Execution backend failed with HTTP ${response.status}.`
        )
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

    const parsed =
      executionRequest.tool_protocol
        ? parseToolProtocolOutput(
            payload.output_text,
            executionRequest.tool_protocol
          )
        : {
            kind:
              "message",
            output_text:
              payload.output_text
          };

    return {
      ...parsed,

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
