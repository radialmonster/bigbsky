// Content-language viewing filter — the "Show posts from language" setting.
//
// Mirrors bsky.app's client-side language filter (docs/social-app:
// FeedTuner.preferredLangOnly -> isPostInLanguage -> getPostLanguage). Nothing
// here runs on a server: BigBsky has no backend, so — like bsky.app — feeds are
// fetched in every language and trimmed to the selected languages in the
// browser. The selected languages are a browser-local preference and never
// leave the device.
//
// Behavior parity with bsky:
//   - An empty selection means "Any": every post shows, no filtering.
//   - A post that declares languages (record.langs) is judged on those.
//   - A post with no declared language but with text is judged on a language
//     *detected* client-side from its text (see detectPostLanguage). This is the
//     case that matters: real feeds are mostly untagged (the verified-news feed
//     measured ~92% untagged), so without detection the filter would be inert.
//   - A post with neither declared language nor text is always kept.
//   - While a post's detection is still pending, it is kept (so the feed never
//     blanks and posts don't flicker out mid-scroll).
//   - If the filter would empty a non-empty page, the page is shown unfiltered
//     ("never blank"), matching bsky's preferredLangOnly fallback.

import type { FeedItem, FeedPost } from "../api";

/*
 * ISO 639-3 -> 639-1 map. The lande detector emits 3-letter codes; we store and
 * select 2-letter codes, so its output must be translated. Generated from the
 * atproto social-app language table (docs/social-app/src/locale/languages.ts),
 * limited to the entries that have a 2-letter code2.
 */
const CODE3_TO_CODE2: Record<string, string> = {
  aar: "aa", abk: "ab", afr: "af", aka: "ak", alb: "sq", amh: "am", ara: "ar", arg: "an",
  arm: "hy", asm: "as", ava: "av", ave: "ae", aym: "ay", aze: "az", bak: "ba", bam: "bm",
  baq: "eu", bel: "be", ben: "bn", bih: "bh", bis: "bi", bod: "bo", bos: "bs", bre: "br",
  bul: "bg", bur: "my", cat: "ca", ces: "cs", cha: "ch", che: "ce", chi: "zh", chu: "cu",
  chv: "cv", cor: "kw", cos: "co", cre: "cr", cym: "cy", cze: "cs", dan: "da", deu: "de",
  div: "dv", dut: "nl", dzo: "dz", ell: "el", eng: "en", epo: "eo", est: "et", eus: "eu",
  ewe: "ee", fao: "fo", fas: "fa", fij: "fj", fin: "fi", fra: "fr", fre: "fr", fry: "fy",
  ful: "ff", geo: "ka", ger: "de", gla: "gd", gle: "ga", glg: "gl", glv: "gv", gre: "el",
  grn: "gn", guj: "gu", hat: "ht", hau: "ha", heb: "he", her: "hz", hin: "hi", hmo: "ho",
  hrv: "hr", hun: "hu", hye: "hy", ibo: "ig", ice: "is", ido: "io", iii: "ii", iku: "iu",
  ile: "ie", ina: "ia", ind: "id", ipk: "ik", isl: "is", ita: "it", jav: "jv", jpn: "ja",
  kal: "kl", kan: "kn", kas: "ks", kat: "ka", kau: "kr", kaz: "kk", khm: "km", kik: "ki",
  kin: "rw", kir: "ky", kom: "kv", kon: "kg", kor: "ko", kua: "kj", kur: "ku", lao: "lo",
  lat: "la", lav: "lv", lim: "li", lin: "ln", lit: "lt", ltz: "lb", lub: "lu", lug: "lg",
  mac: "mk", mah: "mh", mal: "ml", mao: "mi", mar: "mr", may: "ms", mkd: "mk", mlg: "mg",
  mlt: "mt", mon: "mn", mri: "mi", msa: "ms", mya: "my", nau: "na", nav: "nv", nbl: "nr",
  nde: "nd", ndo: "ng", nep: "ne", nld: "nl", nno: "nn", nob: "nb", nor: "no", nya: "ny",
  oci: "oc", oji: "oj", ori: "or", orm: "om", oss: "os", pan: "pa", per: "fa", pli: "pi",
  pol: "pl", por: "pt", pus: "ps", que: "qu", roh: "rm", ron: "ro", rum: "ro", run: "rn",
  rus: "ru", sag: "sg", san: "sa", sin: "si", slk: "sk", slo: "sk", slv: "sl", sme: "se",
  smo: "sm", sna: "sn", snd: "sd", som: "so", sot: "st", spa: "es", sqi: "sq", srd: "sc",
  srp: "sr", ssw: "ss", sun: "su", swa: "sw", swe: "sv", tah: "ty", tam: "ta", tat: "tt",
  tel: "te", tgk: "tg", tgl: "tl", tha: "th", tib: "bo", tir: "ti", ton: "to", tsn: "tn",
  tso: "ts", tuk: "tk", tur: "tr", twi: "tw", uig: "ug", ukr: "uk", urd: "ur", uzb: "uz",
  ven: "ve", vie: "vi", vol: "vo", wel: "cy", wln: "wa", wol: "wo", xho: "xh", yid: "yi",
  yor: "yo", zha: "za", zho: "zh", zul: "zu",
};

/** Translate a detector 639-3 code to its 639-1 code; passes others through. */
export function code3ToCode2(code: string): string {
  return code.length === 3 ? (CODE3_TO_CODE2[code] ?? code) : code;
}

