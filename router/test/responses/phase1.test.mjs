import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  normalizeResponsesRequest
} from "../../responses/request-normalizer.mjs";

import {
  handleResponsesRoute
} from "../../responses/responses-router.mjs";

async function withServer(
  handler,
  fn
) {
  const server =
    http.createServer(handler);

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
    await fn(
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

function responsesServer(
  options = {}
) {
  return async (
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
      res.writeHead(204);
      res.end();
    }
  };
}

test(
  "normalizes string input without flattening the normalized schema",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",
        input:
          "hello"
      });

    assert.equal(
      normalized.requested_model,
      "gpt-test"
    );

    assert.equal(
      normalized.input[0].kind,
      "message"
    );

    assert.equal(
      normalized.input[0].role,
      "user"
    );

    assert.deepEqual(
      normalized.input[0]
        .content[0],
      {
        kind:
          "text",
        source_type:
          "input_text",
        text:
          "hello"
      }
    );
  }
);

test(
  "preserves multi-message roles and input_text parts",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        instructions:
          "follow policy",

        input: [
          {
            role:
              "system",
            content: [
              {
                type:
                  "input_text",
                text:
                  "system text"
              }
            ]
          },
          {
            role:
              "user",
            content: [
              {
                type:
                  "input_text",
                text:
                  "user text"
              }
            ]
          }
        ]
      });

    assert.equal(
      normalized.instructions
        .items[0].role,
      "developer"
    );

    assert.deepEqual(
      normalized.input.map(
        item => item.role
      ),
      [
        "system",
        "user"
      ]
    );

    assert.equal(
      normalized.input[1]
        .content[0].text,
      "user text"
    );
  }
);

test(
  "normalizes input_image data URLs as attachment objects",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        input: [
          {
            role:
              "user",

            content: [
              {
                type:
                  "input_text",
                text:
                  "describe"
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

    const attachment =
      normalized.input[0]
        .content[1]
        .attachment;

    assert.equal(
      attachment.kind,
      "image"
    );

    assert.equal(
      attachment.source.type,
      "data_url"
    );

    assert.equal(
      attachment.detail,
      "high"
    );
  }
);

test(
  "normalizes input_file into the common attachment abstraction",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        input: [
          {
            role:
              "user",

            content: [
              {
                type:
                  "input_file",
                file_url:
                  "https://example.test/a.pdf",
                filename:
                  "a.pdf"
              }
            ]
          }
        ]
      });

    const attachment =
      normalized.input[0]
        .content[0]
        .attachment;

    assert.equal(
      attachment.kind,
      "file"
    );

    assert.equal(
      attachment.source.type,
      "url"
    );

    assert.equal(
      attachment.filename,
      "a.pdf"
    );
  }
);

test(
  "normalizes function_call_output as a structured input item",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        input: [
          {
            type:
              "function_call_output",
            call_id:
              "call_123",
            output:
              "{\"ok\":true}"
          }
        ]
      });

    assert.equal(
      normalized.input[0].kind,
      "function_call_output"
    );

    assert.equal(
      normalized.input[0].call_id,
      "call_123"
    );

    assert.deepEqual(
      normalized.input[0].output,
      {
        kind:
          "text",
        text:
          "{\"ok\":true}"
      }
    );
  }
);

test(
  "normalizes tools, tool_choice, parallel_tool_calls, and stream",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",

        input:
          "hello",

        tools: [
          {
            type:
              "function",
            name:
              "lookup",
            description:
              "lookup value",
            parameters: {
              type:
                "object",
              properties: {
                q: {
                  type:
                    "string"
                }
              }
            },
            strict:
              true
          }
        ],

        tool_choice:
          "required",

        parallel_tool_calls:
          false,

        stream:
          false
      });

    assert.equal(
      normalized.tools[0].kind,
      "function_tool"
    );

    assert.equal(
      normalized.tools[0].name,
      "lookup"
    );

    assert.equal(
      normalized.tool_choice.mode,
      "required"
    );

    assert.equal(
      normalized.parallel_tool_calls,
      false
    );

    assert.equal(
      normalized.stream,
      false
    );
  }
);

test(
  "POST /v1/responses requires bearer auth",
  async () => {
    await withServer(
      responsesServer({
        apiKey:
          "secret",

        execute:
          async () => ({
            output_text:
              "unused"
          })
      }),

      async baseUrl => {
        const response =
          await fetch(
            `${baseUrl}/v1/responses`,
            {
              method:
                "POST",

              headers: {
                "content-type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  model:
                    "gpt-test",
                  input:
                    "hello"
                })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          401
        );

        assert.equal(
          body.error.type,
          "authentication_error"
        );

        assert.equal(
          body.error.code,
          "invalid_api_key"
        );
      }
    );
  }
);

test(
  "POST /v1/responses returns Responses-style non-stream output",
  async () => {
    await withServer(
      responsesServer({
        apiKey:
          "secret",

        execute:
          async normalized => {
            assert.equal(
              normalized.input[0].kind,
              "message"
            );

            return {
              output_text:
                "BROWSER RUN OK",

              backend_job_id:
                "job_123"
            };
          }
      }),

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
                  model:
                    "gpt-requested",
                  input:
                    "hello"
                })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          200
        );

        assert.match(
          body.id,
          /^resp_/
        );

        assert.equal(
          body.object,
          "response"
        );

        assert.equal(
          body.status,
          "completed"
        );

        assert.equal(
          body.model,
          "chatgpt-web-unverified"
        );

        assert.equal(
          body.output[0].type,
          "message"
        );

        assert.equal(
          body.output[0]
            .content[0].type,
          "output_text"
        );

        assert.equal(
          body.output[0]
            .content[0].text,
          "BROWSER RUN OK"
        );

        assert.equal(
          body.output_text,
          "BROWSER RUN OK"
        );

        assert.equal(
          body.usage,
          null
        );

        assert.equal(
          body.router
            .requested_model,
          "gpt-requested"
        );

        assert.equal(
          body.router
            .model_selection_verified,
          false
        );
      }
    );
  }
);

test(
  "rejects unsupported HTTP content type with standardized error",
  async () => {
    await withServer(
      responsesServer({
        apiKey:
          "secret"
      }),

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
                  "text/plain"
              },

              body:
                "hello"
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          415
        );

        assert.equal(
          body.error.code,
          "unsupported_content_type"
        );
      }
    );
  }
);

test(
  "Phase 1 reports stream=true explicitly instead of crashing",
  async () => {
    await withServer(
      responsesServer({
        apiKey:
          "secret"
      }),

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
                  model:
                    "gpt-test",
                  input:
                    "hello",
                  stream:
                    true
                })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          400
        );

        assert.equal(
          body.error.code,
          "streaming_not_implemented"
        );
      }
    );
  }
);

test(
  "handler leaves legacy routes untouched",
  async () => {
    await withServer(
      responsesServer({
        apiKey:
          "secret"
      }),

      async baseUrl => {
        const response =
          await fetch(
            `${baseUrl}/browser/run`,
            {
              method:
                "POST"
            }
          );

        assert.equal(
          response.status,
          204
        );
      }
    );
  }
);
