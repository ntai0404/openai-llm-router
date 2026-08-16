import {
  MESSAGE_ROLES,
  TOOL_CHOICE_MODES,
  isPlainObject
} from "./responses-types.mjs";

import {
  invalidRequest
} from "./error-mapper.mjs";

function requireString(
  value,
  param,
  { allowEmpty = false } = {}
) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim() === "")
  ) {
    throw invalidRequest(
      `${param} must be a ${allowEmpty ? "string" : "non-empty string"}.`,
      param
    );
  }

  return value;
}

function normalizeTextPart(part, param) {
  return {
    kind: "text",
    source_type: "input_text",
    text: requireString(
      part.text,
      `${param}.text`,
      { allowEmpty: true }
    )
  };
}

function normalizeImagePart(part, param) {
  const detail =
    part.detail ?? "auto";

  if (
    ![
      "auto",
      "low",
      "high"
    ].includes(detail)
  ) {
    throw invalidRequest(
      `${param}.detail must be one of auto, low, or high.`,
      `${param}.detail`
    );
  }

  const hasImageUrl =
    typeof part.image_url === "string" &&
    part.image_url.length > 0;

  const hasFileId =
    typeof part.file_id === "string" &&
    part.file_id.length > 0;

  if (!hasImageUrl && !hasFileId) {
    throw invalidRequest(
      `${param} requires image_url or file_id.`,
      param
    );
  }

  let source;

  if (hasImageUrl) {
    source =
      part.image_url.startsWith("data:")
        ? {
            type: "data_url",
            data_url: part.image_url
          }
        : {
            type: "url",
            url: part.image_url
          };
  } else {
    source = {
      type: "file_id",
      file_id: part.file_id
    };
  }

  return {
    kind: "attachment",
    attachment: {
      kind: "image",
      source,
      detail
    }
  };
}

function normalizeFilePart(part, param) {
  const candidates = [
    ["file_data", part.file_data],
    ["file_id", part.file_id],
    ["file_url", part.file_url]
  ].filter(
    ([, value]) =>
      typeof value === "string" &&
      value.length > 0
  );

  if (candidates.length === 0) {
    throw invalidRequest(
      `${param} requires file_data, file_id, or file_url.`,
      param
    );
  }

  const [sourceType, value] =
    candidates[0];

  const source =
    sourceType === "file_data"
      ? {
          type: "data",
          data: value
        }
      : sourceType === "file_id"
        ? {
            type: "file_id",
            file_id: value
          }
        : {
            type: "url",
            url: value
          };

  if (
    part.filename !== undefined &&
    typeof part.filename !== "string"
  ) {
    throw invalidRequest(
      `${param}.filename must be a string.`,
      `${param}.filename`
    );
  }

  return {
    kind: "attachment",
    attachment: {
      kind: "file",
      source,
      ...(part.filename
        ? {
            filename: part.filename
          }
        : {})
    }
  };
}

export function normalizeContentPart(
  part,
  param
) {
  if (!isPlainObject(part)) {
    throw invalidRequest(
      `${param} must be an object.`,
      param
    );
  }

  switch (part.type) {
    case "input_text":
      return normalizeTextPart(
        part,
        param
      );

    case "input_image":
      return normalizeImagePart(
        part,
        param
      );

    case "input_file":
      return normalizeFilePart(
        part,
        param
      );

    default:
      throw invalidRequest(
        `Unsupported input content type: ${String(part.type)}.`,
        `${param}.type`,
        "unsupported_content_type"
      );
  }
}

function normalizeContent(
  content,
  param
) {
  if (typeof content === "string") {
    return [
      {
        kind: "text",
        source_type: "input_text",
        text: content
      }
    ];
  }

  if (
    !Array.isArray(content) ||
    content.length === 0
  ) {
    throw invalidRequest(
      `${param} must be a string or non-empty content array.`,
      param
    );
  }

  return content.map(
    (part, index) =>
      normalizeContentPart(
        part,
        `${param}[${index}]`
      )
  );
}

function normalizeMessage(
  item,
  index,
  source = "input"
) {
  const param =
    `${source}[${index}]`;

  const role =
    item.role;

  if (!MESSAGE_ROLES.has(role)) {
    throw invalidRequest(
      `${param}.role must be one of user, assistant, system, or developer.`,
      `${param}.role`
    );
  }

  return {
    kind: "message",
    role,
    content: normalizeContent(
      item.content,
      `${param}.content`
    )
  };
}

function normalizeFunctionCallOutput(
  item,
  index
) {
  const param =
    `input[${index}]`;

  const callId =
    requireString(
      item.call_id,
      `${param}.call_id`
    );

  let output;

  if (
    typeof item.output === "string"
  ) {
    output = {
      kind: "text",
      text: item.output
    };
  } else if (
    Array.isArray(item.output)
  ) {
    output = {
      kind: "content",
      content:
        item.output.map(
          (part, partIndex) =>
            normalizeContentPart(
              part,
              `${param}.output[${partIndex}]`
            )
        )
    };
  } else {
    throw invalidRequest(
      `${param}.output must be a string or content array.`,
      `${param}.output`
    );
  }

  return {
    kind: "function_call_output",
    call_id: callId,
    output
  };
}

