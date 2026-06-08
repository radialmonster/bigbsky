<script lang="ts">
	import { AtpAgent } from '@atproto/api';

	const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
	let handle = $state('bsky.app');
	let result = $state<string>('');
	let loading = $state(false);

	async function lookup() {
		loading = true;
		result = '';
		try {
			const res = await agent.app.bsky.actor.getProfile({ actor: handle });
			result = JSON.stringify(
				{ did: res.data.did, displayName: res.data.displayName, followers: res.data.followersCount },
				null,
				2
			);
		} catch (err) {
			result = `error: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			loading = false;
		}
	}
</script>

<h1>bigbsky</h1>
<p>An alternative Bluesky client. Smoke-testing <code>@atproto/api</code>:</p>

<form onsubmit={(e) => { e.preventDefault(); lookup(); }}>
	<input bind:value={handle} placeholder="handle (e.g. bsky.app)" />
	<button type="submit" disabled={loading}>{loading ? 'looking up...' : 'lookup profile'}</button>
</form>

{#if result}
	<pre>{result}</pre>
{/if}
