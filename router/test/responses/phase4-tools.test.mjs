import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  buildBrowserExecutionRequest,
  executeNormalizedRequest
} from "../../responses/execution-adapter.mjs";

import {
  normalizeResponsesRequest
} from "../../responses/request-normalizer.mjs";

import {
  encodeCompletedResponse
} from "../../responses/response-encoder.mjs";

import {
  handleResponsesRoute
} from "../../responses/responses-router.mjs";

import {
  buildToolProtocol,
  parseToolProtocolOutput
} from "../../responses/tool-call-adapter.mjs";

function request(
  overrides = {}
) {
  return {
    model:
      "gpt-test",

    input:
      "Use lookup with RED.",

    tools: [
      {
        type:
          "function",
        name:
          "lookup",
        description:
          "Lookup a color.",
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
      }
    ],

    tool_choice:
      "required",

    parallel_tool_calls:
      false,

    ...overrides
  };
}

function envelope(
  protocol,
  payload
) {
  return [
    protocol.start,
    JSON.stringify(payload),
    protocol.end
  ].join("\n");
}

test(
  "adds tool protocol only at browser execution boundary",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const built =
      buildBrowserExecutionRequest(
        normalized,
        {
          toolProtocol: {
            token:
              "abc123"
          }
        }
      );

    assert.match(
      built.input,
      /ROUTER_TOOL_V1_BEGIN_abc123/
    );

    assert.match(
      built.input,
      /"name":"lookup"/
    );

    assert.ok(
      built.tool_protocol
    );
  }
);

test(
  "parses valid strict function call",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t1"
        }
      );

    const parsed =
      parseToolProtocolOutput(
        envelope(
          protocol,
          {
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
              }
            ]
          }
        ),
        protocol
      );

    assert.equal(
      parsed.kind,
      "function_calls"
    );

    assert.equal(
      parsed.calls[0].name,
      "lookup"
    );

    assert.deepEqual(
      JSON.parse(
        parsed.calls[0].arguments
      ),
      {
        code:
          "RED"
      }
    );

    assert.match(
      parsed.calls[0].call_id,
      /^call_/
    );

    assert.match(
      parsed.calls[0].item_id,
      /^fc_/
    );
  }
);

test(
  "rejects arbitrary prompt-generated JSON without envelope",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t2"
        }
      );

    assert.throws(
      () =>
        parseToolProtocolOutput(
          '{"type":"function_calls","calls":[]}',
          protocol
        ),
      error =>
        error.code ===
        "malformed_structured_output"
    );
  }
);

test(
  "rejects unknown function name",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t3"
        }
      );

    assert.throws(
      () =>
        parseToolProtocolOutput(
          envelope(
            protocol,
            {
              type:
                "function_calls",
              calls: [
                {
                  name:
                    "invented",
                  arguments:
                    {}
                }
              ]
            }
          ),
          protocol
        ),
      error =>
        error.code ===
        "malformed_structured_output"
    );
  }
);

test(
  "rejects strict-schema argument violation",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t4"
        }
      );

    assert.throws(
      () =>
        parseToolProtocolOutput(
          envelope(
            protocol,
            {
              type:
                "function_calls",
              calls: [
                {
                  name:
                    "lookup",
                  arguments: {
                    code:
                      "GREEN"
                  }
                }
              ]
            }
          ),
          protocol
        ),
      error =>
        error.code ===
        "malformed_structured_output"
    );
  }
);

test(
  "required tool choice rejects message output",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t5"
        }
      );

    assert.throws(
      () =>
        parseToolProtocolOutput(
          envelope(
            protocol,
            {
              type:
                "message",
              text:
                "no tool"
            }
          ),
          protocol
        ),
      error =>
        error.code ===
        "malformed_structured_output"
    );
  }
);

test(
  "parallel_tool_calls false rejects multiple calls",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const protocol =
      buildToolProtocol(
        normalized,
        {
          token:
            "t6"
        }
      );

    assert.throws(
      () =>
        parseToolProtocolOutput(
          envelope(
            protocol,
            {
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
            }
          ),
          protocol
        ),
      error =>
        error.code ===
        "malformed_structured_output"
    );
  }
);

test(
  "tool_choice none preserves normal text execution",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request({
          tool_choice:
            "none"
        })
      );

    const built =
      buildBrowserExecutionRequest(
        normalized
      );

    assert.equal(
      built.tool_protocol,
      null
    );

    assert.doesNotMatch(
      built.input,
      /ROUTER_TOOL_V1/
    );
  }
);

