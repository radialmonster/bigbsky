import { useCallback, useContext, useEffect, useState, type FormEvent, type RefObject } from "react";
import { ChevronUp, List, Plus } from "lucide-react";
import { type FeedPost, type ListView } from "../../api";
import { EmptyState, ErrorState, LoadingState } from "../common/State";
import { ToastContext } from "../common/ToastHost";
import { listPurposeLabel } from "../profile/ProfileListsTab";
import type { FeedSource } from "../../sources";
import {
  type ListMember,
  addAccountToList,
  getListMembers,
  getMissingScopes,
  muteList,
  removeListItem,
  subscribeBlockList,
  unmuteList,
  unsubscribeBlockList,
} from "../../auth";

export type LocalList = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  posts?: FeedPost[];
};

function listToFeedSource(list: ListView): FeedSource {
  return {
    id: list.uri,
    uri: list.uri,
    label: list.name || "List",
    group: "Discovered",
    description: list.description || "Bluesky list timeline.",
  };
}

function listBskyUrl(list: ListView): string {
  const handleOrDid = list.creator?.handle || list.creator?.did;
  const rkey = list.uri.split("/").pop();
  return handleOrDid && rkey ? `https://bsky.app/profile/${handleOrDid}/lists/${rkey}` : "https://bsky.app";
}

