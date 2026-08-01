import type { ReactNode } from "react";
import type { Profile, RichTextFacet } from "../../api";
import { segmentRichText } from "../../richtext";

// Maps rich-text facet segments to interactive React nodes. The byte-range /
// facet-selection logic lives in the pure, tested segmentRichText helper
// (src/richtext.ts); this module only owns the render mapping (links, mentions,
// hashtag buttons) and is the single place post cards call for body text.
export function renderRichText(
  text: string,
  facets: RichTextFacet[] | undefined,
  onOpenProfile?: (profile: Profile) => void,
  onOpenTag?: ((tag: string) => void) | null,
): ReactNode {
  if (!text) {
    return text;
  }
  const segments = segmentRichText(text, facets);
  if (segments.length === 0) {
    return text;
  }
  if (segments.length === 1 && segments[0].kind === "text") {
    return segments[0].text;
  }

  return segments.map((segment, index) => {
    if (segment.kind === "link") {
      return (
        <a
          key={index}
          className="post-link"
          href={segment.uri}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {segment.text}
        </a>
      );
    }
    if (segment.kind === "mention" && onOpenProfile) {
      const did = segment.did;
      const handle = segment.text.replace(/^@/, "");
      return (
        <button
          key={index}
          type="button"
          className="post-mention"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile({ did, handle });
          }}
        >
          {segment.text}
        </button>
      );
    }
    if (segment.kind === "tag" && onOpenTag) {
      const tag = segment.tag;
      return (
        <button
          key={index}
          type="button"
          className="post-tag"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTag(tag);
          }}
        >
          {segment.text}
        </button>
      );
    }
    return segment.text;
  });
}
