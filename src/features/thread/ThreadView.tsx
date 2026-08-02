import {
  Bookmark,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  Quote,
  Repeat2,
  Share2,
  ShieldAlert,
  Users,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useContext, useState } from "react";
import {
  type FeedPost,
  type Profile,
  type ThreadNode,
  getEmbedImages,
  getVideoEmbed,
  getExternalEmbed,
  getRecordEmbed,
} from "../../api";
import { formatPostTime, postSortAt } from "../../lib/time";
import {
  buildAnchoredThreadParts,
  canHideCombinedThreadMarkers,
  combinedThreadSegment,
  getContinuationReply,
  type ThreadPart,
  type ThreadedFeedItem,
} from "../../lib/threads";
import { postBskyUrl, profilePath, handleInternalLinkClick, extractFacetLinks } from "../../lib/url";
import { displayName } from "../../sources";
import {
  PostCard,
  PostCardHeader,
  PostActionBar,
  PostEmbeds,
  postTextClass,
} from "../post/PostCard";
import {
  BookmarkContext,
  DensityContext,
  LikeContext,
  TagSearchContext,
  type BookmarkView,
  type LikeView,
} from "../post/PostCardContexts";
import { renderRichText } from "../post/RichText";
import { ReplyLimitedNotice } from "../post/ReplyLimitedNotice";
import { useReplyGate } from "../post/useReplyGate";
import { ThreadEngagementPanel } from "../post/ThreadEngagementPanel";
import type { ImageViewerState } from "../post/ImageViewer";
import { PostComposer, type PostRefValue } from "../composer/PostComposer";
import { useSharePost, shareButtonLabel, type ShareState } from "../common/useSharePost";
import { LoadingState, ErrorState } from "../common/State";
import type { LocalList } from "../lists/ListsSurface";
import type { BranchLoadResult } from "../../lib/loaders";

export function replyRootRefForPost(post: FeedPost): PostRefValue {
  const rootRef = post.record.reply?.root;
  return rootRef?.uri && rootRef?.cid ? { uri: rootRef.uri, cid: rootRef.cid } : { uri: post.uri, cid: post.cid };
}


function postHasEmbeds(post: FeedPost): boolean {
  return (
    getEmbedImages(post.embed).length > 0 ||
    !!getVideoEmbed(post.embed) ||
    !!getExternalEmbed(post.embed) ||
    !!getRecordEmbed(post.embed) ||
    extractFacetLinks(post.record.facets).length > 0
  );
}


function combinedThreadStats(posts: FeedPost[], rootPost: FeedPost, likeView?: LikeView) {
  // Each continuation part is itself a reply to the previous part, so it is
  // counted in that part's replyCount. Subtract the n-1 linear continuation hops
  // so the chip approximates external replies to the thread, not its own
  // continuations. Caveat (todo Bug 4): this only removes the *linear* chain hops.
  // If the author forked their self-thread (replied to one part more than once),
  // the extra fork(s) stay counted, so the number can read slightly high. A
  // precise count isn't computable here: a ThreadedFeedItem carries only each
  // post's aggregate replyCount integer, not the reply trees needed to tell a
  // fork from an external reply. The error is bounded by the fork count (rare)
  // and always in the safe direction - we never over-subtract and hide real
  // replies, since every hop we subtract is a continuation that genuinely exists.
  const replyCount = Math.max(0, posts.reduce((total, post) => total + (post.replyCount ?? 0), 0) - (posts.length - 1));
  const repostCount = posts.reduce((total, post) => total + (post.repostCount ?? 0), 0);
  const quoteCount = posts.reduce((total, post) => total + (post.quoteCount ?? 0), 0);
  const likeCount = posts.reduce((total, post) => total + (post.likeCount ?? 0), 0);
  // Only the first (root) post can be liked here, so swap its static server count
  // for the optimistic live count; otherwise the heart fills on like but the
  // number never moves, reading as "the like didn't register".
  const liveLikeCount = likeCount - (rootPost.likeCount ?? 0) + (likeView ? likeView.count : rootPost.likeCount ?? 0);
  const hideThreadMarkers = canHideCombinedThreadMarkers(posts);
  return { replyCount, repostCount, quoteCount, likeCount, liveLikeCount, hideThreadMarkers };
}


