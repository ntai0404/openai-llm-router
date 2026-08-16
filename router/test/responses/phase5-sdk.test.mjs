import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import OpenAI from "openai";

import {
  buildBrowserExecutionRequest
} from "../../responses/execution-adapter.mjs";

import {
  malformedStructuredOutput
} from "../../responses/error-mapper.mjs";

import {
  normalizeResponsesRequest
} from "../../responses/request-normalizer.mjs";

import {
  handleResponsesRoute
} from "../../responses/responses-router.mjs";

import {
  buildToolProtocol,
  parseToolProtocolOutput
} from "../../responses/tool-call-adapter.mjs";

async function withServer(
  options,
  fn
) {
  const server =
    http.createServer(
      async (
        req,
        res
      ) => {
        const handled =
          await handleResponsesRoute(
            req,
            res,
            options
          );

        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      }
    );

  await new Promise(
    resolve =>
      server.listen(
        0,
        "127.0.0.1",
        resolve
      )
  );

  const { port } =
    server.address();

  try {
    return await fn(
      `http://127.0.0.1:${port}`
    );
  } finally {
    await new Promise(
      resolve =>
        server.close(
          resolve
        )
    );
  }
}

function sdk(
  baseUrl,
  apiKey = "secret"
) {
  return new OpenAI({
    apiKey,
    baseURL:
      `${baseUrl}/v1`,
    maxRetries:
      0,
    timeout:
      5000
  });
}

function toolDefinition() {
  return {
    type:
      "function",
    name:
      "lookup",
    description:
      "Lookup a color code.",
    parameters: {
      type:
        "object",
      properties: {
        code: {
          type:
            "string",
          enum: [
            "RED",
            "BLUE"
          ]
        }
      },
      required: [
        "code"
      ],
      additionalProperties:
        false
    },
    strict:
      true
  };
}

test(
  "official OpenAI SDK performs non-stream Responses request",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async normalized => {
            assert.equal(
              normalized.requested_model,
              "sdk-model"
            );

            assert.equal(
              normalized.input[0].kind,
              "message"
            );

            return {
              kind:
                "message",
              output_text:
                "SDK TEXT OK",
              backend_job_id:
                "job_sdk_text"
            };
          }
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        const response =
          await client.responses.create({
            model:
              "sdk-model",
            input:
              "hello"
          });

        assert.equal(
          response.object,
          "response"
        );

        assert.equal(
          response.status,
          "completed"
        );

        assert.equal(
          response.output_text,
          "SDK TEXT OK"
        );

        assert.equal(
          response.output[0].type,
          "message"
        );
      }
    );
  }
);

test(
  "official OpenAI SDK consumes Responses SSE stream",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async () => ({
            kind:
              "message",
            output_text:
              "SDK STREAM OK",
            backend_job_id:
              "job_sdk_stream"
          })
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        const stream =
          await client.responses.create({
            model:
              "sdk-model",
            input:
              "stream",
            stream:
              true
          });

        const events = [];
        let text = "";

        for await (
          const event
          of stream
        ) {
          events.push(
            event.type
          );

          if (
            event.type ===
            "response.output_text.delta"
          ) {
            text +=
              event.delta;
          }
        }

        assert.equal(
          text,
          "SDK STREAM OK"
        );

        assert.ok(
          events.includes(
            "response.created"
          )
        );

        assert.ok(
          events.includes(
            "response.completed"
          )
        );
      }
    );
  }
);

test(
  "official OpenAI SDK receives function_call output item",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async normalized => {
            assert.equal(
              normalized.tools[0].name,
              "lookup"
            );

            return {
              kind:
                "function_calls",
              output_text:
                "",
              backend_job_id:
                "job_sdk_tool",
              calls: [
                {
                  item_id:
                    "fc_sdk",
                  call_id:
                    "call_sdk",
                  name:
                    "lookup",
                  arguments:
                    '{"code":"RED"}'
                }
              ]
            };
          }
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        const response =
          await client.responses.create({
            model:
              "sdk-model",
            input:
              "lookup RED",
            tools: [
              toolDefinition()
            ],
            tool_choice:
              "required",
            parallel_tool_calls:
              false
          });

        assert.equal(
          response.output[0].type,
          "function_call"
        );

        assert.equal(
          response.output[0].call_id,
          "call_sdk"
        );

        assert.equal(
          response.output[0].name,
          "lookup"
        );

        assert.equal(
          response.output[0].arguments,
          '{"code":"RED"}'
        );
      }
    );
  }
);

test(
  "official OpenAI SDK sends function_call_output input item",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async normalized => {
            assert.equal(
              normalized.input[0].kind,
              "function_call_output"
            );

            assert.equal(
              normalized.input[0].call_id,
              "call_sdk"
            );

            assert.equal(
              normalized.input[0].output.kind,
              "text"
            );

            assert.equal(
              normalized.input[0].output.text,
              "TOOL RESULT"
            );

            return {
              kind:
                "message",
              output_text:
                "ROUND TRIP OK"
            };
          }
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        const response =
          await client.responses.create({
            model:
              "sdk-model",

            input: [
              {
                type:
                  "function_call_output",
                call_id:
                  "call_sdk",
                output:
                  "TOOL RESULT"
              }
            ]
          });

        assert.equal(
          response.output_text,
          "ROUND TRIP OK"
        );
      }
    );
  }
);