test(
  "function_call_output reaches browser boundary as structured result",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        input: [
          {
            role:
              "user",
            content:
              "Use result."
          },
          {
            type:
              "function_call_output",
            call_id:
              "call_123",
            output:
              "RESULT-OK"
          }
        ]
      });

    const built =
      buildBrowserExecutionRequest(
        normalized
      );

    assert.match(
      built.input,
      /\[function_call_output call_id=call_123\]/
    );

    assert.match(
      built.input,
      /RESULT-OK/
    );
  }
);

test(
  "execution adapter converts validated browser output to function call",
  async () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const fetchImpl =
      async (
        url,
        options = {}
      ) => {
        if (
          String(url).endsWith(
            "/health"
          )
        ) {
          return new Response(
            JSON.stringify({
              extension_connected:
                true
            }),
            {
              status:
                200,
              headers: {
                "content-type":
                  "application/json"
              }
            }
          );
        }

        const body =
          JSON.parse(
            options.body
          );

        const match =
          body.input.match(
            /ROUTER_TOOL_V1_BEGIN_([0-9a-f]+)/
          );

        assert.ok(match);

        const token =
          match[1];

        return new Response(
          JSON.stringify({
            id:
              "job_tool",
            output_text: [
              `ROUTER_TOOL_V1_BEGIN_${token}`,
              '{"type":"function_calls","calls":[{"name":"lookup","arguments":{"code":"RED"}}]}',
              `ROUTER_TOOL_V1_END_${token}`
            ].join("\n")
          }),
          {
            status:
              200,
            headers: {
              "content-type":
                "application/json"
            }
          }
        );
      };

    const result =
      await executeNormalizedRequest(
        normalized,
        {
          fetchImpl,
          timeoutMs:
            5000
        }
      );

    assert.equal(
      result.kind,
      "function_calls"
    );

    assert.equal(
      result.calls[0].name,
      "lookup"
    );
  }
);

test(
  "response encoder creates Responses-style function_call item",
  () => {
    const normalized =
      normalizeResponsesRequest(
        request()
      );

    const response =
      encodeCompletedResponse(
        normalized,
        {
          kind:
            "function_calls",
          output_text:
            "",
          backend_job_id:
            "job_x",
          calls: [
            {
              item_id:
                "fc_x",
              call_id:
                "call_x",
              name:
                "lookup",
              arguments:
                '{"code":"RED"}'
            }
          ]
        }
      );

    assert.equal(
      response.output[0].type,
      "function_call"
    );

    assert.equal(
      response.output[0].id,
      "fc_x"
    );

    assert.equal(
      response.output[0].call_id,
      "call_x"
    );

    assert.equal(
      response.output[0].arguments,
      '{"code":"RED"}'
    );

    assert.equal(
      response.output_text,
      ""
    );
  }
);

async function withServer(
  handler,
  fn
) {
  const server =
    http.createServer(
      handler
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

function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map(
      block =>
        block.trim()
    )
    .filter(Boolean)
    .map(
      block => {
        const lines =
          block.split(
            /\r?\n/
          );

        const eventLine =
          lines.find(
            line =>
              line.startsWith(
                "event:"
              )
          );

        const data =
          lines
            .filter(
              line =>
                line.startsWith(
                  "data:"
                )
            )
            .map(
              line =>
                line
                  .slice(5)
                  .trimStart()
            )
            .join("\n");

        return {
          event:
            eventLine
              .slice(6)
              .trim(),
          payload:
            JSON.parse(
              data
            )
        };
      }
    );
}

test(
  "SSE emits function_call argument lifecycle",
  async () => {
    const server =
      async (
        req,
        res
      ) => {
        const handled =
          await handleResponsesRoute(
            req,
            res,
            {
              apiKey:
                "secret",

              execute:
                async () => ({
                  kind:
                    "function_calls",
                  output_text:
                    "",
                  calls: [
                    {
                      item_id:
                        "fc_stream",
                      call_id:
                        "call_stream",
                      name:
                        "lookup",
                      arguments:
                        '{"code":"RED"}'
                    }
                  ]
                })
            }
          );

        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      };

    await withServer(
      server,
      async baseUrl => {
        const response =
          await fetch(
            `${baseUrl}/v1/responses`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  "Bearer secret",
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  ...request(),
                  stream:
                    true
                })
            }
          );

        const events =
          parseSse(
            await response.text()
          );

        const names =
          events.map(
            item =>
              item.event
          );

        assert.ok(
          names.includes(
            "response.function_call_arguments.delta"
          )
        );

        assert.ok(
          names.includes(
            "response.function_call_arguments.done"
          )
        );

        const completed =
          events.find(
            item =>
              item.event ===
              "response.completed"
          );

        assert.equal(
          completed.payload.response.output[0].type,
          "function_call"
        );

        assert.deepEqual(
          events.map(
            item =>
              item.payload.sequence_number
          ),
          events.map(
            (_, index) =>
              index
          )
        );
      }
    );
  }
);
