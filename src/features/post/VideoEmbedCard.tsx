import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Film } from "lucide-react";
import { getVideoEmbed } from "../../api";
import { safeHttpUrl } from "../../lib/url";

function videoKindLabel(type?: string) {
  if (type?.toLowerCase().includes("gif")) {
    return "GIF";
  }

  return "Video";
}

type VideoEmbedView = NonNullable<ReturnType<typeof getVideoEmbed>>;

export function VideoEmbedCard({ video, compact = false }: { video: VideoEmbedView; compact?: boolean }) {
  const kind = videoKindLabel(video.type);
  const playlist = safeHttpUrl(video.playlist);
  const thumbnail = safeHttpUrl(video.thumbnail);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const aspectRatio =
    video.aspectRatio?.width && video.aspectRatio?.height
      ? `${video.aspectRatio.width} / ${video.aspectRatio.height}`
      : undefined;
  const videoFrameStyle = aspectRatio
    ? ({ "--video-aspect": aspectRatio } as CSSProperties)
    : undefined;

  useEffect(() => {
    const element = videoRef.current;
    if (!playlist || !element) {
      return undefined;
    }

    setUnsupported(false);
    let active = true;
    let destroy: (() => void) | undefined;
    import("hls.js")
      .then(({ default: Hls }) => {
        if (!active || !videoRef.current) {
          return;
        }
        if (!Hls.isSupported()) {
          if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
            videoRef.current.src = playlist;
          } else {
            setUnsupported(true);
          }
          return;
        }
        const hls = new Hls();
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) {
            setUnsupported(true);
          }
        });
        hls.loadSource(playlist);
        hls.attachMedia(videoRef.current);
      })
      .catch(() => {
        if (active) {
          setUnsupported(true);
        }
      });

    return () => {
      active = false;
      destroy?.();
      element.removeAttribute("src");
      element.load();
    };
  }, [playlist]);

  return (
    <div className={compact ? "video-card quote-video-card" : "video-card"} style={videoFrameStyle}>
      {playlist && !unsupported ? (
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={thumbnail}
          aria-label={video.alt ? `${kind}: ${video.alt}` : kind}
        />
      ) : thumbnail ? (
        <a className="video-fallback-link" href={thumbnail} target="_blank" rel="noreferrer">
          <img alt={video.alt || ""} src={thumbnail} loading="lazy" decoding="async" />
        </a>
      ) : (
        <span className="video-placeholder" />
      )}
      <span className="video-label">
        <Film size={16} /> {kind}
      </span>
      {video.alt && <span className="video-alt-text">{video.alt}</span>}
      {playlist && (
        <a className="video-open-link" href={playlist} target="_blank" rel="noreferrer">
          Open media
        </a>
      )}
    </div>
  );
}
