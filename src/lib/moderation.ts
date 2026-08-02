import type { FeedPost } from "../api";

export type ModerationLabel = { val?: string; src?: string; uri?: string };

// Whether a post should be hidden entirely when the NSFW preference is set to
// hidden: it (or its author) carries an adult/graphic media label. Mirrors the
// media-gate label set (spam excluded) so "hidden" removes exactly the posts
// whose media would otherwise be gated.
export function isAdultPost(post: FeedPost): boolean {
  const labels = [
    ...((post.labels ?? []) as Array<{ val?: string }>),
    ...((post.author?.labels ?? []) as Array<{ val?: string }>),
  ];
  return sensitiveMediaValues(labels).length > 0;
}

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
