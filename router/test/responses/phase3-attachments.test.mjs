import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptAttachmentForBrowser
} from "../../responses/attachment-adapter.mjs";

import {
  buildBrowserExecutionRequest,
  executeNormalizedRequest
} from "../../responses/execution-adapter.mjs";

import {
  normalizeResponsesRequest
} from "../../responses/request-normalizer.mjs";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test(
  "data URL image becomes a browser image attachment",
  () => {
    const result =
      adaptAttachmentForBrowser(
        {
          kind: "image",
          detail: "high",
          source: {
            type: "data_url",
            data_url: PIXEL
          }
        },
        "input[0].content[1]"
      );

    assert.equal(
      result.kind,
      "image"
    );

    assert.equal(
      result.source_type,
      "data_url"
    );

    assert.equal(
      result.mime_type,
      "image/png"
    );

    assert.equal(
      result.detail,
      "high"
    );

    assert.ok(
      result.byte_length > 0
    );
  }
);

test(
  "remote image URL remains normalized but execution fails explicitly",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model: "gpt-test",
        input: [
          {
            role: "user",
            content: [
              {
                type:
                  "input_image",
                image_url:
                  "https://example.test/image.png"
              }
            ]
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
        "image_url_execution_not_implemented"
    );
  }
);

test(
  "image file_id remains normalized but execution fails explicitly",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model: "gpt-test",
        input: [
          {
            role: "user",
            content: [
              {
                type:
                  "input_image",
                file_id:
                  "file_123"
              }
            ]
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
        "image_file_id_execution_not_implemented"
    );
  }
);

test(
  "input_file abstraction remains intact and returns explicit execution error",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model: "gpt-test",
        input: [
          {
            role: "user",
            content: [
              {
                type:
                  "input_file",
                file_data:
                  "SGVsbG8=",
                filename:
                  "hello.txt"
              }
            ]
          }
        ]
      });

    assert.equal(
      normalized.input[0]
        .content[0]
        .attachment.kind,
      "file"
    );

    assert.throws(
      () =>
        buildBrowserExecutionRequest(
          normalized
        ),
      error =>
        error.code ===
        "file_execution_not_implemented"
    );
  }
);

test(
  "browser execution request preserves attachment separately from text",
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
                  "Describe the image."
              },
              {
                type:
                  "input_image",
                image_url:
                  PIXEL
              }
            ]
          }
        ]
      });

    const result =
      buildBrowserExecutionRequest(
        normalized
      );

    assert.match(
      result.input,
      /Describe the image/
    );

    assert.equal(
      result.attachments.length,
      1
    );

    assert.equal(
      result.attachments[0]
        .source_type,
      "data_url"
    );

    assert.equal(
      result.input.includes(
        PIXEL
      ),
      false
    );
  }
);

test(
  "executeNormalizedRequest sends attachments to /browser/run",
  async () => {
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
                  "vision"
              },
              {
                type:
                  "input_image",
                image_url:
                  PIXEL
              }
            ]
          }
        ]
      });

    let browserBody = null;

    const fetchImpl =
      async (url, options = {}) => {
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
              status: 200,
              headers: {
                "content-type":
                  "application/json"
              }
            }
          );
        }

        browserBody =
          JSON.parse(
            options.body
          );

        return new Response(
          JSON.stringify({
            id:
              "job_image",
            status:
              "completed",
            output_text:
              "IMAGE OK"
          }),
          {
            status: 200,
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
      result.output_text,
      "IMAGE OK"
    );

    assert.equal(
      browserBody.attachments
        .length,
      1
    );

    assert.equal(
      browserBody.attachments[0]
        .kind,
      "image"
    );

    assert.equal(
      browserBody.input.includes(
        PIXEL
      ),
      false
    );
  }
);

test(
  "text-only execution remains backward compatible",
  () => {
    const normalized =
      normalizeResponsesRequest({
        model:
          "gpt-test",
        input:
          "hello"
      });

    const result =
      buildBrowserExecutionRequest(
        normalized
      );

    assert.equal(
      result.attachments.length,
      0
    );

    assert.match(
      result.input,
      /hello/
    );
  }
);