function threadUnavailableState(node: Exclude<ThreadNode, { post: FeedPost }>) {
  const type = node.$type?.toLowerCase() || "";
  const message = node.message?.trim();

  if (type.includes("blocked")) {
    return {
      tone: "blocked",
      title: "Blocked reply",
      detail: message || "Bluesky did not return this branch because one of the accounts is blocked.",
    };
  }

  if (type.includes("notfound") || type.includes("not-found")) {
    return {
      tone: "missing",
      title: "Reply not found",
      detail: message || "This reply is no longer available from Bluesky.",
    };
  }

  if (type.includes("tombstone") || type.includes("deleted")) {
    return {
      tone: "deleted",
      title: "Deleted reply",
      detail: message || "This reply was deleted, but the surrounding conversation is still shown.",
    };
  }

  if (type.includes("rate") || message?.toLowerCase().includes("rate")) {
    return {
      tone: "rate-limit",
      title: "Reply temporarily unavailable",
      detail: message || "Bluesky rate-limited this branch. Try opening it again later.",
    };
  }

  return {
    tone: "unavailable",
    title: "Unavailable reply",
    detail: message || "Bluesky did not return this thread item.",
  };
}


export function useComposerTargets() {
  const [activeReplyParentUri, setActiveReplyParentUri] = useState<string | null>(null);
  const [activeQuoteUri, setActiveQuoteUri] = useState<string | null>(null);
  const toggleReplyFor = useCallback((uri: string) => {
    setActiveReplyParentUri((current) => (current === uri ? null : uri));
    setActiveQuoteUri(null);
  }, []);
  const toggleQuoteFor = useCallback((uri: string) => {
    setActiveQuoteUri((current) => (current === uri ? null : uri));
    setActiveReplyParentUri(null);
  }, []);
  const closeReply = useCallback(() => setActiveReplyParentUri(null), []);
  const closeQuote = useCallback(() => setActiveQuoteUri(null), []);
  return { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote };
}


