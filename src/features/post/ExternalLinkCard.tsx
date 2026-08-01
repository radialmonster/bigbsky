import { getExternalEmbed } from "../../api";
import { safeHttpUrl } from "../../lib/url";

// Renders a Bluesky external embed (link card) with a bounded proportional
// thumbnail panel and left-anchored title/description, collapsing to a
// text-only column when the thumbnail is hidden or absent.
export function ExternalLinkCard({
  className = "",
  external,
  hideThumbnail = false,
}: {
  className?: string;
  external: NonNullable<ReturnType<typeof getExternalEmbed>>;
  hideThumbnail?: boolean;
}) {
  const href = safeHttpUrl(external.uri);
  const thumb = safeHttpUrl(external.thumb);
  if (!href) {
    return null;
  }

  const noMedia = hideThumbnail || !thumb;
  const classes = ["link-card", className, noMedia ? "no-media" : ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {thumb && !hideThumbnail && <img alt="" src={thumb} loading="lazy" decoding="async" />}
        <span>
          <strong>{external.title || external.uri}</strong>
          <em>Open {formatExternalUrlLabel(external.uri || external.title || "")}</em>
          {external.description && <small>{external.description}</small>}
        </span>
      </a>
    </div>
  );
}

export function formatExternalUrlLabel(uri: string) {
  try {
    const url = new URL(uri);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path && path !== "/" ? path : ""}`;
  } catch {
    return uri;
  }
}
