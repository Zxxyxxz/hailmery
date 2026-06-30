# ⚠️ X / Twitter is NOT connected in APIRE's Buffer

**Status as of 2026-06-25:** APIRE's Buffer account (org `683c9b5a59eb5bc4801dafab`)
has **only LinkedIn channels** — there is **no X/Twitter channel connected**.

Buffer channels currently on the account:

| id | name | service | descriptor |
|----|------|---------|-----------|
| `6a0248e8090476fb990c506a` | Baran Erdoğan | linkedin | LinkedIn Profile |
| `683c9bced6d25b49a18a1143` | offensive-security-manager | linkedin | LinkedIn Page |
| `6935634729ea336fd65bb60e` | apireai (APIRE) | linkedin | LinkedIn Page ← mapped as `profileMap.linkedin` |

Because of this, every X/Twitter draft fails at publish with
`No Buffer channel/profile id mapped for channel: twitter`. (The `x → twitter`
channel normalization in the code works correctly — the problem is purely that
there is no X channel to map to.)

As part of the 2026-06-25 cleanup, the 2 failed + 11 pending_review X/Twitter
drafts were dismissed with `dismiss_reason = 'x_not_connected_in_buffer_auto_dismissed'`.

## To enable X posting in the future, Baran needs to:

1. Go to **publish.buffer.com → Channels → Add channel → X/Twitter**
2. Connect his X account
3. Get the Buffer channel ID (visible in the channel URL / via
   `scripts/find-buffer-channels.mjs`)
4. Add it to APIRE's profile map under the `twitter` key — same script pattern as
   the LinkedIn restore (`scripts/restore-buffer-profile-map.mjs`); e.g. set
   `PROFILE_MAP = { linkedin: '6935634729ea336fd65bb60e', twitter: '<new id>' }`
   (keep the existing linkedin entry).

Once the `twitter` key exists in the profile map, new X drafts will publish with
no code change (the normalization + adapter path already handle `x`/`twitter`).