function CombinedThreadSegments({
  posts,
  hideThreadMarkers,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
}: {
  posts: FeedPost[];
  hideThreadMarkers: boolean;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const onOpenTag = useContext(TagSearchContext);
  return (
    <div className="combined-thread-text">
      {posts.map((post, index) => {
        const segment = combinedThreadSegment(post, hideThreadMarkers);
        // Render the full embed set (link cards, quotes, unsupported-embed
        // notices), not just media, so a self-thread part carrying a link card or
        // quote isn't silently dropped from the feed. Skip a part that has neither
        // text nor embeds.
        const hasEmbeds = postHasEmbeds(post);
        if (!segment.text && !hasEmbeds) {
          return null;
        }
        return (
          <section className="combined-thread-segment" key={post.uri}>
            <p className={postTextClass(segment.text)}>
              {index > 0 && <span className="combined-thread-break" aria-hidden="true" />}
              {segment.text
                ? renderRichText(segment.text, segment.facets, onOpenProfile, onOpenTag)
                : `Post ${index + 1} has no plain text.`}
            </p>
            <PostEmbeds
              post={post}
              onOpenImage={onOpenImage}
              onOpenPost={onOpenPost}
              onOpenProfile={onOpenProfile}
            />
          </section>
        );
      })}
    </div>
  );
}

function CombinedThreadActionBar({
  rootPost,
  stats,
  likeView,
  bookmarkView,
  shareState,
  onShare,
  onOpenThreadReplies,
  openThreadTitle,
  reply,
  quote,
}: {
  rootPost: FeedPost;
  stats: Pick<ReturnType<typeof combinedThreadStats>, "replyCount" | "repostCount" | "quoteCount" | "liveLikeCount">;
  likeView?: LikeView;
  bookmarkView?: BookmarkView;
  shareState: ShareState;
  onShare: () => void;
  onOpenThreadReplies: () => void;
  openThreadTitle: string;
  reply?: { active: boolean; onClick: () => void; disabled?: boolean; title: string };
  quote?: { active: boolean; onClick: () => void; disabled?: boolean; title: string };
}) {
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const { replyCount, repostCount, quoteCount, liveLikeCount } = stats;
  return (
    <footer className="post-actions combined-thread-actions">
      <button type="button" onClick={onOpenThreadReplies} title={openThreadTitle}>
        <MessageCircle size={16} /> {replyCount}
      </button>
      <span title="Total reposts across combined posts">
        <Repeat2 size={16} /> {repostCount}
      </span>
      <span title="Total quotes across combined posts">
        <Share2 size={16} /> {quoteCount}
      </span>
      {likeCtx?.canLike && likeView ? (
        <button
          type="button"
          className={likeView.liked ? "liked" : ""}
          onClick={() => likeCtx.toggle(rootPost)}
          title={likeView.liked ? "Unlike first post" : "Like first post"}
        >
          <Heart size={16} /> {liveLikeCount}
        </button>
      ) : (
        <span title="Total likes across combined posts">
          <Heart size={16} /> {liveLikeCount}
        </span>
      )}
      {bookmarkCtx?.canBookmark && bookmarkView ? (
        <button
          type="button"
          className={bookmarkView.error ? "bookmark-error" : bookmarkView.bookmarked ? "bookmarked" : ""}
          onClick={() => bookmarkCtx.toggle(rootPost)}
          title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark from first post" : "Bookmark first post")}
        >
          <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
        </button>
      ) : null}
      <button type="button" onClick={onShare} title="Share first post">
        <Share2 size={16} /> {shareButtonLabel(shareState)}
      </button>
      <a href={postBskyUrl(rootPost)} target="_blank" rel="noreferrer" title="Open first post on Bluesky">
        <LinkIcon size={16} /> Open on Bluesky
      </a>
      {reply && (
        <button
          type="button"
          className={reply.active ? "active" : ""}
          onClick={reply.onClick}
          disabled={reply.disabled}
          title={reply.title}
        >
          <MessageCircle size={16} /> Reply
        </button>
      )}
      {quote && (
        <button
          type="button"
          className={quote.active ? "active" : ""}
          onClick={quote.onClick}
          disabled={quote.disabled}
          title={quote.title}
        >
          <Quote size={16} /> Quote
        </button>
      )}
    </footer>
  );
}

export function ThreadedPostCard({
  thread,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  onQuote,
  quoteActive = false,
}: {
  thread: ThreadedFeedItem;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
}) {
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const posts = [thread.root.post, ...thread.replies.map((item) => item.post)];
  const rootPost = thread.root.post;
  const { shareState, handleShare } = useSharePost(rootPost, posts);
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  const { replyCount, repostCount, quoteCount, liveLikeCount, hideThreadMarkers } = combinedThreadStats(posts, rootPost, likeView);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onReply);

  return (
    <article className="post-card thread-combined-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(rootPost)} title="Open full thread">
        <MessageCircle size={13} />
        <span>{posts.length} post thread</span>
      </button>
      <CombinedThreadSegments
        posts={posts}
        hideThreadMarkers={hideThreadMarkers}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
      />
      <CombinedThreadActionBar
        rootPost={rootPost}
        stats={{ replyCount, repostCount, quoteCount, liveLikeCount }}
        likeView={likeView}
        bookmarkView={bookmarkView}
        shareState={shareState}
        onShare={handleShare}
        onOpenThreadReplies={() => onOpenPost?.(rootPost)}
        openThreadTitle="Open full thread replies"
        reply={
          onReply
            ? { active: replyActive, onClick: handleReplyClick, title: "Reply to the first post in this thread" }
            : undefined
        }
        quote={
          onQuote
            ? { active: quoteActive, onClick: () => onQuote(rootPost), title: "Quote the first post in this thread" }
            : undefined
        }
      />
      {showReplyLimited && <ReplyLimitedNotice />}
    </article>
  );
}






