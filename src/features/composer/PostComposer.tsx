import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronUp, Image, Plus, Smile, X } from "lucide-react";
import { type FeedPost } from "../../api";
import { MAX_POST_IMAGES, publishPost, publishThread } from "../../auth";
import {
  POST_BYTE_LIMIT,
  POST_GRAPHEME_LIMIT,
  graphemeLength,
  splitTextForThread,
  utf8ByteLength,
} from "../../lib/threads";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from "../../lib/storage";
import { displayName } from "../../sources";
import { Avatar } from "../common/Avatar";
import { useDismissMenu } from "../common/useDismissMenu";

// A post reference (uri+cid) used as the reply `root`/`parent` and for opening
// thread views; shared with App (replyRootRefForPost + thread components).
export type PostRefValue = { uri: string; cid: string };

export const composerDraftStorageKey = "bigbsky:composer-draft";
const replyDraftPrefix = "bigbsky:reply-draft:";

// One in-progress composer image: the File to upload plus a preview object-URL,
// stable id, and editable alt text. Session-only (not persisted).
type ComposerImageState = { id: string; file: File; url: string; alt: string };

// Post language metadata. The native field is the post record's BCP-47 `langs`
// array (app.bsky.feed.post — docs allow multiple values, e.g. ["th","en-US"]),
// which we write via publishPost/publishThread.
//
// Verified against bsky.app (2026-06-14): the *default* post language is NOT an
// atproto account/profile preference — bsky stores it device-locally in
// BSKY_STORAGE.languagePrefs.postLanguage (alongside primaryLanguage/
// contentLanguages/postLanguageHistory, all client-side), initialized from the
// device locale. So there is no account-synced default to read; we mirror bsky
// by defaulting from the browser locale and persisting the choice browser-local.
const postLanguageStorageKey = "bigbsky:post-language";
// Recent post languages (most-recent-first), mirroring bsky's postLanguageHistory
// so the picker can surface the handful of languages the user actually posts in.
const postLanguageHistoryStorageKey = "bigbsky:post-language-history";
const POST_LANGUAGE_HISTORY_LIMIT = 4;

// The full set of ISO 639-1 two-letter language codes, matching the post
// languages bsky's composer offers. Names are rendered with Intl.DisplayNames in
// English (as bsky shows them), so we only need to maintain the code list.
const ISO_639_1_CODES = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu",
];

// English display name for a language code (matches bsky's English-name display),
// falling back to the uppercased code when Intl can't name it.
export function languageDisplayName(code: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (display && display.toLowerCase() !== code.toLowerCase()) {
      return display;
    }
  } catch {
    // Intl.DisplayNames unavailable — fall through to the code.
  }
  return code.toUpperCase();
}

