import { useState } from "react";
import type { AuthState } from "../../auth";
import { Avatar } from "../common/Avatar";

export function SignInForm({
  status,
  onSignIn,
}: {
  status: AuthState["status"];
  onSignIn: (handle: string) => void | Promise<void>;
}) {
  const [handle, setHandle] = useState("");
  const isBusy = status === "checking" || status === "callback" || status === "signing-in" || status === "signing-out";

  return (
    <>
      <form
        className="sign-in-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSignIn(handle);
        }}
      >
        <input
          aria-label="Bluesky handle, DID, or PDS URL"
          autoComplete="username"
          placeholder="your.handle"
          value={handle}
          onInput={(event) => setHandle(event.currentTarget.value)}
        />
        <button type="submit" disabled={isBusy}>
          {isBusy ? "Working" : "Sign in"}
        </button>
      </form>
      <p className="sign-in-create-note">
        No account yet?{" "}
        <a href="https://bsky.app/" target="_blank" rel="noreferrer">
          Create one on Bluesky
        </a>
      </p>
    </>
  );
}

export function AccountPanel({
  auth,
  onSignIn,
  onSignOut,
}: {
  auth: AuthState;
  onSignIn: (handle: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <section className="context-panel account-panel">
      <h2>Account</h2>
      {auth.session ? (
        <>
          <div className="account-identity">
            <Avatar profile={auth.session} />
            <span>
              <strong>{auth.session.displayName || auth.session.handle}</strong>
              <small>@{auth.session.handle}</small>
            </span>
          </div>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <p>
            {auth.status === "callback"
              ? "Completing OAuth callback."
              : auth.status === "checking"
                ? "Checking browser session."
                : "Signed-out public reader mode."}
          </p>
          <SignInForm status={auth.status} onSignIn={onSignIn} />
        </>
      )}
      {auth.message && <p className={auth.status === "error" ? "account-warning" : undefined}>{auth.message}</p>}
    </section>
  );
}