function CombinedThreadViewCard({
  parts,
  activeReplyParentUri,
  canReply,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onShowReplies,
  onOpenReply,
  onCloseReply,
  onReplied,
  threadRootRef,
  activeQuoteUri,
  onOpenQuote,
  onCloseQuote,
  onQuoted,
}: {
  parts: ThreadPart[];
  activeReplyParentUri: string | null;
  canReply: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onShowReplies?: () => void;
  onOpenReply: (post: FeedPost) => void;
  onCloseReply: () => void;
  onReplied?: () => void;
  threadRootRef: PostRefValue;
  activeQuoteUri: string | null;
  onOpenQuote: (post: FeedPost) => void;
  onCloseQuote: () => void;
  onQuoted?: () => void;
}) {
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const rootPost = parts[0].node.post;
  const posts = parts.map((part) => part.node.post);
  const { shareState, handleShare } = useSharePost(rootPost, posts);
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  const { replyCount, repostCount, quoteCount, liveLikeCount, hideThreadMarkers } = combinedThreadStats(posts, rootPost, likeView);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onOpenReply);

  return (
    <article className="post-card combined-thread-view-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      <CombinedThreadSegments
        posts={posts}
        hideThreadMarkers={hideThreadMarkers}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
      />
      {activeReplyParentUri === rootPost.uri && (
        <PostComposer
          replyTo={{ parent: rootPost, root: threadRootRef }}
          canReply={canReply}
          onClose={onCloseReply}
          onReplied={onReplied}
        />
      )}
      {activeQuoteUri === rootPost.uri && (
        <PostComposer quote={rootPost} onClose={onCloseQuote} onQuoted={onQuoted} />
      )}
      <CombinedThreadActionBar
        rootPost={rootPost}
        stats={{ replyCount, repostCount, quoteCount, liveLikeCount }}
        likeView={likeView}
        bookmarkView={bookmarkView}
        shareState={shareState}
        onShare={handleShare}
        onOpenThreadReplies={() => (onShowReplies ? onShowReplies() : onOpenPost(rootPost))}
        openThreadTitle="Show full thread replies"
        reply={{
          active: activeReplyParentUri === rootPost.uri,
          onClick: handleReplyClick,
          disabled: !canReply,
          title: "Reply to the first post in this thread",
        }}
        quote={{
          active: activeQuoteUri === rootPost.uri,
          onClick: () => onOpenQuote(rootPost),
          disabled: !canReply,
          title: "Quote the first post in this thread",
        }}
      />
      {showReplyLimited && <ReplyLimitedNotice />}
    </article>
  );
}




function findFirstThreadPost(node?: ThreadNode): FeedPost | null {
  if (!node || !("post" in node)) {
    return null;
  }

  return node.post;
}

function collectThreadParents(node?: ThreadNode): ThreadNode[] {
  if (!node || !("post" in node) || !node.parent) {
    return [];
  }

  return [...collectThreadParents(node.parent), node.parent];
}

function replyPermissionLabel(post: FeedPost) {
  const labels = post.labels?.map((label) => label.val).filter(Boolean);
  if (labels?.some((label) => label?.includes("!warn") || label?.includes("adult"))) {
    return "Reply permissions may be limited by content labels";
  }

  return "Everybody can reply";
}

