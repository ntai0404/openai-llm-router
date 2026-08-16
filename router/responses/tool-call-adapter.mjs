import crypto from "node:crypto";

import {
  invalidRequest,
  malformedStructuredOutput
} from "./error-mapper.mjs";

const FUNCTION_NAME =
  /^[A-Za-z0-9_-]{1,64}$/;

const STRICT_SCHEMA_KEYS =
  new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "const",
    "description",
    "title",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "anyOf",
    "oneOf",
    "allOf"
  ]);

function isObject(value) {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function compactId(prefix) {
  return (
    `${prefix}_` +
    crypto
      .randomUUID()
      .replaceAll("-", "")
  );
}

function createToken() {
  return crypto
    .randomBytes(12)
    .toString("hex");
}

function assertFunctionName(
  name,
  param
) {
  if (
    typeof name !== "string" ||
    !FUNCTION_NAME.test(name)
  ) {
    throw invalidRequest(
      `${param} must be a valid function name.`,
      param,
      "invalid_function_name"
    );
  }
}

function assertStrictSchema(
  schema,
  param
) {
  if (
    schema === true ||
    schema === false
  ) {
    return;
  }

  if (!isObject(schema)) {
    throw invalidRequest(
      `${param} must be a JSON Schema object.`,
      param,
      "invalid_function_schema"
    );
  }

  for (const key of Object.keys(schema)) {
    if (
      !STRICT_SCHEMA_KEYS.has(key)
    ) {
      throw invalidRequest(
        `${param} uses unsupported strict-schema keyword "${key}".`,
        param,
        "unsupported_json_schema_keyword"
      );
    }
  }

  if (
    schema.type !== undefined
  ) {
    const allowed =
      new Set([
        "null",
        "boolean",
        "object",
        "array",
        "number",
        "integer",
        "string"
      ]);

    const types =
      Array.isArray(schema.type)
        ? schema.type
        : [schema.type];

    if (
      types.length === 0 ||
      types.some(
        type =>
          typeof type !== "string" ||
          !allowed.has(type)
      )
    ) {
      throw invalidRequest(
        `${param}.type is invalid.`,
        `${param}.type`,
        "invalid_function_schema"
      );
    }
  }

  if (
    schema.required !== undefined
  ) {
    if (
      !Array.isArray(
        schema.required
      ) ||
      schema.required.some(
        value =>
          typeof value !== "string"
      )
    ) {
      throw invalidRequest(
        `${param}.required must be an array of strings.`,
        `${param}.required`,
        "invalid_function_schema"
      );
    }
  }

  if (
    schema.properties !== undefined
  ) {
    if (
      !isObject(
        schema.properties
      )
    ) {
      throw invalidRequest(
        `${param}.properties must be an object.`,
        `${param}.properties`,
        "invalid_function_schema"
      );
    }

    for (
      const [name, child]
      of Object.entries(
        schema.properties
      )
    ) {
      assertStrictSchema(
        child,
        `${param}.properties.${name}`
      );
    }
  }

  if (
    schema.items !== undefined
  ) {
    assertStrictSchema(
      schema.items,
      `${param}.items`
    );
  }

  if (
    isObject(
      schema.additionalProperties
    )
  ) {
    assertStrictSchema(
      schema.additionalProperties,
      `${param}.additionalProperties`
    );
  }

  for (
    const keyword of
      ["anyOf", "oneOf", "allOf"]
  ) {
    if (
      schema[keyword] !== undefined
    ) {
      if (
        !Array.isArray(
          schema[keyword]
        ) ||
        schema[keyword].length === 0
      ) {
        throw invalidRequest(
          `${param}.${keyword} must be a non-empty schema array.`,
          `${param}.${keyword}`,
          "invalid_function_schema"
        );
      }

      schema[keyword].forEach(
        (child, index) =>
          assertStrictSchema(
            child,
            `${param}.${keyword}[${index}]`
          )
      );
    }
  }

  if (
    schema.pattern !== undefined
  ) {
    if (
      typeof schema.pattern !==
      "string"
    ) {
      throw invalidRequest(
        `${param}.pattern must be a string.`,
        `${param}.pattern`,
        "invalid_function_schema"
      );
    }

    try {
      new RegExp(
        schema.pattern
      );
    } catch {
      throw invalidRequest(
        `${param}.pattern is invalid.`,
        `${param}.pattern`,
        "invalid_function_schema"
      );
    }
  }
}

function matchesType(
  value,
  type
) {
  switch (type) {
    case "null":
      return value === null;

    case "boolean":
      return (
        typeof value ===
        "boolean"
      );

    case "object":
      return isObject(value);

    case "array":
      return Array.isArray(value);

    case "number":
      return (
        typeof value ===
          "number" &&
        Number.isFinite(value)
      );

    case "integer":
      return Number.isInteger(
        value
      );

    case "string":
      return (
        typeof value ===
        "string"
      );

    default:
      return false;
  }
}

function sameJsonValue(
  a,
  b
) {
  return (
    JSON.stringify(a) ===
    JSON.stringify(b)
  );
}

function validateAgainstSchema(
  value,
  schema,
  path = "$"
) {
  if (schema === true) {
    return [];
  }

  if (schema === false) {
    return [
      `${path} is rejected by schema.`
    ];
  }

  const errors = [];

  if (
    schema.allOf
  ) {
    for (
      const child
      of schema.allOf
    ) {
      errors.push(
        ...validateAgainstSchema(
          value,
          child,
          path
        )
      );
    }
  }

  if (
    schema.anyOf
  ) {
    const matched =
      schema.anyOf.some(
        child =>
          validateAgainstSchema(
            value,
            child,
            path
          ).length === 0
      );

    if (!matched) {
      errors.push(
        `${path} does not match any anyOf branch.`
      );
    }
  }

  if (
    schema.oneOf
  ) {
    const matched =
      schema.oneOf.filter(
        child =>
          validateAgainstSchema(
            value,
            child,
            path
          ).length === 0
      ).length;

    if (matched !== 1) {
      errors.push(
        `${path} must match exactly one oneOf branch.`
      );
    }
  }

  if (
    schema.type !== undefined
  ) {
    const types =
      Array.isArray(schema.type)
        ? schema.type
        : [schema.type];

    if (
      !types.some(
        type =>
          matchesType(
            value,
            type
          )
      )
    ) {
      errors.push(
        `${path} has the wrong type.`
      );

      return errors;
    }
  }

  if (
    schema.const !== undefined &&
    !sameJsonValue(
      value,
      schema.const
    )
  ) {
    errors.push(
      `${path} does not equal const.`
    );
  }

  if (
    Array.isArray(
      schema.enum
    ) &&
    !schema.enum.some(
      candidate =>
        sameJsonValue(
          value,
          candidate
        )
    )
  ) {
    errors.push(
      `${path} is not an allowed enum value.`
    );
  }

  if (isObject(value)) {
    const keys =
      Object.keys(value);

    if (
      Number.isInteger(
        schema.minProperties
      ) &&
      keys.length <
        schema.minProperties
    ) {
      errors.push(
        `${path} has too few properties.`
      );
    }

    if (
      Number.isInteger(
        schema.maxProperties
      ) &&
      keys.length >
        schema.maxProperties
    ) {
      errors.push(
        `${path} has too many properties.`
      );
    }

    if (
      Array.isArray(
        schema.required
      )
    ) {
      for (
        const name
        of schema.required
      ) {
        if (!(name in value)) {
          errors.push(
            `${path}.${name} is required.`
          );
        }
      }
    }

    const properties =
      isObject(
        schema.properties
      )
        ? schema.properties
        : {};

    for (
      const [name, childValue]
      of Object.entries(value)
    ) {
      if (
        name in properties
      ) {
        errors.push(
          ...validateAgainstSchema(
            childValue,
            properties[name],
            `${path}.${name}`
          )
        );

        continue;
      }

      if (
        schema.additionalProperties ===
        false
      ) {
        errors.push(
          `${path}.${name} is not allowed.`
        );

        continue;
      }

      if (
        isObject(
          schema.additionalProperties
        )
      ) {
        errors.push(
          ...validateAgainstSchema(
            childValue,
            schema.additionalProperties,
            `${path}.${name}`
          )
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (
      Number.isInteger(
        schema.minItems
      ) &&
      value.length <
        schema.minItems
    ) {
      errors.push(
        `${path} has too few items.`
      );
    }

    if (
      Number.isInteger(
        schema.maxItems
      ) &&
      value.length >
        schema.maxItems
    ) {
      errors.push(
        `${path} has too many items.`
      );
    }

    if (
      schema.items !== undefined
    ) {
      value.forEach(
        (item, index) => {
          errors.push(
            ...validateAgainstSchema(
              item,
              schema.items,
              `${path}[${index}]`
            )
          );
        }
      );
    }
  }

  if (
    typeof value ===
    "string"
  ) {
    if (
      Number.isInteger(
        schema.minLength
      ) &&
      value.length <
        schema.minLength
    ) {
      errors.push(
        `${path} is shorter than minLength.`
      );
    }

    if (
      Number.isInteger(
        schema.maxLength
      ) &&
      value.length >
        schema.maxLength
    ) {
      errors.push(
        `${path} is longer than maxLength.`
      );
    }

    if (
      typeof schema.pattern ===
        "string" &&
      !new RegExp(
        schema.pattern
      ).test(value)
    ) {
      errors.push(
        `${path} does not match pattern.`
      );
    }
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    if (
      typeof schema.minimum ===
        "number" &&
      value < schema.minimum
    ) {
      errors.push(
        `${path} is below minimum.`
      );
    }

    if (
      typeof schema.maximum ===
        "number" &&
      value > schema.maximum
    ) {
      errors.push(
        `${path} is above maximum.`
      );
    }

    if (
      typeof schema.exclusiveMinimum ===
        "number" &&
      value <=
        schema.exclusiveMinimum
    ) {
      errors.push(
        `${path} fails exclusiveMinimum.`
      );
    }

    if (
      typeof schema.exclusiveMaximum ===
        "number" &&
      value >=
        schema.exclusiveMaximum
    ) {
      errors.push(
        `${path} fails exclusiveMaximum.`
      );
    }
  }

  return errors;
}

function prepareTools(
  normalized
) {
  const names =
    new Set();

  return normalized.tools.map(
    (tool, index) => {
      if (
        tool.kind !==
        "function_tool"
      ) {
        throw invalidRequest(
          `Phase 4 browser execution only supports function tools; received "${tool.type}".`,
          `tools[${index}]`,
          "unsupported_tool_execution"
        );
      }

      assertFunctionName(
        tool.name,
        `tools[${index}].name`
      );

      if (
        names.has(
          tool.name
        )
      ) {
        throw invalidRequest(
          `Duplicate function tool "${tool.name}".`,
          `tools[${index}].name`,
          "duplicate_function_tool"
        );
      }

      names.add(
        tool.name
      );

      const strict =
        tool.strict === true;

      if (strict) {
        assertStrictSchema(
          tool.parameters ?? {},
          `tools[${index}].parameters`
        );
      }

      return {
        ...tool,
        strict
      };
    }
  );
}

function resolveToolChoice(
  normalized,
  tools
) {
  const choice =
    normalized.tool_choice;

  if (
    choice.kind === "mode"
  ) {
    if (
      choice.mode ===
        "required" &&
      tools.length === 0
    ) {
      throw invalidRequest(
        "tool_choice=required requires at least one function tool.",
        "tool_choice",
        "tool_choice_requires_tools"
      );
    }

    return {
      mode:
        choice.mode
    };
  }

  const raw =
    choice.public_value;

  if (
    !isObject(raw) ||
    raw.type !==
      "function" ||
    typeof raw.name !==
      "string"
  ) {
    throw invalidRequest(
      "Phase 4 supports specific tool_choice as {type:'function', name:'...'}.",
      "tool_choice",
      "unsupported_tool_choice"
    );
  }

  assertFunctionName(
    raw.name,
    "tool_choice.name"
  );

  if (
    !tools.some(
      tool =>
        tool.name ===
        raw.name
    )
  ) {
    throw invalidRequest(
      `tool_choice references unknown function "${raw.name}".`,
      "tool_choice.name",
      "unknown_tool_choice"
    );
  }

  return {
    mode:
      "specific",
    name:
      raw.name
  };
}

export function renderFunctionCallOutput(
  item,
  param = "input"
) {
  if (
    item.kind !==
    "function_call_output"
  ) {
    return null;
  }

  let text;

  if (
    item.output.kind ===
    "text"
  ) {
    text =
      item.output.text;
  } else if (
    item.output.kind ===
    "content"
  ) {
    const parts = [];

    item.output.content.forEach(
      (part, index) => {
        if (
          part.kind !== "text"
        ) {
          throw invalidRequest(
            "Phase 4 browser execution supports text function_call_output content only.",
            `${param}.output[${index}]`,
            "function_call_output_attachment_not_implemented"
          );
        }

        parts.push(
          part.text
        );
      }
    );

    text =
      parts.join("\n");
  } else {
    throw invalidRequest(
      "Invalid normalized function_call_output.",
      param,
      "invalid_function_call_output"
    );
  }

  return [
    `[function_call_output call_id=${item.call_id}]`,
    text
  ].join("\n");
}

export function buildToolProtocol(
  normalized,
  {
    token =
      createToken()
  } = {}
) {
  const tools =
    prepareTools(
      normalized
    );

  const choice =
    resolveToolChoice(
      normalized,
      tools
    );

  if (
    tools.length === 0 ||
    choice.mode === "none"
  ) {
    return null;
  }

  const start =
    `ROUTER_TOOL_V1_BEGIN_${token}`;

  const end =
    `ROUTER_TOOL_V1_END_${token}`;

  const toolDefinitions =
    tools.map(
      tool => ({
        type:
          "function",
        name:
          tool.name,
        description:
          tool.description ?? "",
        parameters:
          tool.parameters ?? {},
        strict:
          tool.strict
      })
    );

  let choiceInstruction =
    "You may either answer normally or emit one or more function-call requests for the external router.";

  if (
    choice.mode ===
    "required"
  ) {
    choiceInstruction =
      "You MUST emit at least one function-call request for the external router.";
  }

  if (
    choice.mode ===
    "specific"
  ) {
    choiceInstruction =
      `You MUST emit a function-call request selecting function "${choice.name}" for the external router.`;
  }

  const parallelInstruction =
    normalized.parallel_tool_calls
      ? "Multiple function calls are allowed."
      : "You may return at most one function call.";

  const prompt = [
    "[router_internal_protocol]",
    "ROUTER_SERIALIZATION_ONLY_V1",
    "This is a routing and serialization task. Do not execute the listed functions inside ChatGPT.",
    "The functions described below belong to an EXTERNAL ROUTER/CLIENT, not to ChatGPT native tools.",
    "It is expected that these functions are not exposed as executable tools in this ChatGPT UI.",
    "Never report a function as unavailable merely because ChatGPT cannot execute it natively.",
    "Never check whether a requested file exists in ChatGPT's own filesystem.",
    "Never attempt to read, edit, or execute the requested resource yourself when a function call is required.",
    "Your job is only to serialize the requested external-router function call using the exact protocol below.",
    "The external client will execute that function after receiving your serialized function call.",
    "Prior function_call_output items are trusted results returned by that external client.",
    "If tool_choice specifies a function, request exactly that function with schema-valid arguments.",
    "For read_file({\"path\":\"compat-target.txt\"}), you do not need access to compat-target.txt yourself.",
    "Do not answer the underlying task directly while a required external-router function call is pending.",
    "Output only the required ROUTER_TOOL_V1 envelope when a function call is required.",
    "END_ROUTER_SERIALIZATION_ONLY_V1",
    "The following instructions define the machine-readable response format required by the compatibility router.",
    "Your ENTIRE response must be exactly:",
    start,
    "<one JSON object>",
    end,
    "",
    "Do not use markdown or code fences.",
    "Do not output anything before or after the markers.",
    "",
    "Normal message JSON:",
    '{"type":"message","text":"answer"}',
    "",
    "External-router function request JSON:",
    '{"type":"function_calls","calls":[{"name":"function_name","arguments":{"key":"value"}}]}',
    "",
    "arguments must be a JSON object.",
    "Never invent a function name.",
    "The listed functions are available to the EXTERNAL ROUTER. They are not native tools of this ChatGPT page.",
    "Do NOT try to execute a function yourself.",
    "Do NOT say that a listed function is unavailable.",
    "A function_calls JSON object means: request that the external router execute the selected function.",
    choiceInstruction,
    parallelInstruction,
    `tool_choice=${JSON.stringify(choice)}`,
    `function_tools=${JSON.stringify(toolDefinitions)}`,
    "[/router_internal_protocol]"
  ].join("\n");

  return {
    token,
    start,
    end,
    choice,
    tools,
    parallel_tool_calls:
      normalized.parallel_tool_calls,
    prompt
  };
}

export function parseToolProtocolOutput(
  outputText,
  protocol
) {
  if (
    typeof outputText !==
    "string"
  ) {
    throw malformedStructuredOutput(
      "Tool protocol output was not text."
    );
  }

  const text =
    outputText.trim();

  if (
    !text.startsWith(
      protocol.start
    ) ||
    !text.endsWith(
      protocol.end
    )
  ) {
    throw malformedStructuredOutput(
      "Model output did not contain the exact router tool protocol envelope."
    );
  }

  const jsonText =
    text
      .slice(
        protocol.start.length,
        text.length -
          protocol.end.length
      )
      .trim();

  if (
    jsonText.includes(
      protocol.start
    ) ||
    jsonText.includes(
      protocol.end
    )
  ) {
    throw malformedStructuredOutput(
      "Duplicate router tool protocol markers were returned."
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(
        jsonText
      );
  } catch {
    throw malformedStructuredOutput(
      "Router tool protocol payload was not valid JSON."
    );
  }

  if (!isObject(payload)) {
    throw malformedStructuredOutput(
      "Router tool protocol payload must be a JSON object."
    );
  }

  if (
    payload.type ===
    "message"
  ) {
    if (
      protocol.choice.mode ===
        "required" ||
      protocol.choice.mode ===
        "specific"
    ) {
      throw malformedStructuredOutput(
        "tool_choice required a function call but the model returned a message."
      );
    }

    if (
      typeof payload.text !==
      "string"
    ) {
      throw malformedStructuredOutput(
        "message.text must be a string."
      );
    }

    return {
      kind:
        "message",
      output_text:
        payload.text
    };
  }

  let rawCalls;

  if (
    payload.type ===
    "function_calls"
  ) {
    rawCalls =
      payload.calls;
  } else if (
    payload.type ===
    "function_call"
  ) {
    rawCalls = [
      {
        name:
          payload.name,
        arguments:
          payload.arguments
      }
    ];
  } else {
    throw malformedStructuredOutput(
      `Unsupported protocol type "${String(payload.type)}".`
    );
  }

  if (
    !Array.isArray(rawCalls) ||
    rawCalls.length === 0
  ) {
    throw malformedStructuredOutput(
      "At least one function call is required."
    );
  }

  if (
    !protocol.parallel_tool_calls &&
    rawCalls.length > 1
  ) {
    throw malformedStructuredOutput(
      "parallel_tool_calls=false permits only one function call."
    );
  }

  const toolMap =
    new Map(
      protocol.tools.map(
        tool => [
          tool.name,
          tool
        ]
      )
    );

  const calls =
    rawCalls.map(
      (rawCall, index) => {
        if (!isObject(rawCall)) {
          throw malformedStructuredOutput(
            `Function call ${index} must be an object.`
          );
        }

        if (
          typeof rawCall.name !==
            "string" ||
          !FUNCTION_NAME.test(
            rawCall.name
          )
        ) {
          throw malformedStructuredOutput(
            `Function call ${index} has an invalid name.`
          );
        }

        const tool =
          toolMap.get(
            rawCall.name
          );

        if (!tool) {
          throw malformedStructuredOutput(
            `Unknown function "${rawCall.name}".`
          );
        }

        if (
          protocol.choice.mode ===
            "specific" &&
          rawCall.name !==
            protocol.choice.name
        ) {
          throw malformedStructuredOutput(
            `tool_choice required "${protocol.choice.name}", but "${rawCall.name}" was returned.`
          );
        }

        if (
          !isObject(
            rawCall.arguments
          )
        ) {
          throw malformedStructuredOutput(
            `Arguments for "${rawCall.name}" must be a JSON object.`
          );
        }

        if (tool.strict) {
          const errors =
            validateAgainstSchema(
              rawCall.arguments,
              tool.parameters ?? {}
            );

          if (
            errors.length > 0
          ) {
            throw malformedStructuredOutput(
              `Arguments for "${rawCall.name}" failed strict schema validation: ${errors.slice(0, 4).join(" ")}`
            );
          }
        }

        return {
          item_id:
            compactId("fc"),
          call_id:
            compactId("call"),
          name:
            rawCall.name,
          arguments:
            JSON.stringify(
              rawCall.arguments
            )
        };
      }
    );

  return {
    kind:
      "function_calls",
    output_text:
      "",
    calls
  };
}
