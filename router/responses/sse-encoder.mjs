import {
  mapError
} from "./error-mapper.mjs";

import {
  createCompletedMessage,
  createInProgressMessage,
  createResponseContext,
  encodeCompletedResponse,
  encodeCreatedResponse
} from "./response-encoder.mjs";

function writeEvent(res, event) {
  res.write(
    `event: ${event.type}\n`
  );

  res.write(
    `data: ${JSON.stringify(event)}\n\n`
  );
}

function startSse(res) {
  res.writeHead(
    200,
    {
      "content-type":
        "text/event-stream; charset=utf-8",
      "cache-control":
        "no-cache",
      "connection":
        "keep-alive",
      "x-accel-buffering":
        "no",
      "access-control-allow-origin":
        "*"
    }
  );

  res.flushHeaders?.();
}

export async function streamResponse(
  res,
  normalized,
  execute
) {
  startSse(res);

  const context =
    createResponseContext();

  let sequenceNumber = 0;

  const emit = payload => {
    writeEvent(
      res,
      {
        ...payload,
        sequence_number:
          sequenceNumber++
      }
    );
  };

  emit({
    type: "response.created",
    response:
      encodeCreatedResponse(
        normalized,
        context
      )
  });

  try {
    const executionResult =
      await execute(normalized);

    const outputText =
      executionResult.output_text;

    emit({
      type:
        "response.output_item.added",
      output_index: 0,
      item:
        createInProgressMessage(
          context
        )
    });

    emit({
      type:
        "response.content_part.added",
      item_id:
        context.message_id,
      output_index: 0,
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
        annotations: []
      }
    });

    /*
      The browser execution backend only
      exposes the final rendered answer,
      so Phase 2 emits one buffered delta.
    */
    emit({
      type:
        "response.output_text.delta",
      item_id:
        context.message_id,
      output_index: 0,
      content_index: 0,
      delta: outputText
    });

    emit({
      type:
        "response.output_text.done",
      item_id:
        context.message_id,
      output_index: 0,
      content_index: 0,
      text: outputText
    });

    emit({
      type:
        "response.content_part.done",
      item_id:
        context.message_id,
      output_index: 0,
      content_index: 0,
      part: {
        type: "output_text",
        text: outputText,
        annotations: []
      }
    });

    emit({
      type:
        "response.output_item.done",
      output_index: 0,
      item:
        createCompletedMessage(
          context,
          outputText
        )
    });

    emit({
      type:
        "response.completed",
      response:
        encodeCompletedResponse(
          normalized,
          executionResult,
          Date.now(),
          context
        )
    });
  } catch (error) {
    const mapped =
      mapError(error);

    emit({
      type: "error",
      code:
        mapped.body.error.code,
      message:
        mapped.body.error.message,
      param:
        mapped.body.error.param
    });
  }

  res.end();
}
