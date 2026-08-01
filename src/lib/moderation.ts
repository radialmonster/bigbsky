export type ModerationLabel = { val?: string; src?: string; uri?: string };

export function moderationLabelText(label: { val?: string }) {
  const value = label.val?.trim();
  if (!value) {
    return "Content label";
  }

  return value
    .replace(/^!/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isSensitiveLabel(label: { val?: string }) {
  const value = label.val?.toLowerCase() || "";
  return [
    "adult",
    "graphic",
    "gore",
    "nudity",
    "porn",
    "sexual",
    "spam",
    "violence",
  ].some((term) => value.includes(term));
}

export function sensitiveMediaValues(labels: Array<{ val?: string }>) {
  return Array.from(
    new Set(
      labels
        .filter(isSensitiveLabel)
        .map((label) => label.val?.toLowerCase() || "")
        .filter((value) => value && !value.includes("spam")),
    ),
  );
}