/** Normalize a BCP-47 tag to its lowercased base code: "en-US" -> "en". */
export function baseLangCode(tag: string): string {
  return tag.toLowerCase().split("-")[0];
}

/** Base-code languages declared on a post record; empty when none declared. */
export function declaredPostLanguages(post: FeedPost): string[] {
  const langs = post.record?.langs;
  if (!Array.isArray(langs)) {
    return [];
  }
  return langs.filter((lang): lang is string => typeof lang === "string").map(baseLangCode);
}

function postText(post: FeedPost): string {
  const text = post.record?.text;
  return typeof text === "string" ? text : "";
}

/** True when a post has no declared language but has text to detect from. */
export function postNeedsDetection(post: FeedPost): boolean {
  return declaredPostLanguages(post).length === 0 && postText(post).trim().length > 0;
}

/**
 * Whether a single post passes the filter. `selected` is the set of base codes
 * the user chose (empty = Any = everything). `detected` is the cached detector
 * result for an untagged-but-has-text post, or undefined when not yet detected.
 */
export function postMatchesLanguages(
  post: FeedPost,
  selected: readonly string[],
  detected?: string,
): boolean {
  if (selected.length === 0) {
    return true;
  }
  const declared = declaredPostLanguages(post);
  if (declared.length > 0) {
    return declared.some((code) => selected.includes(code));
  }
  if (postText(post).trim().length === 0) {
    // No text to judge — keep it (bsky returns undefined -> "yes" here).
    return true;
  }
  if (detected) {
    return selected.includes(detected);
  }
  // Detection pending or unavailable: keep it, so nothing flickers out and the
  // feed never blanks while the detector is still working.
  return true;
}

/**
 * A feed row can carry reply parent/root context. Mirror bsky's slice behavior:
 * keep the row if ANY post in it matches. `detectedByUri` caches detector
 * results keyed by post URI.
 */
export function itemMatchesLanguages(
  item: FeedItem,
  selected: readonly string[],
  detectedByUri: ReadonlyMap<string, string>,
): boolean {
  if (selected.length === 0) {
    return true;
  }
  const posts: FeedPost[] = [item.post];
  if (item.reply?.parent) {
    posts.push(item.reply.parent);
  }
  if (item.reply?.root) {
    posts.push(item.reply.root);
  }
  return posts.some((post) => postMatchesLanguages(post, selected, detectedByUri.get(post.uri)));
}

/**
 * Filter a feed to the selected languages. Preserves bsky's "never blank"
 * guarantee: an empty selection returns the input unchanged (same reference),
 * and if the filter would empty a non-empty feed, the feed is returned
 * unfiltered instead.
 */
export function filterFeedByLanguages(
  items: FeedItem[],
  selected: readonly string[],
  detectedByUri: ReadonlyMap<string, string>,
): FeedItem[] {
  if (selected.length === 0) {
    return items;
  }
  const filtered = items.filter((item) => itemMatchesLanguages(item, selected, detectedByUri));
  if (filtered.length === 0 && items.length > 0) {
    return items;
  }
  return filtered;
}

/**
 * Distinct posts across a feed that still need language detection: untagged,
 * with text, and not already in the cache. Returns nothing when the selection
 * is empty (Any), since no detection is needed then.
 */
export function postsNeedingDetection(
  items: FeedItem[],
  selected: readonly string[],
  detectedByUri: ReadonlyMap<string, string>,
): FeedPost[] {
  if (selected.length === 0) {
    return [];
  }
  const out: FeedPost[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const post of [item.post, item.reply?.parent, item.reply?.root]) {
      if (!post || seen.has(post.uri)) {
        continue;
      }
      seen.add(post.uri);
      if (postNeedsDetection(post) && !detectedByUri.has(post.uri)) {
        out.push(post);
      }
    }
  }
  return out;
}

/*
 * Lazy-loaded detector. lande (+ its toygrad runtime) is ~700KB, so it is only
 * imported when a specific-language filter is actually active — the default
 * "Any" user never downloads it. BigBsky already dynamic-imports heavy deps
 * (see @atproto/api in auth.ts).
 */
type LandeFn = (text: string) => Array<[string, number]>;
let landePromise: Promise<LandeFn> | null = null;

async function getLande(): Promise<LandeFn> {
  if (!landePromise) {
    landePromise = import("lande")
      .then((mod) => {
        const fn = (mod as { default?: LandeFn }).default ?? (mod as unknown as LandeFn);
        return fn;
      })
      .catch((error) => {
        // Don't cache a rejected import: a transient chunk-load failure would
        // otherwise disable language detection for the whole session. Reset so
        // the next detection attempt retries the load.
        landePromise = null;
        throw error;
      });
  }
  return landePromise;
}

/**
 * Detect a post's language from its text, as a base 639-1 code. Returns
 * undefined for empty text or a result that doesn't map to a 2-letter code.
 * Matches bsky's feed path, which takes the detector's top result without a
 * confidence gate (the 0.97 gate bsky uses is only for composer suggestions).
 */
export async function detectPostLanguage(text: string): Promise<string | undefined> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const lande = await getLande();
  const results = lande(trimmed);
  const top = results?.[0];
  if (!top) {
    return undefined;
  }
  const code2 = code3ToCode2(top[0]);
  return code2.length === 2 ? code2 : undefined;
}
