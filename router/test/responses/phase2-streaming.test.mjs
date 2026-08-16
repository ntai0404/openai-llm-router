import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  handleResponsesRoute
} from "../../responses/responses-router.mjs";

async function withServer(handler, fn) {
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
    return await fn(
      `http://127.0.0.1:${port}`
    );
  } finally {
    await new Promise(
      resolve =>
        server.close(resolve)
    );
  }
}

function serverFor(options = {}) {
  return async (req, res) => {
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
  };
}

function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines =
        block.split(/\r?\n/);

      const eventLine =
        lines.find(
          line =>
            line.startsWith("event:")
        );

      const dataLines =
        lines
          .filter(
            line =>
              line.startsWith("data:")
          )
          .map(
            line =>
              line
                .slice(5)
                .trimStart()
          );

      assert.ok(eventLine);
      assert.ok(dataLines.length);

      return {
        event:
          eventLine
            .slice(6)
            .trim(),

        payload:
          JSON.parse(
            dataLines.join("\n")
          )
      };
    });
}

async function postStream(
  baseUrl,
  execute
) {
  return withServer(
    serverFor({
      apiKey: "secret",
      execute
    }),
    async url => {
      const response =
        await fetch(
          `${url}/v1/responses`,
          {
            method: "POST",
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

      return {
        status:
          response.status,
        contentType:
          response.headers.get(
            "content-type"
          ),
        events:
          parseSse(
            await response.text()
          )
      };
    }
  );
}

test(
  "stream=true emits Responses lifecycle events",
  async () => {
    const result =
      await postStream(
        null,
        async () => ({
          output_text:
            "STREAM OK",
          backend_job_id:
            "job_1"
        })
      );

    assert.equal(
      result.status,
      200
    );

    assert.match(
      result.contentType,
      /^text\/event-stream/
    );

    assert.deepEqual(
      result.events.map(
        entry => entry.event
      ),
      [
        "response.created",
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_text.done",
        "response.content_part.done",
        "response.output_item.done",
        "response.completed"
      ]
    );
  }
);

test(
  "sequence_number is monotonic",
  async () => {
    const result =
      await postStream(
        null,
        async () => ({
          output_text: "ABC"
        })
      );

    assert.deepEqual(
      result.events.map(
        entry =>
          entry.payload.sequence_number
      ),
      result.events.map(
        (_, index) => index
      )
    );
  }
);

test(
  "stream keeps stable response and message IDs",
  async () => {
    const result =
      await postStream(
        null,
        async () => ({
          output_text:
            "SAME IDS"
        })
      );

    const created =
      result.events.find(
        x =>
          x.event ===
          "response.created"
      ).payload;

    const added =
      result.events.find(
        x =>
          x.event ===
          "response.output_item.added"
      ).payload;

    const delta =
      result.events.find(
        x =>
          x.event ===
          "response.output_text.delta"
      ).payload;

    const completed =
      result.events.find(
        x =>
          x.event ===
          "response.completed"
      ).payload;

    assert.equal(
      created.response.id,
      completed.response.id
    );

    assert.equal(
      added.item.id,
      delta.item_id
    );

    assert.equal(
      delta.item_id,
      completed.response
        .output[0].id
    );

    assert.equal(
      delta.delta,
      "SAME IDS"
    );
  }
);

test(
  "runtime execution failure emits SSE error event",
  async () => {
    const result =
      await postStream(
        null,
        async () => {
          throw new Error(
            "simulated"
          );
        }
      );

    assert.equal(
      result.events[0].event,
      "response.created"
    );

    const last =
      result.events.at(-1);

    assert.equal(
      last.event,
      "error"
    );

    assert.equal(
      last.payload.type,
      "error"
    );

    assert.equal(
      last.payload.code,
      "internal_error"
    );
  }
);

test(
  "invalid auth stays JSON before SSE starts",
  async () => {
    await withServer(
      serverFor({
        apiKey: "secret"
      }),
      async baseUrl => {
        const response =
          await fetch(
            `${baseUrl}/v1/responses`,
            {
              method: "POST",
              headers: {
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

        assert.equal(
          response.status,
          401
        );

        assert.match(
          response.headers.get(
            "content-type"
          ),
          /^application\/json/
        );
      }
    );
  }
);

test(
  "stream=false remains JSON compatible",
  async () => {
    await withServer(
      serverFor({
        apiKey:
          "secret",

        execute:
          async () => ({
            output_text:
              "NON STREAM"
          })
      }),
      async baseUrl => {
        const response =
          await fetch(
            `${baseUrl}/v1/responses`,
            {
              method: "POST",
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
                    false
                })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          200
        );

        assert.equal(
          body.object,
          "response"
        );

        assert.equal(
          body.output_text,
          "NON STREAM"
        );

        assert.equal(
          body.usage,
          null
        );
      }
    );
  }
);
