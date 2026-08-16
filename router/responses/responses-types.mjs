export const RESPONSE_OBJECT = "response";

export const RESPONSE_STATUS = Object.freeze({
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed"
});

export const MESSAGE_ROLES = new Set([
  "user",
  "assistant",
  "system",
  "developer"
]);

export const INPUT_CONTENT_TYPES = new Set([
  "input_text",
  "input_image",
  "input_file"
]);

export const TOOL_CHOICE_MODES = new Set([
  "none",
  "auto",
  "required"
]);

export function isPlainObject(value) {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value);
}
