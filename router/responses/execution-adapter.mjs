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

function buildBrowserExecutionRequestBase(
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


/*
  DOM-safe tool transport wrapper.

  Important:
  - forward every original argument unchanged;
  - do not infer tool execution merely from tools.length;
  - append only when the existing tool adapter actually emitted
    a ROUTER_TOOL_V1 protocol envelope instruction.
*/
export function buildBrowserExecutionRequest(
  ...args
) {
  const request =
    buildBrowserExecutionRequestBase(
      ...args
    );

  const hasToolProtocol =
    typeof request?.input === "string" &&
    request.input.includes(
      "ROUTER_TOOL_V1_BEGIN_"
    );

  if (hasToolProtocol) {
    const transport =
      [
        "[router_dom_transport]",
        "ROUTER_DOM_TRANSPORT_WRAPPER_V2",
        "This is the FINAL formatting and transport instruction.",
        "This final transport instruction overrides any earlier instruction that says not to use a code fence, but changes no other tool protocol rule.",
        "Render the ENTIRE ROUTER_TOOL_V1 response inside exactly one fenced code block.",
        "Use a fenced code block with language text.",
        "The ROUTER_TOOL_V1_BEGIN marker, JSON payload, and matching ROUTER_TOOL_V1_END marker must all be inside the same fenced code block.",
        "Do not emit prose outside the fenced code block.",
        "Inside the fenced code block, emit strict JSON accepted directly by JSON.parse.",
        "Preserve JSON backslashes literally in rendered browser text.",
        "Any double quote inside a JSON string value must remain JSON-escaped as backslash-double-quote.",
        "[/router_dom_transport]"
      ].join("\n");

    request.input =
      [
        request.input,
        transport
      ]
        .filter(Boolean)
        .join("\n\n");
  }

  return request;
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
