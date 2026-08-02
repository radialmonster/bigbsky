import { type CSSProperties, useContext, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Heart,
  List,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Repeat2,
  Share2,
  ShieldAlert,
} from "lucide-react";
import {
  type FeedItem,
  type FeedPost,
  type Profile,
  type RecordEmbedView,
  getEmbedImages,
  getExternalEmbed,
  getRecordEmbed,
  getUnknownEmbedType,
  getVideoEmbed,
} from "../../api";
import { formatPostTime, postSortAt } from "../../lib/time";
import { threadMarkerMatch } from "../../lib/threads";
import { postBskyUrl, safeHttpUrl, postPath, profilePath, handleInternalLinkClick } from "../../lib/url";
import { isSensitiveLabel, moderationLabelText, sensitiveMediaValues } from "../../lib/moderation";
import { displayName } from "../../sources";
import { Avatar } from "../common/Avatar";
import { MediaHiddenButton, SensitiveMediaGate } from "../common/MediaGate";
import { ShowMediaContext, useMediaReveal } from "../common/useMediaReveal";
import { shareButtonLabel, useSharePost } from "../common/useSharePost";
import { useDismissMenu } from "../common/useDismissMenu";
import { VideoEmbedCard } from "./VideoEmbedCard";
import {
  MasonryImageGrid,
  PostImageVideoMedia,
  clickedImageElement,
  feedViewerImages,
  imageAspectRatio,
  maxPostImages,
  safeEmbedImages,
} from "./PostImageVideoMedia";
import { renderRichText } from "./RichText";
import { ExternalLinkCard } from "./ExternalLinkCard";
import { UnsupportedEmbedNotice } from "./UnsupportedEmbedNotice";
import { ReplyLimitedNotice } from "./ReplyLimitedNotice";
import { useReplyGate } from "./useReplyGate";
import { type ImageViewerImage, type ImageViewerState } from "./ImageViewer";
import type { LocalList } from "../lists/ListsSurface";
import {
  BookmarkContext,
  BlockContext,
  DeletePostContext,
  DensityContext,
  LikeContext,
  TagSearchContext,
} from "./PostCardContexts";

// CSS class helper for post body text shared by the post card, combined-thread
// segments, and long-thread parts.
export function postTextClass(text: string) {
  return text.includes("\n") ? "post-text has-line-breaks" : "post-text";
}


export function PostCardHeader({
  profile,
  post,
  timestampLabel,
  onOpenProfile,
  onOpenPost,
}: {
  profile: Profile;
  post: FeedPost;
  timestampLabel: string;
  onOpenProfile?: (profile: Profile) => void;
  onOpenPost?: (post: FeedPost) => void;
}) {
  return (
    <header className="post-header">
      <Avatar profile={profile} />
      <div className="post-author-block">
        <a
          className="author-button"
          href={profilePath(profile)}
          onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(profile))}
        >
          <strong>{displayName(profile)}</strong>
        </a>
        <div className="post-byline">
          <span>@{profile.handle}</span>
          <span aria-hidden="true">·</span>
          <a
            className="post-timestamp"
            href={postPath(post) ?? postBskyUrl(post)}
            onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(post))}
            title={`Open thread posted ${timestampLabel}`}
            aria-label={`Open thread posted ${timestampLabel}`}
          >
            {timestampLabel}
          </a>
        </div>
      </div>
    </header>
  );
}

export function mediaImageRows(images: ReturnType<typeof getEmbedImages>) {
  const rows: Array<ReturnType<typeof getEmbedImages>> = [];
  for (let index = 0; index < images.length; ) {
    const remaining = images.length - index;
    const count = remaining === 4 ? 2 : Math.min(3, remaining);
    rows.push(images.slice(index, index + count));
    index += count;
  }
  return rows;
}

export function MediaOnlyImageTile({
  image,
  viewerImages,
  onOpenImage,
}: {
  image: ReturnType<typeof getEmbedImages>[number];
  viewerImages: ImageViewerImage[];
  onOpenImage?: (image: ImageViewerState) => void;
}) {
  const src = image.thumb || image.fullsize;
  const [aspectRatio, setAspectRatio] = useState(() => imageAspectRatio(image));
  const viewerIndex = viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb));

  return (
    <button
      className="media-only-tile"
      type="button"
      style={{ "--media-aspect": aspectRatio } as CSSProperties}
      onClick={(event) => {
        if (!clickedImageElement(event)) {
          return;
        }
        if (viewerImages.length > 0) {
          onOpenImage?.({ images: viewerImages, index: Math.max(0, viewerIndex) });
        }
      }}
      aria-label={image.alt ? "Open image" : "Open full size image"}
    >
      <img
        alt={image.alt || ""}
        src={src}
        loading="lazy"
        decoding="async"
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setAspectRatio(Math.max(0.45, Math.min(2.8, img.naturalWidth / img.naturalHeight)));
          }
        }}
      />
    </button>
  );
}