test(
  "official OpenAI SDK sends input_image data URL structure",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async normalized => {
            const part =
              normalized
                .input[0]
                .content[1];

            assert.equal(
              part.kind,
              "attachment"
            );

            assert.equal(
              part.attachment.kind,
              "image"
            );

            assert.equal(
              part.attachment.source.type,
              "data_url"
            );

            return {
              kind:
                "message",
              output_text:
                "IMAGE STRUCTURE OK"
            };
          }
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        const response =
          await client.responses.create({
            model:
              "sdk-model",

            input: [
              {
                role:
                  "user",

                content: [
                  {
                    type:
                      "input_text",
                    text:
                      "inspect"
                  },
                  {
                    type:
                      "input_image",
                    image_url:
                      "data:image/png;base64,AAAA",
                    detail:
                      "high"
                  }
                ]
              }
            ]
          });

        assert.equal(
          response.output_text,
          "IMAGE STRUCTURE OK"
        );
      }
    );
  }
);

test(
  "official OpenAI SDK receives standardized authentication error",
  async () => {
    await withServer(
      {
        apiKey:
          "correct-secret",

        execute:
          async () => ({
            output_text:
              "unused"
          })
      },

      async baseUrl => {
        const client =
          sdk(
            baseUrl,
            "wrong-secret"
          );

        await assert.rejects(
          () =>
            client.responses.create({
              model:
                "sdk-model",
              input:
                "hello"
            }),

          error =>
            error.status === 401
        );
      }
    );
  }
);

test(
  "official OpenAI SDK receives malformed structured output as HTTP error",
  async () => {
    await withServer(
      {
        apiKey:
          "secret",

        execute:
          async () => {
            throw malformedStructuredOutput(
              "simulated malformed tool output"
            );
          }
      },

      async baseUrl => {
        const client =
          sdk(baseUrl);

        await assert.rejects(
          () =>
            client.responses.create({
              model:
                "sdk-model",
              input:
                "hello"
            }),

          error =>
            error.status === 502
        );
      }
    );
  }
);

test(
  "duplicate function names are rejected before browser execution",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "test",

        input:
          "hello",

        tools: [
          toolDefinition(),
          toolDefinition()
        ]
      });

    assert.throws(
      () =>
        buildBrowserExecutionRequest(
          normalized
        ),

      error =>
        error.code ===
        "duplicate_function_tool"
    );
  }
);

test(
  "unknown specific tool_choice is rejected before browser execution",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "test",

        input:
          "hello",

        tools: [
          toolDefinition()
        ],

        tool_choice: {
          type:
            "function",
          name:
            "missing_tool"
        }
      });

    assert.throws(
      () =>
        buildBrowserExecutionRequest(
          normalized
        ),

      error =>
        error.code ===
        "unknown_tool_choice"
    );
  }
);

test(
  "non-function browser tools remain explicitly unsupported",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "test",

        input:
          "hello",

        tools: [
          {
            type:
              "web_search"
          }
        ]
      });

    assert.throws(
      () =>
        buildBrowserExecutionRequest(
          normalized
        ),

      error =>
        error.code ===
        "unsupported_tool_execution"
    );
  }
);

test(
  "parallel function calls can be validated when enabled",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "test",

        input:
          "lookup RED and BLUE",

        tools: [
          toolDefinition()
        ],

        tool_choice:
          "required",

        parallel_tool_calls:
          true
      });

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "phase5"
        }
      );

    const output = [
      protocol.start,
      JSON.stringify({
        type:
          "function_calls",

        calls: [
          {
            name:
              "lookup",
            arguments: {
              code:
                "RED"
            }
          },
          {
            name:
              "lookup",
            arguments: {
              code:
                "BLUE"
            }
          }
        ]
      }),
      protocol.end
    ].join("\n");

    const parsed =
      parseToolProtocolOutput(
        output,
        protocol
      );

    assert.equal(
      parsed.calls.length,
      2
    );
  }
);

test(
  "tool protocol explicitly requests external-router execution",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "test",

        input:
          "Use lookup.",

        tools: [
          toolDefinition()
        ],

        tool_choice: {
          type:
            "function",
          name:
            "lookup"
        },

        parallel_tool_calls:
          false
      });

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "phase5prompt"
        }
      );

    assert.match(
      protocol.prompt,
      /EXTERNAL ROUTER/
    );

    assert.match(
      protocol.prompt,
      /Do NOT try to execute a function yourself/
    );

    assert.match(
      protocol.prompt,
      /Do NOT say that a listed function is unavailable/
    );

    assert.match(
      protocol.prompt,
      /emit a function-call request selecting function/
    );

    assert.doesNotMatch(
      protocol.prompt,
      /You MUST call function/
    );
  }
);