export function ThreadView({
  currentDid,
  localLists,
  thread,
  loadingBranches,
  branchResults,
  onOpenImage,
  onLoadBranch,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  canReply = false,
  onReplied,
}: {
  currentDid?: string;
  localLists: LocalList[];
  thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string };
  loadingBranches: Record<string, boolean>;
  branchResults: Record<string, BranchLoadResult>;
  onOpenImage: (image: ImageViewerState) => void;
  onLoadBranch: (uri: string) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  canReply?: boolean;
  onReplied?: () => void;
}) {
  const density = useContext(DensityContext);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [engagement, setEngagement] = useState<null | "reposts" | "quotes" | "likes">(null);
  const { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote } = useComposerTargets();
  const [threadDisplayMode, setThreadDisplayMode] = useState<"combined" | "separated">("combined");
  // Re-root self-threads: when the opened post is mid-chain (e.g. part 3 of 5
  // via search/URL), buildAnchoredThreadParts walks UP the parent chain so the
  // whole self-thread combines from its true root instead of splitting parts
  // 1–2 into "Reply context". selfRootNode is that true root; the header stats
  // and parent-context list key off it (not the anchored post).
  const threadParts = thread.node ? buildAnchoredThreadParts(thread.node) : [];
  const selfRootNode = threadParts[0]?.node ?? thread.node;
  const rootPost = findFirstThreadPost(selfRootNode);
  const parentNodes = collectThreadParents(selfRootNode);
  const threadRootRef = rootPost ? replyRootRefForPost(rootPost) : null;
  const canCombineThread = threadParts.length > 1;

  if (thread.status === "loading") {
    return <LoadingState label="Loading thread" />;
  }

  if (thread.status === "error") {
    return <ErrorState message={thread.error || "Thread failed to load."} />;
  }

  if (!thread.node) {
    return <ErrorState message="No thread selected." />;
  }

  return (
    <div className={`thread-view ${density}`}>
      {rootPost && (
        <section className="thread-detail-header">
          <div>
            <span>Conversation</span>
            <a
              className="thread-author-link"
              href={profilePath(rootPost.author)}
              onClick={(event) => handleInternalLinkClick(event, () => onOpenProfile(rootPost.author))}
            >
              <h2>{displayName(rootPost.author)}</h2>
              <p>
                @{rootPost.author.handle} · {formatPostTime(postSortAt(rootPost))}
              </p>
            </a>
          </div>
          <dl>
            <div>
              <dt>Replies</dt>
              <dd>{(rootPost.replyCount ?? 0).toLocaleString()}</dd>
            </div>
            {([
              { key: "reposts", label: "Reposts", count: rootPost.repostCount },
              { key: "quotes", label: "Quotes", count: rootPost.quoteCount },
              { key: "likes", label: "Likes", count: rootPost.likeCount },
            ] as const).map((stat) => (
              <div key={stat.key}>
                <dt>{stat.label}</dt>
                <dd>
                  <button
                    type="button"
                    className={engagement === stat.key ? "thread-stat-button active" : "thread-stat-button"}
                    onClick={() => setEngagement((current) => (current === stat.key ? null : stat.key))}
                    disabled={!stat.count}
                    aria-pressed={engagement === stat.key}
                  >
                    {(stat.count ?? 0).toLocaleString()}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <div className="thread-permissions">
            <Users size={15} />
            <span>{replyPermissionLabel(rootPost)}</span>
          </div>
          {canCombineThread && (
            <div className="thread-view-mode" role="group" aria-label="Thread display mode">
              <button
                type="button"
                className={threadDisplayMode === "combined" ? "selected" : ""}
                onClick={() => setThreadDisplayMode("combined")}
              >
                Combined
              </button>
              <button
                type="button"
                className={threadDisplayMode === "separated" ? "selected" : ""}
                onClick={() => setThreadDisplayMode("separated")}
              >
                Separated
              </button>
            </div>
          )}
          {engagement && (
            <ThreadEngagementPanel
              uri={rootPost.uri}
              kind={engagement}
              onOpenProfile={onOpenProfile}
              onOpenPost={onOpenPost}
              onClose={() => setEngagement(null)}
            />
          )}
        </section>
      )}
      {parentNodes.length > 0 && (
        <section className="thread-parent-context" aria-label="Parent posts">
          <header>
            <span>Reply context</span>
            <strong>{parentNodes.length === 1 ? "1 parent post" : `${parentNodes.length} parent posts`}</strong>
          </header>
          {parentNodes.map((parentNode, index) =>
            renderThreadContextNode(
              parentNode,
              index,
              parentNodes.length,
              { loadingBranches, branchResults, onLoadBranch, onOpenImage, onOpenPost, onOpenProfile },
              { currentDid, localLists, onToggleListPost },
            ),
          )}
        </section>
      )}
      {canCombineThread && threadDisplayMode === "combined" && threadRootRef ? (
        <CombinedThreadViewCard
          parts={threadParts}
          activeReplyParentUri={activeReplyParentUri}
          canReply={canReply}
          onOpenImage={onOpenImage}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onShowReplies={() => setThreadDisplayMode("separated")}
          onOpenReply={(post) => toggleReplyFor(post.uri)}
          onCloseReply={closeReply}
          onReplied={onReplied}
          threadRootRef={threadRootRef}
          activeQuoteUri={activeQuoteUri}
          onOpenQuote={(post) => toggleQuoteFor(post.uri)}
          onCloseQuote={closeQuote}
          onQuoted={onReplied}
        />
      ) : threadParts.length > 1 && threadRootRef ? (
        <LongThreadCard
          parts={threadParts}
          expandedReplies={expandedBranches}
          onToggleReplies={(uri) => setExpandedBranches((current) => ({ ...current, [`part-replies:${uri}`]: !current[`part-replies:${uri}`] }))}
          onToggleBranch={(uri) => setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] }))}
          handlers={{
            loadingBranches,
            branchResults,
            onLoadBranch,
            onOpenImage,
            onOpenPost,
            onOpenProfile,
            activeReplyParentUri,
            canReply,
            onOpenReply: (post) => toggleReplyFor(post.uri),
            onCloseReply: closeReply,
            onReplied,
            threadRootRef,
            activeQuoteUri,
            onOpenQuote: (post) => toggleQuoteFor(post.uri),
            onCloseQuote: closeQuote,
            onQuoted: onReplied,
          }}
          savedState={{ currentDid, localLists, onToggleListPost }}
        />
      ) : (
        renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
          setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
          {
            loadingBranches,
            branchResults,
            onLoadBranch,
            onOpenImage,
            onOpenPost,
            onOpenProfile,
            activeReplyParentUri,
            canReply,
            onOpenReply: (post) => toggleReplyFor(post.uri),
            onCloseReply: closeReply,
            onReplied,
            threadRootRef,
            activeQuoteUri,
            onOpenQuote: (post) => toggleQuoteFor(post.uri),
            onCloseQuote: closeQuote,
            onQuoted: onReplied,
          },
          { currentDid, localLists, onToggleListPost },
          1,
        )
      )}
    </div>
  );
}

