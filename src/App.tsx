import {
  Bell,
  Bookmark,
  Compass,
  Feather,
  Hash,
  Home,
  Image,
  LayoutList,
  List,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Search,
  Send,
  Settings,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FeedItem,
  type FeedPost,
  type Profile,
  type ThreadNode,
  getEmbedImages,
  getExternalEmbed,
  getFeed,
  getPostThread,
} from "./api";
import { getRouteState, type RouteState } from "./router";
import { displayName, feedSources, navigationItems, type FeedSource } from "./sources";

const navIcons = [Home, Compass, Bell, MessageCircle, Hash, List, Bookmark, User, Settings];

type FeedState = {
  items: FeedItem[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

type ImageViewerState = {
  images: Array<{
    src: string;
    alt: string;
  }>;
  index: number;
} | null;

export function App() {
  const [route, setRoute] = useState<RouteState>(() => getRouteState());
  const [activeSourceId, setActiveSourceId] = useState(feedSources[0].id);
  const [feedState, setFeedState] = useState<FeedState>({ items: [], status: "idle" });
  const [composerText, setComposerText] = useState("");
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const [density, setDensity] = useState(() => localStorage.getItem("bigbsky:density") || "comfortable");
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const activeSource = feedSources.find((source) => source.id === activeSourceId) ?? feedSources[0];
  const groupedSources = useMemo(
    () =>
      feedSources.reduce<Record<string, FeedSource[]>>((groups, source) => {
        groups[source.group] = [...(groups[source.group] ?? []), source];
        return groups;
      }, {}),
    [],
  );
  const loadFeed = useCallback(async (source: FeedSource, cursor?: string) => {
    const controller = new AbortController();
    setFeedState((current) => ({
      ...current,
      status: cursor ? current.status : "loading",
      error: undefined,
    }));

    try {
      const response = await getFeed(source.uri, cursor, controller.signal);
      setFeedState((current) => ({
        items: cursor ? [...current.items, ...response.feed] : response.feed,
        cursor: response.cursor,
        status: "ready",
      }));
    } catch (error) {
      if (!controller.signal.aborted) {
        setFeedState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (route.kind === "post") {
      return undefined;
    }

    return void loadFeed(activeSource);
  }, [activeSource, loadFeed, route.kind]);

  useEffect(() => {
    const onPopState = () => setRoute(getRouteState());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    localStorage.setItem("bigbsky:density", density);
  }, [density]);

  useEffect(() => {
    if (route.kind !== "post") {
      setThread({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setThread({ status: "loading" });
    getPostThread(route.actor, route.rkey, controller.signal)
      .then((response) => setThread({ status: "ready", node: response.thread }))
      .catch((error) =>
        setThread({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return () => controller.abort();
  }, [route]);

  function navigate(nextRoute: RouteState, path = "/") {
    window.history.pushState(null, "", path);
    setRoute(nextRoute);
  }

  const remainingChars = 300 - composerText.length;

  return (
    <div className="app-shell">
      <aside className="left-rail" aria-label="Primary">
        <button className="brand-button" type="button" onClick={() => navigate({ kind: "feed" })} title="BigBSky">
          <Feather size={22} />
        </button>
        <nav className="rail-nav">
          {navigationItems.map((item, index) => {
            const Icon = navIcons[index];
            return (
              <button key={item} className="rail-button" type="button" title={item}>
                <Icon size={20} />
                <span>{item}</span>
              </button>
            );
          })}
        </nav>
        <button className="compose-button" type="button" title="New post">
          <Send size={20} />
        </button>
      </aside>

      <aside className="feed-map" aria-label="Feeds">
        <div className="feed-map-header">
          <strong>Feeds</strong>
          <button type="button" title="Search feeds">
            <Search size={16} />
          </button>
        </div>
        {Object.entries(groupedSources).map(([group, sources]) => (
          <section className="feed-group" key={group}>
            <h2>{group}</h2>
            {sources?.map((source) => (
              <button
                className={source.id === activeSourceId ? "feed-source active" : "feed-source"}
                key={source.id}
                type="button"
                onClick={() => {
                  setActiveSourceId(source.id);
                  navigate({ kind: "feed" });
                  timelineRef.current?.scrollTo({ top: 0 });
                }}
              >
                <span>{source.label}</span>
                <small>{source.description}</small>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p>{route.kind === "post" ? "Thread" : "Active Feed"}</p>
            <h1>{route.kind === "post" ? "Post Conversation" : activeSource.label}</h1>
          </div>
          <div className="segmented" aria-label="Density">
            {["comfortable", "compact", "media"].map((mode) => (
              <button
                className={density === mode ? "selected" : ""}
                key={mode}
                type="button"
                onClick={() => setDensity(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </header>

        {route.kind === "post" ? (
          <ThreadView thread={thread} />
        ) : (
          <div
            className={`timeline ${density}`}
            ref={timelineRef}
          >
            <Composer
              remainingChars={remainingChars}
              text={composerText}
              onTextChange={setComposerText}
            />
            {feedState.status === "loading" && <LoadingState label="Loading public Bluesky posts" />}
            {feedState.status === "error" && <ErrorState message={feedState.error || "Feed failed to load."} />}
            {feedState.status === "ready" && (
              <>
                {feedState.items.map((item) => (
                  <PostCard
                    item={item}
                    key={item.post.uri}
                    onOpenImage={setImageViewer}
                  />
                ))}
                {feedState.cursor && (
                  <button className="load-more" type="button" onClick={() => void loadFeed(activeSource, feedState.cursor)}>
                    Load more
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>

      <aside className="right-rail" aria-label="Context">
        <div className="search-box">
          <Search size={18} />
          <input aria-label="Search" placeholder="Search Bluesky" />
        </div>
        <FeedContextPanel source={activeSource} />
        <section className="context-panel">
          <h2>Build Posture</h2>
          <p>Static SPA. No Pages Functions, Workers, bindings, KV, D1, R2, or backend sessions for v1.</p>
        </section>
        <section className="context-panel">
          <h2>Trending</h2>
          <button type="button">#atproto</button>
          <button type="button">#bluesky</button>
          <button type="button">#socialweb</button>
        </section>
      </aside>

      {imageViewer && <ImageViewer image={imageViewer} onChange={setImageViewer} onClose={() => setImageViewer(null)} />}
    </div>
  );
}

function Composer({
  text,
  remainingChars,
  onTextChange,
}: {
  text: string;
  remainingChars: number;
  onTextChange: (value: string) => void;
}) {
  return (
    <section className="composer" aria-label="Composer">
      <textarea
        placeholder="What should BigBSky post after OAuth is added?"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <div className="composer-actions">
        <button type="button" title="Attach image">
          <Image size={18} />
        </button>
        <span className={remainingChars < 0 ? "over-limit" : ""}>{remainingChars}</span>
        <button type="button" disabled={remainingChars < 0 || text.trim().length === 0}>
          Post
        </button>
      </div>
    </section>
  );
}

function PostCard({ item, onOpenImage }: { item: FeedItem; onOpenImage?: (image: ImageViewerState) => void }) {
  const post = item.post;
  const images = getEmbedImages(post.embed);
  const external = getExternalEmbed(post.embed);

  return (
    <article className="post-card">
      <header className="post-header">
        <Avatar profile={post.author} />
        <div>
          <strong>{displayName(post.author)}</strong>
          <span>@{post.author.handle}</span>
        </div>
        <button type="button" title="More">
          <MoreHorizontal size={18} />
        </button>
      </header>
      {item.reason?.by && <p className="reason">Reposted by {displayName(item.reason.by)}</p>}
      {item.reply?.parent && <p className="reason">Replying in a thread from @{item.reply.parent.author.handle}</p>}
      <p className="post-text">{post.record.text || "Post has no plain text."}</p>
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((image) => (
            <button
              className="image-button"
              key={image.thumb || image.fullsize}
              type="button"
              onClick={() => {
                const viewerImages = images
                  .slice(0, 4)
                  .map((viewerImage) => ({
                    src: viewerImage.fullsize || viewerImage.thumb || "",
                    alt: viewerImage.alt || "",
                  }))
                  .filter((viewerImage) => viewerImage.src);
                const selectedIndex = Math.max(0, viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb)));
                onOpenImage?.({ images: viewerImages, index: selectedIndex });
              }}
              aria-label={image.alt ? "Open image" : "Open full size image"}
            >
              <img alt={image.alt || ""} src={image.thumb || image.fullsize} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {external && (
        <a className="link-card" href={external.uri} target="_blank" rel="noreferrer">
          {external.thumb && <img alt="" src={external.thumb} loading="lazy" />}
          <span>
            <strong>{external.title || external.uri}</strong>
            <small>{external.description}</small>
          </span>
        </a>
      )}
      <footer className="post-actions">
        <span>
          <MessageCircle size={16} /> {post.replyCount ?? 0}
        </span>
        <span>
          <Repeat2 size={16} /> {post.repostCount ?? 0}
        </span>
        <span>
          <Bell size={16} /> {post.likeCount ?? 0}
        </span>
      </footer>
    </article>
  );
}

function ThreadView({
  thread,
}: {
  thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string };
}) {
  if (thread.status === "loading") {
    return <LoadingState label="Loading thread" />;
  }

  if (thread.status === "error") {
    return <ErrorState message={thread.error || "Thread failed to load."} />;
  }

  if (!thread.node) {
    return <ErrorState message="No thread selected." />;
  }

  return <div className="thread-view">{renderThreadNode(thread.node, 0)}</div>;
}

function ImageViewer({
  image,
  onChange,
  onClose,
}: {
  image: NonNullable<ImageViewerState>;
  onChange: (image: NonNullable<ImageViewerState>) => void;
  onClose: () => void;
}) {
  const selected = image.images[image.index] ?? image.images[0];
  const hasMultiple = image.images.length > 1;
  const goPrevious = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    onChange({
      images: image.images,
      index: (image.index - 1 + image.images.length) % image.images.length,
    });
  }, [hasMultiple, image, onChange]);
  const goNext = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    onChange({
      images: image.images,
      index: (image.index + 1) % image.images.length,
    });
  }, [hasMultiple, image, onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, onClose]);

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={(event) => {
        const halfway = window.innerWidth / 2;
        if (!hasMultiple) {
          onClose();
          return;
        }

        if (event.clientX < halfway) {
          goPrevious();
        } else {
          goNext();
        }
      }}
    >
      <button
        className="image-viewer-close"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close image viewer"
      >
        <X size={22} />
      </button>
      {hasMultiple && (
        <>
          <button
            className="image-viewer-nav previous"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              goPrevious();
            }}
            aria-label="Previous image"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            className="image-viewer-nav next"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
            aria-label="Next image"
          >
            <ChevronRight size={30} />
          </button>
          <div className="image-viewer-count">
            {image.index + 1} / {image.images.length}
          </div>
        </>
      )}
      <img src={selected.src} alt={selected.alt} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

function renderThreadNode(node: ThreadNode, depth: number): React.ReactNode {
  if (!("post" in node)) {
    return (
      <div className="thread-alert" style={{ marginLeft: depth * 22 }}>
        {node.message || "Thread item is unavailable."}
      </div>
    );
  }

  return (
    <div className="thread-node" key={node.post.uri} style={{ marginLeft: depth * 22 }}>
      <PostCard item={{ post: node.post }} />
      {node.replies?.slice(0, 8).map((reply) => renderThreadNode(reply, depth + 1))}
      {(node.replies?.length ?? 0) > 8 && <button className="load-more">Load more replies</button>}
    </div>
  );
}

function FeedContextPanel({ source }: { source: FeedSource }) {
  return (
    <section className="profile-panel">
      <span className="feed-glyph">
        <Hash size={22} />
      </span>
      <h2>{source.label}</h2>
      <p>{source.description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>Feed</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Public</dd>
        </div>
      </dl>
    </section>
  );
}

function Avatar({ profile }: { profile?: Profile }) {
  return profile?.avatar ? <img className="avatar" src={profile.avatar} alt="" loading="lazy" /> : <span className="avatar fallback" />;
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="state">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error">
      <strong>Unable to load</strong>
      <span>{message}</span>
    </div>
  );
}
