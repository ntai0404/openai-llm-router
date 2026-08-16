import {
  invalidRequest
} from "./error-mapper.mjs";

const MAX_IMAGE_BYTES =
  6 * 1024 * 1024;

const MIME_EXTENSIONS =
  new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"]
  ]);

function parseBase64ImageDataUrl(
  dataUrl,
  param
) {
  if (typeof dataUrl !== "string") {
    throw invalidRequest(
      `${param} must be a data URL string.`,
      param,
      "invalid_image_data_url"
    );
  }

  const match =
    /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      dataUrl
    );

  if (!match) {
    throw invalidRequest(
      `${param} must be a base64 data URL.`,
      param,
      "invalid_image_data_url"
    );
  }

  const mimeType =
    match[1].toLowerCase();

  if (!mimeType.startsWith("image/")) {
    throw invalidRequest(
      `${param} must contain an image MIME type.`,
      param,
      "invalid_image_mime_type"
    );
  }

  const encoded =
    match[2];

  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0
  ) {
    throw invalidRequest(
      `${param} contains invalid base64 data.`,
      param,
      "invalid_image_base64"
    );
  }

  let bytes;

  try {
    bytes =
      Buffer.from(
        encoded,
        "base64"
      );
  } catch {
    throw invalidRequest(
      `${param} contains invalid base64 data.`,
      param,
      "invalid_image_base64"
    );
  }

  if (bytes.length === 0) {
    throw invalidRequest(
      `${param} contains an empty image.`,
      param,
      "empty_image"
    );
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw invalidRequest(
      `${param} exceeds the ${MAX_IMAGE_BYTES} byte image execution limit.`,
      param,
      "image_too_large"
    );
  }

  const extension =
    MIME_EXTENSIONS.get(
      mimeType
    ) ?? "bin";

  return {
    mime_type:
      mimeType,

    byte_length:
      bytes.length,

    filename:
      `router-image-${cryptoSafeIndex(param)}.${extension}`
  };
}

function cryptoSafeIndex(value) {
  let hash = 0;

  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    hash =
      ((hash << 5) - hash) +
      value.charCodeAt(index);

    hash |= 0;
  }

  return Math.abs(hash);
}

export function adaptAttachmentForBrowser(
  attachment,
  param = "input"
) {
  if (
    !attachment ||
    attachment.kind === undefined
  ) {
    throw invalidRequest(
      `${param} contains an invalid attachment.`,
      param,
      "invalid_attachment"
    );
  }

  if (attachment.kind === "file") {
    throw invalidRequest(
      "input_file is normalized but browser file execution is not enabled yet.",
      param,
      "file_execution_not_implemented"
    );
  }

  if (attachment.kind !== "image") {
    throw invalidRequest(
      `Unsupported attachment kind: ${String(attachment.kind)}.`,
      param,
      "unsupported_attachment"
    );
  }

  const source =
    attachment.source;

  if (
    source?.type === "url"
  ) {
    throw invalidRequest(
      "Remote input_image URL execution is not enabled yet. Use a base64 data URL.",
      param,
      "image_url_execution_not_implemented"
    );
  }

  if (
    source?.type === "file_id"
  ) {
    throw invalidRequest(
      "input_image file_id execution is not enabled yet. Use a base64 data URL.",
      param,
      "image_file_id_execution_not_implemented"
    );
  }

  if (
    source?.type !== "data_url"
  ) {
    throw invalidRequest(
      "Unsupported input_image source.",
      param,
      "unsupported_image_source"
    );
  }

  const metadata =
    parseBase64ImageDataUrl(
      source.data_url,
      param
    );

  return {
    kind:
      "image",

    source_type:
      "data_url",

    data_url:
      source.data_url,

    mime_type:
      metadata.mime_type,

    filename:
      metadata.filename,

    byte_length:
      metadata.byte_length,

    detail:
      attachment.detail ??
      "auto"
  };
}

export function collectBrowserAttachments(
  normalized
) {
  const result = [];

  const visitItems =
    (items, rootParam) => {
      for (
        let itemIndex = 0;
        itemIndex < items.length;
        itemIndex++
      ) {
        const item =
          items[itemIndex];

        if (
          item.kind !== "message"
        ) {
          continue;
        }

        for (
          let contentIndex = 0;
          contentIndex < item.content.length;
          contentIndex++
        ) {
          const part =
            item.content[contentIndex];

          if (
            part.kind !== "attachment"
          ) {
            continue;
          }

          result.push(
            adaptAttachmentForBrowser(
              part.attachment,
              `${rootParam}[${itemIndex}].content[${contentIndex}]`
            )
          );
        }
      }
    };

  visitItems(
    normalized.instructions?.items ?? [],
    "instructions"
  );

  visitItems(
    normalized.input,
    "input"
  );

  return result;
}
