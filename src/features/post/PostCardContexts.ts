import { createContext } from "react";
import type { FeedPost, Profile } from "../../api";

// Lets deeply-nested post cards open an in-app hashtag search without threading
// a callback through every PostCard/VirtualPostList call site.
export const TagSearchContext = createContext<((tag: string) => void) | null>(null);

export const DensityContext = createContext<string>("comfortable");

// Like state + toggle, provided once and consumed directly by post cards so we
// don't thread like props through the virtualized list and every call site.
// Override state lives in the parent (App) so it survives row virtualization.
export type LikeView = { liked: boolean; count: number };
export type LikeContextValue = {
  canLike: boolean;
  getState: (post: FeedPost) => LikeView;
  toggle: (post: FeedPost) => void;
};
export const LikeContext = createContext<LikeContextValue | null>(null);

// Native Bluesky bookmark state + toggle, provided once and consumed by the
// post card so we don't thread bookmark props through the virtualized list and
// every call site. Override state lives in the parent (App) so it survives row
// virtualization. Only available when signed in (bookmarks are an authenticated
// AppView feature). Mirrors LikeContext.
export type BookmarkView = { bookmarked: boolean; error?: string };
export type BookmarkContextValue = {
  canBookmark: boolean;
  getState: (post: FeedPost) => BookmarkView;
  toggle: (post: FeedPost) => void;
};
export const BookmarkContext = createContext<BookmarkContextValue | null>(null);

// Block state + toggle for a post's author, provided once and consumed by the
// post card's options menu. Keyed by author DID (not post URI) so blocking from
// one post reflects on every post by that author. Mirrors LikeContext.
export type BlockView = { blocked: boolean; uri?: string };
export type BlockContextValue = {
  canBlock: boolean;
  selfDid?: string;
  getState: (author: Profile) => BlockView;
  toggle: (author: Profile) => void;
};
export const BlockContext = createContext<BlockContextValue | null>(null);

export type DeletePostContextValue = {
  canDelete: boolean;
  deletePost: (post: FeedPost) => void;
};
export const DeletePostContext = createContext<DeletePostContextValue | null>(null);