function normalizeInput(input) {
  if (typeof input === "string") {
    return [
      {
        kind: "message",
        role: "user",
        content: [
          {
            kind: "text",
            source_type: "input_text",
            text: input
          }
        ]
      }
    ];
  }

  if (
    !Array.isArray(input) ||
    input.length === 0
  ) {
    throw invalidRequest(
      "input must be a string or a non-empty array.",
      "input"
    );
  }

  return input.map(
    (item, index) => {
      if (!isPlainObject(item)) {
        throw invalidRequest(
          `input[${index}] must be an object.`,
          `input[${index}]`
        );
      }

      if (
        item.type ===
        "function_call_output"
      ) {
        return normalizeFunctionCallOutput(
          item,
          index
        );
      }

      if (
        item.type === undefined ||
        item.type === "message"
      ) {
        return normalizeMessage(
          item,
          index
        );
      }

      throw invalidRequest(
        `Unsupported input item type: ${String(item.type)}.`,
        `input[${index}].type`,
        "unsupported_input_item"
      );
    }
  );
}

function normalizeInstructions(
  instructions
) {
  if (
    instructions === undefined ||
    instructions === null
  ) {
    return null;
  }

  if (
    typeof instructions === "string"
  ) {
    return {
      kind: "instructions",
      public_value: instructions,
      items: [
        {
          kind: "message",
          role: "developer",
          content: [
            {
              kind: "text",
              source_type:
                "input_text",
              text: instructions
            }
          ]
        }
      ]
    };
  }

  if (
    !Array.isArray(instructions) ||
    instructions.length === 0
  ) {
    throw invalidRequest(
      "instructions must be a string or non-empty message array.",
      "instructions"
    );
  }

  const items =
    instructions.map(
      (item, index) => {
        if (!isPlainObject(item)) {
          throw invalidRequest(
            `instructions[${index}] must be an object.`,
            `instructions[${index}]`
          );
        }

        return normalizeMessage(
          item,
          index,
          "instructions"
        );
      }
    );

  return {
    kind: "instructions",
    public_value: instructions,
    items
  };
}

function normalizeFunctionTool(
  tool,
  index
) {
  const param =
    `tools[${index}]`;

  if (
    tool.parameters !== undefined &&
    !isPlainObject(tool.parameters)
  ) {
    throw invalidRequest(
      `${param}.parameters must be a JSON object.`,
      `${param}.parameters`
    );
  }

  if (
    tool.strict !== undefined &&
    typeof tool.strict !== "boolean"
  ) {
    throw invalidRequest(
      `${param}.strict must be a boolean.`,
      `${param}.strict`
    );
  }

  return {
    kind: "function_tool",
    type: "function",
    name: requireString(
      tool.name,
      `${param}.name`
    ),
    ...(tool.description === undefined
      ? {}
      : {
          description:
            requireString(
              tool.description,
              `${param}.description`,
              { allowEmpty: true }
            )
        }),
    parameters:
      tool.parameters ?? {},
    ...(tool.strict === undefined
      ? {}
      : {
          strict: tool.strict
        }),
    public_value: {
      ...tool
    }
  };
}

function normalizeTools(tools) {
  if (
    tools === undefined ||
    tools === null
  ) {
    return [];
  }

  if (!Array.isArray(tools)) {
    throw invalidRequest(
      "tools must be an array.",
      "tools"
    );
  }

  return tools.map(
    (tool, index) => {
      if (
        !isPlainObject(tool) ||
        typeof tool.type !== "string"
      ) {
        throw invalidRequest(
          `tools[${index}] must be an object with a type.`,
          `tools[${index}]`
        );
      }

      if (
        tool.type === "function"
      ) {
        return normalizeFunctionTool(
          tool,
          index
        );
      }

      return {
        kind: "tool",
        type: tool.type,
        public_value: {
          ...tool
        },
        execution_supported: false
      };
    }
  );
}

function normalizeToolChoice(
  toolChoice
) {
  if (
    toolChoice === undefined ||
    toolChoice === null
  ) {
    return {
      kind: "mode",
      mode: "auto",
      public_value: "auto"
    };
  }

  if (
    typeof toolChoice === "string"
  ) {
    if (
      !TOOL_CHOICE_MODES.has(
        toolChoice
      )
    ) {
      throw invalidRequest(
        "tool_choice must be none, auto, required, or a tool-choice object.",
        "tool_choice"
      );
    }

    return {
      kind: "mode",
      mode: toolChoice,
      public_value: toolChoice
    };
  }

  if (!isPlainObject(toolChoice)) {
    throw invalidRequest(
      "tool_choice must be a string or object.",
      "tool_choice"
    );
  }

  return {
    kind: "object",
    public_value:
      structuredClone(
        toolChoice
      )
  };
}

export function normalizeResponsesRequest(
  body
) {
  if (!isPlainObject(body)) {
    throw invalidRequest(
      "Request body must be a JSON object.",
      null
    );
  }

  const requestedModel =
    requireString(
      body.model,
      "model"
    );

  if (
    body.stream !== undefined &&
    typeof body.stream !== "boolean"
  ) {
    throw invalidRequest(
      "stream must be a boolean.",
      "stream"
    );
  }

  if (
    body.parallel_tool_calls !==
      undefined &&
    typeof body.parallel_tool_calls !==
      "boolean"
  ) {
    throw invalidRequest(
      "parallel_tool_calls must be a boolean.",
      "parallel_tool_calls"
    );
  }

  return {
    kind: "responses_request",
    requested_model:
      requestedModel,
    instructions:
      normalizeInstructions(
        body.instructions
      ),
    input:
      normalizeInput(
        body.input
      ),
    tools:
      normalizeTools(
        body.tools
      ),
    tool_choice:
      normalizeToolChoice(
        body.tool_choice
      ),
    parallel_tool_calls:
      body.parallel_tool_calls ??
      true,
    stream:
      body.stream ?? false
  };
}