export const POST_LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = (() => {
  const seenLabels = new Set<string>();
  return ISO_639_1_CODES.map((code) => ({ code, label: languageDisplayName(code) }))
    // Drop codes Intl couldn't name (label falls back to the bare code) and
    // collapse the rare case where two codes share one English name.
    .filter((option) => {
      if (option.label === option.code.toUpperCase() || seenLabels.has(option.label)) {
        return false;
      }
      seenLabels.add(option.label);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
})();

// Resolve a default post language: the last-used choice if any, else the
// browser's primary language (normalized to a base code we offer), else English.
function readDefaultPostLanguage(): string {
  try {
    const saved = localStorage.getItem(postLanguageStorageKey);
    if (saved && POST_LANGUAGE_OPTIONS.some((option) => option.code === saved)) {
      return saved;
    }
  } catch {
    // ignore storage failures and fall through to the browser/default guess
  }
  const candidates =
    typeof navigator !== "undefined"
      ? [navigator.language, ...(navigator.languages ?? [])].filter(Boolean)
      : [];
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split("-")[0];
    if (POST_LANGUAGE_OPTIONS.some((option) => option.code === base)) {
      return base;
    }
  }
  return "en";
}

function postLanguageLabel(code: string): string {
  return POST_LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ?? code;
}

function readPostLanguageHistory(): string[] {
  try {
    const raw = localStorage.getItem(postLanguageHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (code): code is string =>
        typeof code === "string" && POST_LANGUAGE_OPTIONS.some((option) => option.code === code),
    );
  } catch {
    return [];
  }
}

// Prepend the chosen language to the recent-history list (dedup, capped).
function recordPostLanguage(code: string) {
  const next = [code, ...readPostLanguageHistory().filter((entry) => entry !== code)].slice(
    0,
    POST_LANGUAGE_HISTORY_LIMIT,
  );
  safeLocalStorageSet(postLanguageHistoryStorageKey, JSON.stringify(next));
}

// bsky-style language picker: a text button showing the current language that
// opens a small menu of recent languages (with radio markers) plus a
// "More languages…" expansion to the full list. Closes on outside-click/Escape.
function PostLanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissMenu(rootRef, open, () => {
    setOpen(false);
    setShowAll(false);
  });

  // Recent languages to show first: the current value, then history, padded with
  // English so the short list is never empty.
  const recent: string[] = [];
  for (const code of [value, ...readPostLanguageHistory(), "en"]) {
    if (!recent.includes(code) && POST_LANGUAGE_OPTIONS.some((option) => option.code === code)) {
      recent.push(code);
    }
    if (recent.length >= POST_LANGUAGE_HISTORY_LIMIT) {
      break;
    }
  }

  function choose(code: string) {
    recordPostLanguage(code);
    onChange(code);
    setOpen(false);
    setShowAll(false);
  }

  const listed = showAll ? POST_LANGUAGE_OPTIONS.map((option) => option.code) : recent;

  return (
    <div className="composer-language" ref={rootRef}>
      <button
        type="button"
        className="composer-language-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Post language"
        onClick={() => setOpen((current) => !current)}
      >
        {postLanguageLabel(value)}
      </button>
      {open && (
        <div className={`composer-language-menu${showAll ? " expanded" : ""}`} role="listbox">
          {listed.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === value}
              className={`composer-language-option${code === value ? " selected" : ""}`}
              onClick={() => choose(code)}
            >
              <span>{postLanguageLabel(code)}</span>
              <span className="composer-language-radio" aria-hidden="true" />
            </button>
          ))}
          {!showAll && (
            <button
              type="button"
              className="composer-language-more"
              onClick={() => setShowAll(true)}
            >
              <span>More languages…</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Curated emoji set for the composer picker, grouped the way bsky's picker is.
// Plain text insertion only — emoji are ordinary Unicode characters, so no API
// or upload is involved; they flow through the post text like any other glyph.
const EMOJI_GROUPS: Array<{ label: string; emoji: string[] }> = [
  {
    label: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😜", "🤪",
      "😎", "🤓", "🥳", "😏", "😴", "😪", "🤔", "🤨", "😐", "😶",
      "🙄", "😬", "😯", "😳", "🥺", "😢", "😭", "😤", "😠", "😡",
      "🤯", "😱", "😨", "😰", "😥", "🤗", "🤭", "🤐", "😴", "🤤",
    ],
  },
  {
    label: "Gestures",
    emoji: [
      "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤙", "👈", "👉",
      "👆", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "👏", "🙌", "🙏",
      "🤝", "💪", "🫶", "👀", "🧠", "🫡", "🤷", "🤦",
    ],
  },
  {
    label: "Hearts",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💔",
      "❤️‍🔥", "💖", "💗", "💓", "💞", "💕", "💌", "💯",
    ],
  },
  {
    label: "Animals & Nature",
    emoji: [
      "🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷",
      "🐸", "🐙", "🦋", "🐝", "🐢", "🐰", "🦄", "🌟", "⭐", "🔥",
      "🌈", "☀️", "🌙", "⚡", "❄️", "🌸", "🌹", "🌻", "🍀", "🌊",
    ],
  },
  {
    label: "Food & Drink",
    emoji: [
      "🍎", "🍊", "🍓", "🍉", "🍇", "🍌", "🍍", "🥑", "🍕", "🍔",
      "🌮", "🍟", "🍩", "🍪", "🎂", "🍰", "🍫", "🍿", "☕", "🍵",
      "🍺", "🍻", "🥂", "🍷",
    ],
  },
  {
    label: "Activities & Objects",
    emoji: [
      "⚽", "🏀", "🏈", "🎾", "🎮", "🎲", "🎯", "🎵", "🎸", "🎤",
      "🎉", "🎊", "🎁", "🏆", "🥇", "📷", "📱", "💻", "💡", "📚",
      "✈️", "🚀", "🌍", "🕰️", "💰", "🎈",
    ],
  },
  {
    label: "Symbols",
    emoji: [
      "✅", "❌", "⭕", "❓", "❗", "💬", "👁️", "🔗", "🔒", "🔔",
      "⚠️", "♻️", "✨", "💥", "💢", "💤", "🆗", "🆕", "🔝", "©️",
    ],
  },
];

function EmojiPicker({ onSelect, disabled }: { onSelect: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissMenu(rootRef, open, () => setOpen(false));

  function choose(emoji: string) {
    onSelect(emoji);
    setOpen(false);
  }

  return (
    <div className="composer-emoji" ref={rootRef}>
      <button
        type="button"
        title="Add emoji"
        aria-label="Add emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Smile size={20} />
      </button>
      {open && (
        <div className="composer-emoji-menu" role="dialog" aria-label="Emoji picker">
          {EMOJI_GROUPS.map((group) => (
            <div className="composer-emoji-group" key={group.label}>
              <p className="composer-emoji-group-label">{group.label}</p>
              <div className="composer-emoji-grid">
                {group.emoji.map((emoji, index) => (
                  <button
                    key={`${group.label}-${index}`}
                    type="button"
                    className="composer-emoji-option"
                    title={emoji}
                    onClick={() => choose(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Default a reply's post language to the parent post's language (matching
// bsky, which seeds the composer from `replyTo?.langs`), normalized to a base
// code we offer; falls back to the user's saved/browser default.
function readReplyDefaultLanguage(parent: FeedPost): string {
  const langs = parent.record?.langs;
  if (Array.isArray(langs)) {
    for (const lang of langs) {
      if (typeof lang !== "string") {
        continue;
      }
      const base = lang.toLowerCase().split("-")[0];
      if (POST_LANGUAGE_OPTIONS.some((option) => option.code === base)) {
        return base;
      }
    }
  }
  return readDefaultPostLanguage();
}

// One composer for both new posts and replies. The mode is just whether
// `replyTo` is set (mirrors bsky's single composer keyed on `replyTo`), so every
// shared feature — text + grapheme char count, image attach/alt, the emoji
// picker, the language picker, draft autosave — lives in exactly one place and
// can't drift between the two surfaces. Only the outer skeleton (reply-target
// inline frame vs the collapsible "New post" panel), placeholder/labels, draft
// key, and submit path branch on `isReply`.
export function PostComposer({
  draft,
  onDraftChange,
  onPosted,
  defaultExpanded = false,
  replyTo,
  canReply = true,
  onClose,
  onReplied,
}: {
  // New-post mode (controlled draft lifted to the app so it survives navigation):
  draft?: { posts: string[] };
  onDraftChange?: (draft: { posts: string[] }) => void;
  onPosted?: () => void;
  defaultExpanded?: boolean;
  // Reply mode (presence of `replyTo` switches the composer into a reply):
  replyTo?: { parent: FeedPost; root: PostRefValue };
  canReply?: boolean;
  onClose?: () => void;
  onReplied?: () => void;
}) {
  const isReply = !!replyTo;
  // Reply text is internal state seeded from a per-thread draft key; new-post
  // text is the controlled parent draft. `draftText`/`setText` unify the two so
  // the shared body never has to know which mode it's in.
  const [replyText, setReplyText] = useState("");
  const draftText = isReply
    ? replyText
    : (draft?.posts && draft.posts.length > 0 ? draft.posts : [""]).join("\n\n");
  const setText = (value: string) => {
    if (isReply) {
      setReplyText(value);
    } else {
      onDraftChange?.({ posts: [value] });
    }
  };
  const replyDraftKey = replyTo ? `${replyDraftPrefix}${replyTo.parent.uri}` : "";

  const generatedPosts = splitTextForThread(draftText);
  const generatedPostCount = Math.max(generatedPosts.length, 1);
  // A single post is capped on both graphemes and UTF-8 bytes. Track both and
  // surface whichever is more binding. New posts auto-split (splitTextForThread
  // honors both budgets), so this gate only blocks the reply path, which is a
  // single un-split post. Today the grapheme cap always bites first; the byte
  // cap is here so a raised grapheme limit can't let a multi-byte reply through.
  const remaining = POST_GRAPHEME_LIMIT - graphemeLength(draftText);
  const byteRemaining = POST_BYTE_LIMIT - utf8ByteLength(draftText);
  const remainingDisplay = Math.min(remaining, byteRemaining);
  const isOverLimit = remainingDisplay < 0;
  // Real attached images live in component state (not the persisted draft):
  // File objects and object-URLs can't be JSON-serialized to localStorage, so
  // they are session-only — text drafts persist across reloads, images don't.
  const [images, setImages] = useState<ComposerImageState[]>([]);
  // Mirror images into a ref so the unmount cleanup revokes the *current* blob
  // URLs. A cleanup with an empty dep array closes over the mount-time [] and
  // would leak every URL when the user attaches images then navigates away.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const hasContent = draftText.trim().length > 0 || images.length > 0;
  // Collapsed by default to keep the top of the feed clean; expand on click.
  // Start expanded if a local draft is already in progress so it isn't hidden.
  // (Replies render inline and ignore this — they're always expanded.)
  const [expanded, setExpanded] = useState(defaultExpanded || hasContent);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postLang, setPostLang] = useState(() =>
    replyTo ? readReplyDefaultLanguage(replyTo.parent) : readDefaultPostLanguage(),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // New-post draft autosave (controlled draft → localStorage). No-op for replies.
  useEffect(() => {
    if (isReply) {
      return;
    }
    if (draftText.trim().length > 0) {
      safeLocalStorageSet(composerDraftStorageKey, JSON.stringify({ posts: [draftText] }));
    } else {
      safeLocalStorageRemove(composerDraftStorageKey);
    }
  }, [isReply, draftText]);

  // Reply: seed the text from the per-thread draft key when the target changes.
  useEffect(() => {
    if (!isReply) {
      return;
    }
    setReplyText(safeLocalStorageGet(replyDraftKey) || "");
  }, [isReply, replyDraftKey]);

  // Reply: autosave the text to the per-thread draft key.
  useEffect(() => {
    if (!isReply) {
      return;
    }
    if (replyText.trim()) {
      safeLocalStorageSet(replyDraftKey, replyText);
    } else {
      safeLocalStorageRemove(replyDraftKey);
    }
  }, [isReply, replyDraftKey, replyText]);

  // Revoke any outstanding object URLs when the composer unmounts.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  // Insert text (e.g. an emoji) at the textarea caret, replacing any selection,
  // then restore focus with the caret just after the inserted text.
  function insertAtCaret(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setText(draftText + snippet);
      return;
    }
    // Read the live DOM value/selection rather than the `draftText` render
    // closure so a stale `insertAtCaret` reference (or a rapid second insert)
    // splices against the text actually in the field, not a pre-insert snapshot.
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const caret = start + snippet.length;
    setText(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    const picked = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    setImages((existing) => {
      const room = MAX_POST_IMAGES - existing.length;
      const added = picked.slice(0, Math.max(0, room)).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${existing.length}`,
        file,
        url: URL.createObjectURL(file),
        alt: "",
      }));
      return [...existing, ...added];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((image) => image.id !== id);
    });
  }

  function setImageAlt(id: string, alt: string) {
    setImages((current) => current.map((image) => (image.id === id ? { ...image, alt } : image)));
  }

  function clearDraft() {
    images.forEach((image) => URL.revokeObjectURL(image.url));
    setImages([]);
    safeLocalStorageRemove(composerDraftStorageKey);
    onDraftChange?.({ posts: [""] });
  }

  async function handleSubmit() {
    if (posting || !hasContent || (isReply && isOverLimit)) {
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const composerImages = images.map((image) => ({ file: image.file, alt: image.alt }));
      if (isReply && replyTo) {
        await publishPost({
          text: draftText.trim(),
          reply: { root: replyTo.root, parent: { uri: replyTo.parent.uri, cid: replyTo.parent.cid } },
          ...(postLang ? { langs: [postLang] } : {}),
          ...(composerImages.length > 0 ? { images: composerImages } : {}),
        });
      } else {
        const postTexts = splitTextForThread(draftText);
        const postsToPublish =
          postTexts.length > 0
            ? postTexts.map((text, index) => ({ text, images: index === 0 ? composerImages : [] }))
            : [{ text: "", images: composerImages }];
        await publishThread(postsToPublish, postLang ? [postLang] : undefined);
      }
      // Posted: revoke the session image URLs and clear the draft.
      images.forEach((image) => URL.revokeObjectURL(image.url));
      setImages([]);
      if (isReply) {
        setReplyText("");
        safeLocalStorageRemove(replyDraftKey);
        onClose?.();
        onReplied?.();
      } else {
        safeLocalStorageRemove(composerDraftStorageKey);
        onDraftChange?.({ posts: [""] });
        setExpanded(false);
        onPosted?.();
      }
    } catch (error) {
      setPostError(
        error instanceof Error
          ? error.message
          : isReply
            ? "Could not publish reply. Try again."
            : "Could not publish. Try again.",
      );
    } finally {
      setPosting(false);
    }
  }

  // Shared pieces used by both skeletons.
  const mediaGrid =
    images.length > 0 ? (
      <div className="composer-media-grid" aria-label="Attached images">
        {images.map((image) => (
          <div className="composer-media-item" key={image.id}>
            <img src={image.url} alt={image.alt || "Attached image preview"} />
            <button
              type="button"
              className="composer-media-remove"
              title="Remove image"
              aria-label="Remove image"
              onClick={() => removeImage(image.id)}
            >
              <X size={14} />
            </button>
            <input
              className="composer-media-alt"
              type="text"
              placeholder="Alt text (describe the image)"
              value={image.alt}
              maxLength={2000}
              onChange={(event) => setImageAlt(image.id, event.target.value)}
            />
          </div>
        ))}
      </div>
    ) : null;

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(event) => onFilesSelected(event.target.files)}
    />
  );

  const errorNode = postError ? (
    <p className="composer-error" role="alert">
      {postError}
    </p>
  ) : null;

  // The tools (image + emoji) and meta (language + char count) row is identical
  // for both modes — this is the shared action bar the unification is about.
  const toolsAndMeta = (
    <>
      <div className="composer-tools">
        <button
          type="button"
          title="Add image"
          aria-label="Add image"
          onClick={() => fileInputRef.current?.click()}
          disabled={posting || (isReply && !canReply) || images.length >= MAX_POST_IMAGES}
        >
          <Image size={20} />
        </button>
        <EmojiPicker disabled={posting || (isReply && !canReply)} onSelect={insertAtCaret} />
      </div>
      <div className="composer-meta">
        <PostLanguagePicker
          value={postLang}
          disabled={posting || (isReply && !canReply)}
          onChange={(code) => {
            setPostLang(code);
            safeLocalStorageSet(postLanguageStorageKey, code);
          }}
        />
        {isReply ? (
          <span className={`composer-count${isOverLimit ? " over-limit" : ""}`}>{remainingDisplay}</span>
        ) : (
          <span className="composer-count">
            {draftText.trim() && generatedPostCount > 1 ? `${generatedPostCount} posts` : remainingDisplay}
          </span>
        )}
      </div>
    </>
  );

  if (isReply && replyTo) {
    const parentText = replyTo.parent.record.text?.trim() || "";
    return (
      <section className="reply-composer inline" aria-label={`Reply to ${displayName(replyTo.parent.author)}`}>
        <div className="reply-target-preview">
          <Avatar profile={replyTo.parent.author} />
          <div className="reply-target-body">
            <div className="reply-target-meta">
              <span className="reply-target-name">{displayName(replyTo.parent.author)}</span>
              <span className="reply-target-handle">@{replyTo.parent.author.handle}</span>
            </div>
            {parentText && <p className="reply-target-text">{parentText}</p>}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          autoFocus
          placeholder={canReply ? `Reply to @${replyTo.parent.author.handle}` : "Sign in to reply."}
          value={draftText}
          onChange={(event) => setText(event.currentTarget.value)}
          disabled={!canReply || posting}
        />
        {mediaGrid}
        {fileInput}
        {errorNode}
        <div className="composer-actions">
          {toolsAndMeta}
          <div className="composer-send">
            <button type="button" className="composer-send-cancel" onClick={onClose} disabled={posting}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canReply || posting || isOverLimit || !hasContent}
            >
              {posting ? "Replying..." : "Reply"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!expanded) {
    return (
      <section className="composer composer-collapsed" aria-label="Composer">
        <button type="button" className="composer-banner" onClick={() => setExpanded(true)} aria-expanded={false}>
          <Plus size={18} />
          <span>Add New Post</span>
          {hasContent && <span className="composer-banner-badge">Draft saved</span>}
        </button>
      </section>
    );
  }

  return (
    <section className="composer" aria-label="Composer">
      <div className="composer-header">
        <strong>New post</strong>
        <button
          type="button"
          className="composer-collapse"
          onClick={() => setExpanded(false)}
          aria-label="Collapse composer"
          title="Collapse"
        >
          <ChevronUp size={18} />
        </button>
      </div>
      <div className="composer-thread">
        <div className="composer-draft">
          <textarea
            ref={textareaRef}
            placeholder="What's on your mind?"
            value={draftText}
            onChange={(event) => setText(event.target.value)}
          />
          {mediaGrid}
          <div className="composer-footer">
            {toolsAndMeta}
            <span className="composer-status">
              {posting ? "Publishing…" : hasContent ? "Draft autosaved locally" : "No local draft"}
            </span>
            <button type="button" onClick={clearDraft} disabled={!hasContent || posting}>
              Clear draft
            </button>
            <button type="button" onClick={handleSubmit} disabled={!hasContent || posting}>
              {posting ? "Posting…" : draftText.trim() && generatedPostCount > 1 ? "Post thread" : "Post"}
            </button>
          </div>
        </div>
      </div>
      {fileInput}
      {errorNode}
    </section>
  );
}