function renderThreadContextNode(
  node: ThreadNode,
  index: number,
  total: number,
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
  },
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  },
) {
  if (!("post" in node)) {
    const state = threadUnavailableState(node);

    return (
      <div className={`thread-context-item unavailable ${state.tone}`} key={`parent:${index}`}>
        <span className="thread-context-step">{index + 1}</span>
        <div className={`thread-alert ${state.tone}`}>
          <ShieldAlert size={16} />
          <span>
            <strong>{state.title}</strong>
            <small>{state.detail}</small>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-context-item" key={node.post.uri}>
      <span className="thread-context-step">{index + 1}</span>
      <div>
        <small>
          {index + 1 === total ? "Direct parent" : `Parent ${index + 1} of ${total}`}
        </small>
        <PostCard
          item={{ post: node.post }}
          currentDid={savedState.currentDid}
          forceFullCard
          onOpenImage={handlers.onOpenImage}
          onOpenPost={handlers.onOpenPost}
          onOpenProfile={handlers.onOpenProfile}
          localLists={savedState.localLists}
          onToggleListPost={savedState.onToggleListPost}
        />
      </div>
    </div>
  );
}

function LongThreadCard({
  parts,
  expandedReplies,
  onToggleReplies,
  onToggleBranch,
  handlers,
  savedState,
}: {
  parts: ThreadPart[];
  expandedReplies: Record<string, boolean>;
  onToggleReplies: (uri: string) => void;
  onToggleBranch: (uri: string) => void;
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
    activeReplyParentUri: string | null;
    canReply: boolean;
    onOpenReply: (post: FeedPost) => void;
    onCloseReply: () => void;
    onReplied?: () => void;
    threadRootRef: PostRefValue;
    activeQuoteUri: string | null;
    onOpenQuote: (post: FeedPost) => void;
    onCloseQuote: () => void;
    onQuoted?: () => void;
  };
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  };
}) {
  const onOpenTag = useContext(TagSearchContext);
  const rootPost = parts[0].node.post;
  const firstTimeLabel = formatPostTime(postSortAt(rootPost));
  const totalReplies = parts.reduce((total, part) => total + part.replies.length, 0);

  return (
    <article className="post-card long-thread-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={firstTimeLabel}
        onOpenProfile={handlers.onOpenProfile}
        onOpenPost={handlers.onOpenPost}
      />
      <div className="post-badges" aria-label="Thread context">
        <span>{parts.length.toLocaleString()} part thread</span>
        <span>{totalReplies === 1 ? "1 reply" : `${totalReplies.toLocaleString()} replies`}</span>
      </div>
      <div className="long-thread-parts">
        {parts.map((part, index) => {
          const post = part.node.post;
          const text = post.record.text?.trim() || "";
          const replyCount = part.replies.length;
          const expanded = !!expandedReplies[`part-replies:${post.uri}`];
          const hasThreadContinuation = parts[index + 1]?.node.post.record.reply?.parent?.uri === post.uri;
          // post.replyCount (AppView) counts ALL replies incl. the continuation,
          // so subtract it. The fallback (part.replies) already excludes the
          // continuation in buildThreadParts, so it must NOT be decremented again.
          const commentCount =
            post.replyCount != null ? Math.max(0, post.replyCount - (hasThreadContinuation ? 1 : 0)) : replyCount;
          return (
            <section className="long-thread-part" key={post.uri}>
              <div className="long-thread-part-label">Thread post {part.partNumber} of {parts.length}</div>
              {text ? (
                <p className={postTextClass(text)}>
                  {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, handlers.onOpenProfile, onOpenTag)}
                </p>
              ) : (
                <p className="post-text muted">Thread post {part.partNumber} has no plain text.</p>
              )}
              <PostEmbeds
                post={post}
                onOpenImage={handlers.onOpenImage}
                onOpenPost={handlers.onOpenPost}
                onOpenProfile={handlers.onOpenProfile}
              />
              <PostActionBar
                post={post}
                commentCount={commentCount}
                commentTitle={
                  part.replies.length > 0
                    ? "Show replies to this thread post"
                    : commentCount > 0
                      ? "Open this thread post to see its replies"
                      : "No replies to this thread post"
                }
                onOpenPost={() => {
                  // Descendant parts carry their hydrated replies, so toggle them
                  // inline. Ancestor parts (from buildAnchoredThreadParts) have
                  // their replies stripped to [] — the AppView only hydrates the
                  // anchor subtree — so an inline toggle has nothing to show. When
                  // such a part still reports replies (commentCount > 0), open it
                  // in its own thread view where its replies hydrate, instead of
                  // leaving a dead button.
                  if (part.replies.length > 0) {
                    onToggleReplies(post.uri);
                  } else if (commentCount > 0) {
                    handlers.onOpenPost(post);
                  }
                }}
                onReply={handlers.onOpenReply}
                replyActive={handlers.activeReplyParentUri === post.uri}
                canReply={handlers.canReply}
                onQuote={handlers.onOpenQuote}
                quoteActive={handlers.activeQuoteUri === post.uri}
              />
              {handlers.activeReplyParentUri === post.uri && (
                <PostComposer
                  replyTo={{ parent: post, root: handlers.threadRootRef }}
                  canReply={handlers.canReply}
                  onClose={handlers.onCloseReply}
                  onReplied={handlers.onReplied}
                />
              )}
              {handlers.activeQuoteUri === post.uri && (
                <PostComposer quote={post} onClose={handlers.onCloseQuote} onQuoted={handlers.onQuoted} />
              )}
              {expanded && part.replies.length > 0 && (
                <div className="long-thread-replies">
                  <div className="thread-replies-divider">
                    <span>Replies to thread post {part.partNumber}</span>
                  </div>
                  {part.replies.map((reply) =>
                    renderThreadNode(
                      reply,
                      0,
                      expandedReplies,
                      onToggleBranch,
                      handlers,
                      savedState,
                    ),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}

function threadDepthStyle(depth: number): CSSProperties {
  return { "--thread-depth": depth } as CSSProperties;
}

function renderThreadNode(
  node: ThreadNode,
  depth: number,
  expandedBranches: Record<string, boolean>,
  onToggleBranch: (uri: string) => void,
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
    activeReplyParentUri: string | null;
    canReply: boolean;
    onOpenReply: (post: FeedPost) => void;
    onCloseReply: () => void;
    onReplied?: () => void;
    threadRootRef: PostRefValue | null;
    activeQuoteUri: string | null;
    onOpenQuote: (post: FeedPost) => void;
    onCloseQuote: () => void;
    onQuoted?: () => void;
  },
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  },
  opPartIndex?: number,
): ReactNode {
  if (!("post" in node)) {
    const state = threadUnavailableState(node);

    return (
      <div className={`thread-alert ${state.tone}`} style={threadDepthStyle(depth)}>
        <ShieldAlert size={16} />
        <span>
          <strong>{state.title}</strong>
          <small>{state.detail}</small>
        </span>
      </div>
    );
  }

  const replies = node.replies ?? [];
  const isExpanded = !!expandedBranches[node.post.uri];
  const continuationReply = getContinuationReply(node.post, replies);
  const discussionReplies = continuationReply ? replies.filter((reply) => reply !== continuationReply) : replies;
  const visibleReplies = isExpanded ? discussionReplies : discussionReplies.slice(0, 8);
  const hiddenReplyCount = Math.max(0, discussionReplies.length - visibleReplies.length);
  const hasCollapsedReplies = discussionReplies.length > 8;
  const knownReplyCount = node.post.replyCount ?? 0;
  const hasUnloadedReplies = knownReplyCount > replies.length;
  const isLoadingBranch = !!handlers.loadingBranches[node.post.uri];
  const branchResult = handlers.branchResults[node.post.uri];
  const canLoadUnloadedReplies = hasUnloadedReplies && (!hasCollapsedReplies || isExpanded);

  return (
    <div className="thread-node" key={node.post.uri} style={threadDepthStyle(depth)}>
      <PostCard
        item={{ post: node.post }}
        currentDid={savedState.currentDid}
        forceFullCard
        onOpenImage={handlers.onOpenImage}
        onOpenPost={handlers.onOpenPost}
        onOpenProfile={handlers.onOpenProfile}
        onReply={handlers.canReply ? handlers.onOpenReply : undefined}
        replyActive={handlers.activeReplyParentUri === node.post.uri}
        onQuote={handlers.canReply ? handlers.onOpenQuote : undefined}
        quoteActive={handlers.activeQuoteUri === node.post.uri}
        localLists={savedState.localLists}
        onToggleListPost={savedState.onToggleListPost}
      />
      {handlers.activeReplyParentUri === node.post.uri && handlers.threadRootRef && (
        <PostComposer
          replyTo={{ parent: node.post, root: handlers.threadRootRef }}
          canReply={handlers.canReply}
          onClose={handlers.onCloseReply}
          onReplied={handlers.onReplied}
        />
      )}
      {handlers.activeQuoteUri === node.post.uri && (
        <PostComposer quote={node.post} onClose={handlers.onCloseQuote} onQuoted={handlers.onQuoted} />
      )}
      {continuationReply && (
        <>
          <div className="thread-continuation" style={threadDepthStyle(depth + 1)}>
            <span>Post continues</span>
          </div>
          {renderThreadNode(continuationReply, depth + 1, expandedBranches, onToggleBranch, handlers, savedState, (opPartIndex ?? 1) + 1)}
        </>
      )}
      {visibleReplies.length > 0 && (
        <div className="thread-replies-divider" style={threadDepthStyle(depth + 1)}>
          <span>{opPartIndex ? `Replies to post ${opPartIndex}` : "Replies"}</span>
        </div>
      )}
      {visibleReplies.map((reply) =>
        renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch, handlers, savedState),
      )}
      {hasCollapsedReplies && (
        <button className="load-more branch-toggle" type="button" onClick={() => onToggleBranch(node.post.uri)}>
          {isExpanded ? "Show fewer replies" : `Show ${hiddenReplyCount} more replies`}
        </button>
      )}
      {canLoadUnloadedReplies && isLoadingBranch && (
        <div className="branch-load-status" role="status">
          Loading replies...
        </div>
      )}
      {canLoadUnloadedReplies && !isLoadingBranch && (
        <button
          className="load-more branch-toggle"
          type="button"
          onClick={() => handlers.onLoadBranch(node.post.uri)}
        >
          {`Load ${knownReplyCount - replies.length} more replies`}
        </button>
      )}
      {!isLoadingBranch && branchResult?.error && (
        <div className="branch-load-status branch-load-error" role="alert">
          Couldn't load replies — {branchResult.error}
        </div>
      )}
      {!isLoadingBranch && branchResult && branchResult.error === undefined && (
        <div className="branch-load-status" role="status">
          {branchResult.added > 0
            ? `Loaded ${branchResult.added.toLocaleString()} more ${branchResult.added === 1 ? "reply" : "replies"}`
            : "No new replies returned"}
        </div>
      )}
    </div>
  );
}
