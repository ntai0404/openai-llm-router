import crypto from "node:crypto";

function compactId(prefix) {
  return (
    `${prefix}_` +
    crypto
      .randomUUID()
      .replaceAll("-", "")
  );
}

export function createResponseContext(
  now = Date.now()
) {
  return {
    response_id:
      compactId("resp"),
    message_id:
      compactId("msg"),
    created_at:
      Math.floor(
        now / 1000
      )
  };
}

function publicInstructions(
  normalized
) {
  return (
    normalized.instructions
      ?.public_value ??
    null
  );
}

function publicTools(
  normalized
) {
  return normalized.tools.map(
    tool =>
      tool.public_value
  );
}

function baseResponse(
  normalized,
  context
) {
  return {
    id:
      context.response_id,
    object:
      "response",
    created_at:
      context.created_at,
    error:
      null,
    incomplete_details:
      null,
    instructions:
      publicInstructions(
        normalized
      ),
    model:
      "chatgpt-web-unverified",
    parallel_tool_calls:
      normalized.parallel_tool_calls,
    tool_choice:
      normalized
        .tool_choice
        .public_value,
    tools:
      publicTools(
        normalized
      ),
    usage:
      null,
    router: {
      backend:
        "chatgpt-web",
      requested_model:
        normalized.requested_model,
      model_selection_verified:
        false
    }
  };
}

export function createInProgressMessage(
  context
) {
  return {
    id:
      context.message_id,
    type:
      "message",
    status:
      "in_progress",
    role:
      "assistant",
    content:
      []
  };
}

export function createCompletedMessage(
  context,
  outputText
) {
  return {
    id:
      context.message_id,
    type:
      "message",
    status:
      "completed",
    role:
      "assistant",
    content: [
      {
        type:
          "output_text",
        text:
          outputText,
        annotations:
          []
      }
    ]
  };
}

export function createInProgressFunctionCall(
  call
) {
  return {
    id:
      call.item_id,
    type:
      "function_call",
    status:
      "in_progress",
    arguments:
      "",
    call_id:
      call.call_id,
    name:
      call.name
  };
}

export function createCompletedFunctionCall(
  call
) {
  return {
    id:
      call.item_id,
    type:
      "function_call",
    status:
      "completed",
    arguments:
      call.arguments,
    call_id:
      call.call_id,
    name:
      call.name
  };
}

export function encodeCreatedResponse(
  normalized,
  context
) {
  const base =
    baseResponse(
      normalized,
      context
    );

  return {
    ...base,
    status:
      "in_progress",
    completed_at:
      null,
    output:
      [],
    router: {
      ...base.router,
      backend_job_id:
        null
    }
  };
}

export function encodeCompletedResponse(
  normalized,
  executionResult,
  now = Date.now(),
  suppliedContext = null
) {
  const context =
    suppliedContext ??
    createResponseContext(
      now
    );

  const isFunctionCalls =
    executionResult.kind ===
    "function_calls";

  const output =
    isFunctionCalls
      ? executionResult.calls.map(
          call =>
            createCompletedFunctionCall(
              call
            )
        )
      : [
          createCompletedMessage(
            context,
            executionResult.output_text ?? ""
          )
        ];

  const outputText =
    isFunctionCalls
      ? ""
      : (
          executionResult.output_text ??
          ""
        );

  const base =
    baseResponse(
      normalized,
      context
    );

  return {
    ...base,
    completed_at:
      Math.floor(
        now / 1000
      ),
    status:
      "completed",
    output,
    output_text:
      outputText,
    router: {
      ...base.router,
      backend_job_id:
        executionResult.backend_job_id ??
        null
    }
  };
}
