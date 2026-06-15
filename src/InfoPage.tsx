export default function InfoPage() {
  return (
    <div className="timeline comfortable info-page">
      <section className="info-hero">
        <span>About bigbsky.com</span>
        <h2>BigBsky is an alternative reader for Bluesky.</h2>
        <p>
          BigBsky is a desktop-focused theme for Bluesky and bsky.app. The official bsky.app experience is excellent,
          but its reading column stays narrow even on large desktop screens. BigBsky opens the layout into a wider
          workspace for reading, browsing, feeds, profiles, threads, bookmarks, and basic actions.
        </p>
        <p>
          Think of it as Big Bluesky: a larger-screen reader for people who want more room. BigBsky is not trying to
          recreate every feature of bsky.app. The focus is reading, browsing, and the core functions that support that.
        </p>
      </section>

      <section className="info-grid" aria-label="BigBsky details">
        <article className="info-panel">
          <h3>What BigBsky is</h3>
          <p>
            BigBsky is an alternative reader and theme for the Bluesky social app/network. It is designed mostly for
            desktop users and large screens, where the standard bsky.app layout can feel constrained.
          </p>
        </article>
        <article className="info-panel">
          <h3>What BigBsky is not</h3>
          <p>
            BigBsky is not Bluesky, not bsky.app, and not affiliated with Bluesky Social, PBC. It is not a new social
            network, a replacement for direct messages, or a copy of every official Bluesky workflow.
          </p>
        </article>
        <article className="info-panel">
          <h3>Sign-in and data</h3>
          <p>
            Sign-in is optional. BigBsky only asks you to sign in so it can authenticate with your Bluesky account and
            show your feeds, bookmarks, and profile-specific data. You can still browse public Bluesky feeds without
            signing in. BigBsky has no server-side data store and does not store your user data on BigBsky servers.
            Preferences, drafts, pins, recent items, and local collections may be stored locally in your browser so the
            reader can remember them on this device.
          </p>
        </article>
        <article className="info-panel">
          <h3>Privacy posture</h3>
          <p>
            BigBsky is a static browser app. It does not run a BigBsky user database, does not profile what you read,
            and does not store adult-content preferences, birthday, age, ID, or verification data on a BigBsky server.
            Bluesky and AT Protocol services receive the API requests needed to load Bluesky-hosted posts, profiles,
            feeds, media, bookmarks, and account actions. BigBsky is hosted on Cloudflare, which may process ordinary
            web delivery, security, and aggregate/anonymized analytics data for hosting. GitHub receives anything you
            choose to submit in an issue report.
          </p>
        </article>
        <article className="info-panel">
          <h3>Reporting content &amp; abuse</h3>
          <p>
            The posts and profiles you see in BigBsky are hosted on the Bluesky network, not on BigBsky. To report
            illegal content, abuse, harassment, or a user, please use Bluesky&rsquo;s official moderation tools: use the
            report option on the post or account, or follow Bluesky&rsquo;s{" "}
            <a href="https://bsky.social/about/support/community-guidelines" target="_blank" rel="noreferrer">
              community guidelines and reporting process
            </a>
            . Bluesky&rsquo;s moderation team handles takedowns and account actions across the network.
          </p>
          <p>
            For problems with the BigBsky reader itself &mdash; bugs, broken rendering, or a request to remove a
            BigBsky-specific issue &mdash; open an issue on{" "}
            <a href="https://github.com/radialmonster/bigbsky/issues" target="_blank" rel="noreferrer">
              GitHub
            </a>{" "}
            or use the contact below. Reports are reviewed and responded to through those channels.
          </p>
        </article>
        <article className="info-panel">
          <h3>Contact</h3>
          <p>
            Suggestions and issue reports are welcome on Bluesky at{" "}
            <a href="https://bsky.app/profile/radialmonster.com" target="_blank" rel="noreferrer">
              @radialmonster.com
            </a>{" "}
            or on{" "}
            <a href="https://github.com/radialmonster/bigbsky/issues" target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </article>
        <article className="info-panel">
          <h3>Optional support</h3>
          <p>
            If this website is helpful and you would like to say thank you, you can send an optional{" "}
            <a href="https://radialmonster.github.io/send-a-virtual-gift/" target="_blank" rel="noreferrer">
              virtual gift
            </a>
            . It is appreciated, but not required.
          </p>
        </article>
        <article className="info-panel">
          <h3>Source code</h3>
          <p>
            The source code for this website is available on{" "}
            <a href="https://github.com/radialmonster/bigbsky" target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </article>
      </section>
    </div>
  );
}
