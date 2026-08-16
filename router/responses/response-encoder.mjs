import crypto from "node:crypto";

function compactId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function encodeCompletedResponse(
  normalized,
  executionResult,
  now = Date.now()
) {
  const createdAt =
    Math.floor(now / 1000);

  const messageId =
    compactId("msg");

  const outputText =
    executionResult.output_text;

  return {
    id:
      compactId("resp"),

    object:
      "response",

    created_at:
      createdAt,

    completed_at:
      createdAt,

    status:
      "completed",

    error:
      null,

    incomplete_details:
      null,

    instructions:
      normalized.instructions
        ?.public_value ??
      null,

    /*
      We intentionally do NOT echo the
      requested model as though browser
      model selection had been verified.
    */
    model:
      "chatgpt-web-unverified",

    output: [
      {
        id:
          messageId,

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

            annotations: []
          }
        ]
      }
    ],

    /*
      Convenience field requested by the
      router contract. Canonical content
      remains output[].
    */
    output_text:
      outputText,

    parallel_tool_calls:
      normalized
        .parallel_tool_calls,

    tool_choice:
      normalized
        .tool_choice
        .public_value,

    tools:
      normalized.tools.map(
        tool =>
          tool.public_value
      ),

    /*
      No token counts are available from
      the browser backend, so do not
      fabricate them.
    */
    usage:
      null,

    router: {
      backend:
        "chatgpt-web",

      requested_model:
        normalized
          .requested_model,

      model_selection_verified:
        false,

      backend_job_id:
        executionResult
          .backend_job_id ??
        null
    }
  };
}