export function MediaOnlyPostCard({
  post,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  canReply = true,
  onQuote,
  quoteActive = false,
  localLists = [],
  onToggleListPost,
  canDeletePost = false,
  canBlockAuthor = false,
}: {
  post: FeedPost;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  canReply?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  localLists?: LocalList[];
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  canDeletePost?: boolean;
  canBlockAuthor?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const images = safeEmbedImages(getEmbedImages(post.embed)).slice(0, maxPostImages);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const threadMarker = threadMarkerMatch(text);
  const postTimeLabel = formatPostTime(postSortAt(post));
  const viewerImages = feedViewerImages(images);

  if (images.length === 0 && !video) {
    return null;
  }

  return (
    <article className="post-card media-only-card">
      {images.length === 1 && (
        <button
          className="media-only-single"
          type="button"
          onClick={(event) => {
            if (!clickedImageElement(event)) {
              return;
            }
            if (viewerImages.length > 0) {
              onOpenImage?.({ images: viewerImages, index: 0 });
            }
          }}
          aria-label={images[0].alt ? "Open image" : "Open full size image"}
        >
          <img
            alt={images[0].alt || ""}
            src={images[0].thumb || images[0].fullsize}
            loading="lazy"
            decoding="async"
            style={
              images[0].aspectRatio?.width && images[0].aspectRatio?.height
                ? { aspectRatio: `${images[0].aspectRatio.width} / ${images[0].aspectRatio.height}` }
                : undefined
            }
          />
        </button>
      )}
      {images.length > 1 && (
        <div className="media-only-justified" aria-label="Post media">
          {mediaImageRows(images).map((row, rowIndex) => (
            <div
              className="media-only-row"
              key={`media-row-${post.uri}-${rowIndex}`}
              style={{ "--media-row-aspect": row.reduce((total, image) => total + imageAspectRatio(image), 0) } as CSSProperties}
            >
              {row.map((image) => (
                <MediaOnlyImageTile
                  image={image}
                  key={image.thumb || image.fullsize}
                  viewerImages={viewerImages}
                  onOpenImage={onOpenImage}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {video && <VideoEmbedCard video={video} />}
      <footer className="media-only-footer">
        <button
          type="button"
          className="media-only-expand"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide post details" : "Show post details"}
          title={expanded ? "Hide post details" : "Show post details"}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {expanded && (
          <div className="media-only-details">
            {threadMarker && (
              <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(post)} title="Open full thread">
                <MessageCircle size={13} />
                <span>
                  Open Thread {threadMarker.index}/{threadMarker.total}
                </span>
              </button>
            )}
            <div className="media-only-meta">
              <a
                className="media-only-author"
                href={profilePath(post.author)}
                onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(post.author))}
              >
                <strong>{displayName(post.author)}</strong>
                <span>@{post.author.handle}</span>
              </a>
              <span aria-hidden="true">·</span>
              <a
                className="media-only-timestamp"
                href={postPath(post) ?? postBskyUrl(post)}
                onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(post))}
                title={`Open thread posted ${postTimeLabel}`}
              >
                {postTimeLabel}
              </a>
              {text && (
                <span className="media-only-text">
                  {text}
                </span>
              )}
            </div>
            <PostActionBar
              post={post}
              onOpenPost={onOpenPost}
              onReply={onReply}
              replyActive={replyActive}
              canReply={canReply}
              onQuote={onQuote}
              quoteActive={quoteActive}
              localLists={localLists}
              onToggleListPost={onToggleListPost}
              canDeletePost={canDeletePost}
              canBlockAuthor={canBlockAuthor}
            />
          </div>
        )}
      </footer>
    </article>
  );
}

export function PostActionBar({
  post,
  commentCount,
  commentTitle = "Open thread",
  onOpenPost,
  onReply,
  replyActive = false,
  canReply = true,
  onQuote,
  quoteActive = false,
  localLists = [],
  onToggleListPost,
  canDeletePost = false,
  canBlockAuthor = false,
}: {
  post: FeedPost;
  commentCount?: number;
  commentTitle?: string;
  onOpenPost?: (post: FeedPost) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  canReply?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  localLists?: LocalList[];
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  canDeletePost?: boolean;
  canBlockAuthor?: boolean;
}) {
  const likeCtx = useContext(LikeContext);
  const likeView = likeCtx?.getState(post);
  const bookmarkCtx = useContext(BookmarkContext);
  const bookmarkView = bookmarkCtx?.getState(post);
  const blockCtx = useContext(BlockContext);
  const blockView = blockCtx?.getState(post.author);
  const deletePostCtx = useContext(DeletePostContext);
  const { shareState, handleShare } = useSharePost(post, [post]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null);
  const { showReplyLimited, handleReplyClick } = useReplyGate(post, onReply);
  const displayedCommentCount = commentCount ?? post.replyCount ?? 0;

  useDismissMenu(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));

  return (
    <>
      <footer className="post-actions">
        <button type="button" onClick={() => onOpenPost?.(post)} aria-label={commentTitle} title={commentTitle}>
          <MessageCircle size={16} /> {displayedCommentCount}
        </button>
        <span>
          <Repeat2 size={16} /> {post.repostCount ?? 0}
        </span>
        {likeCtx?.canLike && likeView ? (
          <button
            type="button"
            className={likeView.liked ? "liked" : ""}
            onClick={() => likeCtx.toggle(post)}
            aria-label={likeView.liked ? "Unlike post" : "Like post"}
            title={likeView.liked ? "Unlike" : "Like"}
          >
            <Heart size={16} /> {likeView.count}
          </button>
        ) : (
          <span>
            <Heart size={16} /> {post.likeCount ?? 0}
          </span>
        )}
        {bookmarkCtx?.canBookmark && bookmarkView ? (
          <button
            className={bookmarkView.error ? "bookmark-error" : bookmarkView.bookmarked ? "bookmarked" : ""}
            type="button"
            onClick={() => bookmarkCtx.toggle(post)}
            aria-label={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post")}
            title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post")}
          >
            <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
          </button>
        ) : null}
        <button type="button" onClick={handleShare} aria-label={shareButtonLabel(shareState)} title="Share post">
          <Share2 size={16} /> {shareButtonLabel(shareState)}
        </button>
        {onReply && (
          <button
            type="button"
            className={replyActive ? "active" : ""}
            onClick={handleReplyClick}
            disabled={!canReply}
            title="Reply to this post"
          >
            <MessageCircle size={16} /> Reply
          </button>
        )}
        {onQuote && (
          <button
            type="button"
            className={quoteActive ? "active" : ""}
            onClick={() => onQuote(post)}
            title="Quote this post"
          >
            <Quote size={16} /> Quote
          </button>
        )}
        {localLists.length > 0 && (
          <details className="post-list-menu">
            <summary title="Add post to local lists">
              <List size={16} /> Lists
            </summary>
            <div>
              {localLists.map((list) => {
                const isListed = !!list.posts?.some((listPost) => listPost.uri === post.uri);
                return (
                  <button
                    className={isListed ? "listed" : ""}
                    key={list.id}
                    type="button"
                    onClick={() => onToggleListPost?.(list.id, post)}
                  >
                    {isListed ? "Remove from" : "Add to"} {list.name}
                  </button>
                );
              })}
            </div>
          </details>
        )}
        <details
          className="post-list-menu post-more-menu"
          open={moreMenuOpen}
          ref={moreMenuRef}
          onToggle={(event) => setMoreMenuOpen(event.currentTarget.open)}
        >
          <summary title="More options" aria-label="More options">
            <MoreHorizontal size={16} />
          </summary>
          <div>
            <a href={postBskyUrl(post)} target="_blank" rel="noreferrer" onClick={() => setMoreMenuOpen(false)}>
              Open on Bluesky
            </a>
            {canDeletePost && (
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  deletePostCtx?.deletePost(post);
                }}
              >
                Delete post
              </button>
            )}
            {canBlockAuthor && (
              <button
                type="button"
                className={blockView?.blocked ? "block-listed" : ""}
                onClick={() => {
                  setMoreMenuOpen(false);
                  blockCtx?.toggle(post.author);
                }}
              >
                {blockView?.blocked ? `Unblock @${post.author.handle}` : `Block @${post.author.handle}`}
              </button>
            )}
          </div>
        </details>
      </footer>
      {showReplyLimited && <ReplyLimitedNotice />}
    </>
  );
}

export function PostEmbeds({
  post,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
}: {
  post: FeedPost;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const showMedia = useContext(ShowMediaContext);
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const video = getVideoEmbed(post.embed);
  const external = getExternalEmbed(post.embed);
  const externalThumb = safeHttpUrl(external?.thumb);
  const recordEmbed = getRecordEmbed(post.embed);
  const { revealed: linkMediaRevealed, setRevealed, thumbnailHidden: linkMediaHidden } = useMediaReveal({
    sensitiveWarningCount: 0,
    hasMedia: false,
    hasThumbnail: !!externalThumb,
  });
  // If the post carries an embed we don't know how to render and none of the
  // known extractors produced anything, tell the reader rather than dropping it.
  const renderedEmbed = images.length > 0 || !!video || !!external || !!recordEmbed;
  const unknownEmbedType = renderedEmbed ? null : getUnknownEmbedType(post.embed);

  return (
    <>
      <PostImageVideoMedia post={post} onOpenImage={onOpenImage} />
      {!showMedia && externalThumb && (
        <MediaHiddenButton kind="image" revealed={linkMediaRevealed} onReveal={() => setRevealed((current) => !current)} />
      )}
      {external && (
        <ExternalLinkCard
          external={external}
          hideThumbnail={linkMediaHidden}
        />
      )}
      {recordEmbed && (
        <QuotedPostCard
          record={recordEmbed}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
        />
      )}
      {unknownEmbedType && <UnsupportedEmbedNotice embedType={unknownEmbedType} post={post} />}
    </>
  );
}

export function PostCard({
  currentDid,
  item,
  localLists = [],
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  onQuote,
  quoteActive = false,
  forceFullCard,
  onToggleListPost,
}: {
  currentDid?: string;
  item: FeedItem;
  localLists?: LocalList[];
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  // In thread context we always want the full post card, never the compact
  // media-only variant that "media" density would otherwise substitute.
  forceFullCard?: boolean;
  onToggleListPost?: (listId: string, post: FeedPost) => void;
}) {
  const post = item.post;
  const onOpenTag = useContext(TagSearchContext);
  const showMedia = useContext(ShowMediaContext);
  const density = useContext(DensityContext);
  const blockCtx = useContext(BlockContext);
  const deletePostCtx = useContext(DeletePostContext);
  const canBlockAuthor = !!blockCtx?.canBlock && post.author.did !== blockCtx?.selfDid;
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const external = getExternalEmbed(post.embed);
  const recordEmbed = getRecordEmbed(post.embed);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const postTimestamp = postSortAt(post);
  const postTimeLabel = formatPostTime(postTimestamp);
  const threadMarker = threadMarkerMatch(text);
  const hasRichContent = images.length > 0 || !!external || !!recordEmbed || !!video;
  const postVariant = images.length > 0 || !!video ? "has-media" : external ? "has-link" : recordEmbed ? "has-quote" : "text-only";
  const hasHiddenMedia = !showMedia && (images.length > 0 || !!video || !!external || !!recordEmbed);
  const isOwnPost = !!currentDid && post.author.did === currentDid;
  const canDeletePost = !!deletePostCtx?.canDelete && isOwnPost;
  const labels = post.labels ?? [];
  // Adult content is often labeled at the account level, not the post, so check
  // the author's labels too when deciding whether to hide media.
  const sensitiveLabels = [...labels, ...(post.author.labels ?? [])].filter(isSensitiveLabel);
  const moderationNotes = [
    ...(post.viewer?.threadMuted ? ["Thread muted"] : []),
    ...sensitiveLabels.map(moderationLabelText),
  ];

  if (density === "media" && !forceFullCard && (images.length > 0 || !!video)) {
    return (
      <MediaOnlyPostCard
        post={post}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
        onReply={onReply}
        replyActive={replyActive}
        canReply={!!onReply}
        onQuote={onQuote}
        quoteActive={quoteActive}
        localLists={localLists}
        onToggleListPost={onToggleListPost}
        canDeletePost={canDeletePost}
        canBlockAuthor={canBlockAuthor}
      />
    );
  }

  return (
    <article className={`post-card ${postVariant}${hasHiddenMedia ? " media-hidden" : ""}`}>
      <PostCardHeader
        profile={post.author}
        post={post}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      {threadMarker && (
        <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(post)} title="Open full thread">
          <MessageCircle size={13} />
          <span>
            Open Thread {threadMarker.index}/{threadMarker.total}
          </span>
        </button>
      )}
      {item.reason?.by && <p className="reason">Reposted by {displayName(item.reason.by)}</p>}
      {item.reply?.parent && <p className="reason">Replying in a thread from @{item.reply.parent.author.handle}</p>}
      {(isOwnPost || labels.length > 0) && (
        <div className="post-badges" aria-label="Post context">
          {isOwnPost && <span>Your post</span>}
          {labels.slice(0, 3).map((label) => (
            <span className={isSensitiveLabel(label) ? "sensitive" : ""} key={`${post.uri}:${label.val || label.src || label.uri}`}>
              {moderationLabelText(label)}
            </span>
          ))}
        </div>
      )}
      {moderationNotes.length > 0 && (
        <div className="moderation-notice">
          <ShieldAlert size={15} />
          <span>{moderationNotes.join(", ")}</span>
        </div>
      )}
      {text ? (
        <p className={postTextClass(text)}>
          {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile, onOpenTag)}
        </p>
      ) : (
        !hasRichContent && <p className="post-text muted">Post has no plain text.</p>
      )}
      <PostEmbeds
        post={post}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
      />
      <PostActionBar
        post={post}
        onOpenPost={onOpenPost}
        onReply={onReply}
        replyActive={replyActive}
        onQuote={onQuote}
        quoteActive={quoteActive}
        localLists={localLists}
        onToggleListPost={onToggleListPost}
        canDeletePost={canDeletePost}
        canBlockAuthor={canBlockAuthor}
      />
    </article>
  );
}

export function QuotedPostCard({
  record,
  onOpenPost,
  onOpenProfile,
}: {
  record: RecordEmbedView;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const quoteEmbedSource = record.embeds?.[0] ?? record.value?.embed;
  const embeddedExternal = getExternalEmbed(quoteEmbedSource);
  const embeddedExternalThumb = safeHttpUrl(embeddedExternal?.thumb);
  const embeddedImages = safeEmbedImages(getEmbedImages(quoteEmbedSource));
  const embeddedVideo = getVideoEmbed(quoteEmbedSource);
  // Same generic fallback as PostEmbeds: if the quoted post carries an embed we
  // can't render and none of the known extractors produced output, surface a
  // notice instead of silently dropping the nested content.
  const quoteRenderedEmbed = embeddedImages.length > 0 || !!embeddedVideo || !!embeddedExternal;
  const unknownQuoteEmbedType = quoteRenderedEmbed ? null : getUnknownEmbedType(quoteEmbedSource);
  const hasHiddenPreviewMedia = embeddedImages.length > 0 || !!embeddedVideo || !!embeddedExternalThumb;
  const hiddenPreviewMediaKind = embeddedImages.length > 0 || embeddedExternalThumb ? "image" : "video";
  const text = record.value?.text?.trim() || "";
  const mediaWarningValues = sensitiveMediaValues([
    ...((record.labels as Array<{ val?: string }> | undefined) ?? []),
    ...(record.author?.labels ?? []),
  ]);
  const { revealed: mediaRevealed, setRevealed, gate: gateMedia, hidden: hideMediaForSetting } = useMediaReveal({
    sensitiveWarningCount: mediaWarningValues.length,
    hasMedia: embeddedImages.length > 0 || !!embeddedVideo,
    hasThumbnail: !!embeddedExternalThumb,
  });
  const hiddenMediaControl =
    hideMediaForSetting && hasHiddenPreviewMedia ? (
      <MediaHiddenButton kind={hiddenPreviewMediaKind} onReveal={() => setRevealed(true)} />
    ) : null;
  const quotedPost = record.author
    ? ({
        uri: record.uri,
        cid: record.cid || "",
        author: record.author,
        record: {
          text: record.value?.text,
          createdAt: record.value?.createdAt,
          embed: record.value?.embed,
        },
        embed: record.embeds?.[0],
        replyCount: record.replyCount,
        repostCount: record.repostCount,
        likeCount: record.likeCount,
        quoteCount: record.quoteCount,
        indexedAt: record.indexedAt,
      } satisfies FeedPost)
    : null;
  const openQuotedThreadButton = quotedPost ? (
    <button className="quote-open-button" type="button" onClick={() => onOpenPost?.(quotedPost)}>
      Open quoted thread
    </button>
  ) : null;
  // Show the quoted post's timestamp in the header (and make it the permalink
  // affordance), matching the main post card. Without this the feed/profile
  // quote header only showed author + handle with no way to open the quote by
  // its timestamp. Only rendered when the quote carries a parseable time.
  const quoteTimestamp = quotedPost ? postSortAt(quotedPost) : undefined;
  const quoteTimeLabel = quoteTimestamp ? formatPostTime(quoteTimestamp) : null;
  const quoteTimestampLink =
    quotedPost && quoteTimeLabel ? (
      <a
        className="post-timestamp"
        href={postPath(quotedPost) ?? postBskyUrl(quotedPost)}
        onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(quotedPost))}
        title={`Open quoted post posted ${quoteTimeLabel}`}
        aria-label={`Open quoted post posted ${quoteTimeLabel}`}
      >
        {quoteTimeLabel}
      </a>
    ) : null;

  return (
    <div className={mediaRevealed ? "quote-card revealed" : "quote-card"}>
      {record.author && (
        <header className="quote-header">
          <Avatar profile={record.author} />
          <div className="quote-header-main">
            <div className="post-author-block">
              <a
                className="author-button"
                href={profilePath(record.author as Profile)}
                onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(record.author as Profile))}
              >
                <strong>{displayName(record.author)}</strong>
              </a>
              <div className="post-byline">
                <span>@{record.author.handle}</span>
                {quoteTimestampLink && <span aria-hidden="true">·</span>}
                {quoteTimestampLink}
              </div>
            </div>
            {hiddenMediaControl}
            {openQuotedThreadButton}
          </div>
        </header>
      )}
      {text ? (
        <p className={text.includes("\n") ? "quote-text has-line-breaks" : "quote-text"}>
          {renderRichText(
            record.value?.facets?.length ? record.value.text || "" : text,
            record.value?.facets,
            onOpenProfile,
            onOpenTag,
          )}
        </p>
      ) : (
        <p className="quote-text muted">Quoted post has no plain text.</p>
      )}
      {!record.author && hiddenMediaControl}
      {gateMedia ? (
        <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setRevealed(true)} />
      ) : hideMediaForSetting && hasHiddenPreviewMedia ? (
        null
      ) : (
        <>
          {embeddedImages.length === 1 && (
            <div className="image-grid quote-images count-1">
              <img
                alt={embeddedImages[0].alt || ""}
                src={embeddedImages[0].thumb || embeddedImages[0].fullsize}
                loading="lazy"
                decoding="async"
                style={
                  embeddedImages[0].aspectRatio?.width && embeddedImages[0].aspectRatio?.height
                    ? { aspectRatio: `${embeddedImages[0].aspectRatio.width} / ${embeddedImages[0].aspectRatio.height}` }
                    : undefined
                }
              />
            </div>
          )}
          {embeddedImages.length > 1 && (
            // Multi-image quote galleries reuse the regular post's masonry rows
            // (pairedImageRows + --media-row-aspect / --media-aspect) so they
            // fill the quote width and cap at the viewport height, instead of the
            // old flat 2-up grid that sized each image ad hoc.
            <MasonryImageGrid
              images={embeddedImages}
              rowKeyPrefix={`quote-image-row-${record.uri}`}
              containerClass="image-grid quote-images"
              renderImage={(image, row) => (
                <img
                  alt={image.alt || ""}
                  key={image.thumb || image.fullsize}
                  src={image.thumb || image.fullsize}
                  loading="lazy"
                  decoding="async"
                  style={
                    row.length === 1 && image.aspectRatio?.width && image.aspectRatio?.height
                      ? ({ aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}`, "--media-aspect": imageAspectRatio(image) } as CSSProperties)
                      : ({ "--media-aspect": imageAspectRatio(image) } as CSSProperties)
                  }
                />
              )}
            />
          )}
          {embeddedVideo && <VideoEmbedCard video={embeddedVideo} compact />}
        </>
      )}
      {embeddedExternal && (
        <ExternalLinkCard
          className="quote-link-card"
          external={embeddedExternal}
          hideThumbnail={hideMediaForSetting && !!embeddedExternalThumb}
        />
      )}
      {unknownQuoteEmbedType && quotedPost && (
        <UnsupportedEmbedNotice embedType={unknownQuoteEmbedType} post={quotedPost} />
      )}
      {!record.author && openQuotedThreadButton}
    </div>
  );
}