// Inline manager for the accounts on a list the user owns. Loads members on
// mount, supports add-by-handle and per-member removal. Self-contained so the
// Lists page doesn't have to thread member state through props.
function ListMemberManager({ listUri }: { listUri: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [members, setMembers] = useState<ListMember[]>([]);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    getListMembers(listUri)
      .then((result) => {
        setMembers(result.members);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [listUri]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const value = handle.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAccountToList(listUri, value);
      setHandle("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that account.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(listItemUri: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeListItem(listItemUri);
      setMembers((current) => current.filter((member) => member.listItemUri !== listItemUri));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-member-manager">
      <form className="list-member-add" onSubmit={handleAdd}>
        <input
          aria-label="Add account by handle"
          placeholder="handle.bsky.social to add"
          value={handle}
          onInput={(event) => setHandle(event.currentTarget.value)}
        />
        <button type="submit" disabled={!handle.trim() || busy}>
          Add
        </button>
      </form>
      {error && <p className="composer-error" role="alert">{error}</p>}
      {status === "loading" && <p className="list-member-note">Loading members…</p>}
      {status === "error" && <p className="list-member-note">Could not load members.</p>}
      {status === "ready" && members.length === 0 && (
        <p className="list-member-note">No accounts on this list yet. Add one by handle above.</p>
      )}
      {status === "ready" && members.length > 0 && (
        <ul className="list-member-list">
          {members.map((member) => (
            <li key={member.listItemUri}>
              <span>
                <strong>{member.subject.displayName || member.subject.handle}</strong>
                <small>@{member.subject.handle}</small>
              </span>
              <button type="button" onClick={() => handleRemove(member.listItemUri)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BlueskyListCard({
  list,
  owned,
  signedInDid,
  onOpenFeed,
  onDelete,
  onReauthorize,
}: {
  list: ListView;
  owned: boolean;
  signedInDid?: string;
  onOpenFeed: (source: FeedSource) => void;
  onDelete?: (listUri: string) => Promise<void>;
  onReauthorize?: () => void;
}) {
  const toast = useContext(ToastContext);
  const isModlist = list.purpose?.includes("modlist") ?? false;
  const isOwn = owned || (!!signedInDid && list.creator?.did === signedInDid);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Block-list subscription state, seeded from the list's viewer.blocked record
  // URI. Only meaningful for moderation lists you don't own.
  const [blockUri, setBlockUri] = useState<string | undefined>(list.viewer?.blocked);
  const [subBusy, setSubBusy] = useState(false);
  // Mute-list subscription state, seeded from viewer.muted. muteActorList is an
  // AppView procedure (no record uri), so this is just a boolean.
  const [muted, setMuted] = useState<boolean>(!!list.viewer?.muted);
  const [muteBusy, setMuteBusy] = useState(false);
  useEffect(() => {
    setBlockUri(list.viewer?.blocked);
    setMuted(!!list.viewer?.muted);
  }, [list.uri, list.viewer?.blocked, list.viewer?.muted]);
  // Surfaced when a subscribe/mute write fails. `reauth` flags a missing-scope
  // failure (re-authorize fixes it) vs a generic one.
  const [subError, setSubError] = useState<{ message: string; reauth: boolean } | null>(null);

  async function handleDelete() {
    if (!onDelete || deleting) {
      return;
    }
    if (!window.confirm(`Delete the list "${list.name}"? This removes it and its membership from your account.`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(list.uri);
    } catch {
      toast("Couldn't delete this list. Please try again.", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleSubscribe() {
    if (subBusy) {
      return;
    }
    const previous = blockUri;
    setSubBusy(true);
    try {
      if (previous) {
        setBlockUri(undefined);
        await unsubscribeBlockList(previous);
      } else {
        if (!window.confirm(`Subscribe to "${list.name}" as a block list? You'll block every account on it.`)) {
          setSubBusy(false);
          return;
        }
        setBlockUri("pending");
        const uri = await subscribeBlockList(list.uri);
        setBlockUri(uri);
      }
    } catch {
      setBlockUri(previous);
      setSubError({ message: "Could not update this block-list subscription.", reauth: false });
    } finally {
      setSubBusy(false);
    }
  }

  async function handleToggleMute() {
    if (muteBusy) {
      return;
    }
    const previous = muted;
    setMuteBusy(true);
    try {
      if (previous) {
        setMuted(false);
        await unmuteList(list.uri);
      } else {
        if (!window.confirm(`Mute everyone on "${list.name}"? Their posts and reposts will be hidden from your feeds.`)) {
          setMuteBusy(false);
          return;
        }
        setMuted(true);
        await muteList(list.uri);
      }
    } catch {
      setMuted(previous);
      // Muting needs the muteActorList scope (added recently); a missing scope
      // means re-auth fixes it. Tell the two cases apart.
      const missing = await getMissingScopes().catch(() => []);
      const needsReauth = missing?.some((scope) => scope.includes("muteActorList")) ?? false;
      setSubError({
        message: needsReauth
          ? "Muting a list needs updated permissions — re-authorize to enable it."
          : "Could not update this mute.",
        reauth: needsReauth,
      });
    } finally {
      setMuteBusy(false);
    }
  }

  return (
    <article className="bsky-list-card">
      <div className="bsky-list-card-head">
        {list.avatar ? (
          <img className="bsky-list-avatar" src={list.avatar} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="bsky-list-avatar placeholder">
            <List size={18} />
          </span>
        )}
        <div>
          <span className="bsky-list-purpose">{listPurposeLabel(list.purpose)}</span>
          <h3>{list.name || "List"}</h3>
          {typeof list.listItemCount === "number" && (
            <small>
              {list.listItemCount.toLocaleString()} member{list.listItemCount === 1 ? "" : "s"}
            </small>
          )}
        </div>
      </div>
      {list.description && <p className="bsky-list-desc">{list.description}</p>}
      <div className="bsky-list-actions">
        {/* Moderation lists aren't browsable timelines; only curation lists open
            as a feed via getListFeed. */}
        {!isModlist && (
          <button type="button" onClick={() => onOpenFeed(listToFeedSource(list))}>
            Open list
          </button>
        )}
        {isOwn && (
          <button type="button" onClick={() => setManaging((open) => !open)}>
            {managing ? "Done" : "Manage members"}
          </button>
        )}
        {/* Subscribing as block/mute is only meaningful for someone else's modlist. */}
        {isModlist && !isOwn && (
          <button type="button" className={blockUri ? "list-subscribed" : ""} onClick={handleToggleSubscribe} disabled={subBusy}>
            {blockUri ? "Unsubscribe block" : "Subscribe (block)"}
          </button>
        )}
        {isModlist && !isOwn && (
          <button type="button" className={muted ? "list-subscribed" : ""} onClick={handleToggleMute} disabled={muteBusy}>
            {muted ? "Unmute list" : "Mute list"}
          </button>
        )}
        <a href={listBskyUrl(list)} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
        {isOwn && onDelete && (
          <button type="button" className="list-delete" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
      {subError && (
        <div className="bsky-list-suberror">
          <p className="composer-error" role="alert">{subError.message}</p>
          {subError.reauth && onReauthorize && (
            <button type="button" className="reauth-primary" onClick={onReauthorize}>
              Update permissions
            </button>
          )}
        </div>
      )}
      {managing && isOwn && <ListMemberManager listUri={list.uri} />}
    </article>
  );
}

export function ListsSurface({
  containerRef,
  signedIn,
  signedInDid,
  myLists,
  myListsStatus,
  onReloadMyLists,
  onCreateModList,
  onDeleteModList,
  onOpenFeed,
  onReauthorize,
  lists,
  onCreateList,
  onDeleteList,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  signedIn: boolean;
  signedInDid?: string;
  myLists: { owned: ListView[]; subscribed: ListView[] };
  myListsStatus: "idle" | "loading" | "ready" | "error";
  onReloadMyLists: () => void;
  onCreateModList: (name: string, description: string) => Promise<void>;
  onDeleteModList: (listUri: string) => Promise<void>;
  onOpenFeed: (source: FeedSource) => void;
  onReauthorize: () => void;
  lists: LocalList[];
  onCreateList: (name: string, description: string) => void;
  onDeleteList: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showLocal, setShowLocal] = useState(false);
  const [modName, setModName] = useState("");
  const [modDescription, setModDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateModList(event: FormEvent) {
    event.preventDefault();
    if (!modName.trim() || creating) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateModList(modName, modDescription);
      setModName("");
      setModDescription("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the list.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="timeline comfortable" ref={containerRef}>
      <section className="surface-placeholder">
        <h2>Lists</h2>
        <p>Your Bluesky lists — the curation and moderation lists you created, plus curation lists you subscribe to. Open a curation list to read it as a timeline; manage members on a list you own.</p>
      </section>

      {signedIn && (
        <section className="mod-list-create" aria-label="Create a moderation list">
          <h3 className="bsky-list-section-heading">New moderation list</h3>
          <p className="local-collections-note">
            Create a block/mute list on your Bluesky account, then add accounts to it. You (or anyone who subscribes to it as a block list) will block every member.
          </p>
          <form className="local-list-form" onSubmit={handleCreateModList}>
            <input aria-label="List name" maxLength={64} placeholder="List name" value={modName} onInput={(event) => setModName(event.currentTarget.value)} />
            <input aria-label="List description" maxLength={300} placeholder="Description (optional)" value={modDescription} onInput={(event) => setModDescription(event.currentTarget.value)} />
            <button type="submit" disabled={!modName.trim() || creating}>
              {creating ? "Creating…" : "Create list"}
            </button>
          </form>
          {createError && <p className="composer-error" role="alert">{createError}</p>}
        </section>
      )}

      {!signedIn ? (
        <EmptyState
          title="Sign in to see your lists"
          message="Your Bluesky lists load once you sign in. Use the Sign in control in the right rail."
        />
      ) : myListsStatus === "loading" || myListsStatus === "idle" ? (
        <LoadingState label="Loading your Bluesky lists" />
      ) : myListsStatus === "error" ? (
        <div className="surface-retry">
          <ErrorState message="Could not load your lists." />
          <button type="button" onClick={onReloadMyLists}>
            Retry
          </button>
        </div>
      ) : myLists.owned.length === 0 && myLists.subscribed.length === 0 ? (
        <EmptyState
          title="No lists yet"
          message="You haven't created or subscribed to any Bluesky lists. Create one on Bluesky, or build a moderation list from a profile's Block control."
        />
      ) : (
        <>
          {myLists.owned.length > 0 && (
            <section className="bsky-list-section" aria-label="Lists you created">
              <h3 className="bsky-list-section-heading">Your lists</h3>
              <div className="bsky-list-grid">
                {myLists.owned.map((list) => (
                  <BlueskyListCard
                    key={list.uri}
                    list={list}
                    owned
                    signedInDid={signedInDid}
                    onOpenFeed={onOpenFeed}
                    onDelete={onDeleteModList}
                  />
                ))}
              </div>
            </section>
          )}
          {myLists.subscribed.length > 0 && (
            <section className="bsky-list-section" aria-label="Lists you subscribe to">
              <h3 className="bsky-list-section-heading">Subscribed lists</h3>
              <div className="bsky-list-grid">
                {myLists.subscribed.map((list) => (
                  <BlueskyListCard key={list.uri} list={list} owned={false} signedInDid={signedInDid} onOpenFeed={onOpenFeed} onReauthorize={onReauthorize} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Browser-only collections used by the post-card "Lists" control. These
          never sync to Bluesky; kept as a secondary, collapsed utility. */}
      <section className="local-collections">
        <button type="button" className="local-collections-toggle" onClick={() => setShowLocal((open) => !open)} aria-expanded={showLocal}>
          {showLocal ? <ChevronUp size={16} /> : <Plus size={16} />}
          Browser collections {lists.length > 0 ? `(${lists.length})` : ""}
        </button>
        {showLocal && (
          <>
            <p className="local-collections-note">
              Private browser-only bookmarks for organizing loaded posts via a post card&apos;s Lists control. Not Bluesky lists; nothing leaves this browser.
            </p>
            <form
              className="local-list-form"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateList(name, description);
                setName("");
                setDescription("");
              }}
            >
              <input aria-label="Collection name" maxLength={80} placeholder="Collection name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
              <input aria-label="Collection description" maxLength={180} placeholder="Description" value={description} onInput={(event) => setDescription(event.currentTarget.value)} />
              <button type="submit" disabled={!name.trim()}>
                New collection
              </button>
            </form>
            {lists.length > 0 && (
              <section className="local-list-grid" aria-label="Browser collections">
                {lists.map((list) => (
                  <article className="local-list-card" key={list.id}>
                    <span>Browser</span>
                    <h3>{list.name}</h3>
                    <p>{list.description || "No description yet."}</p>
                    <small>
                      {(list.posts?.length ?? 0).toLocaleString()} post{list.posts?.length === 1 ? "" : "s"}
                    </small>
                    <div className="local-list-actions">
                      <button type="button" onClick={() => onDeleteList(list.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
