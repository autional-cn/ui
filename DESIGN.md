---
version: "1.0.0-rc"
name: Autional Unified Design System
description: Canonical visual identity and token contract for every Autional surface — app consoles, end-user portals, marketing, developer, and documentation sites.
sourceOfTruth: tokens/tokens.json
generatedBy: pnpm gen
packages:
  tokens: "@autional/tokens"
  tailwindPreset: "@autional/tailwind-preset"
machineSpec: ASTRYX_MANIFEST.json
---

# Autional Design System v1.0

This file is the human-readable contract. The machine-readable token contract is
`tokens/tokens.json`; everything else in this repository is generated from it.

**If this document and `tokens/tokens.json` disagree, the JSON wins and this
document is a bug.** Values are intentionally not duplicated here.

---

## 1. Overview

Autional should feel like a mature enterprise SaaS platform: strong trust cues, a
clean technical backbone, and visible data fluency. Modern and polished, never
flashy startup marketing, never generic template aesthetics.

The system covers three kinds of surfaces that must feel clearly related:

| Face | Repos | Carries |
|---|---|---|
| **Console** | 8 SPA portals (`admin`, `auth`, `user`, `security`, `status`, `trust`, `platform`, `authenticator`) | density, data, operational control |
| **Marketing** | `web` | persuasion, product positioning, enterprise trust |
| **Docs** | `docs`, `developer`, `reference`, `wiki` | reading efficiency, navigation clarity, technical confidence |

Each `.cn` site is mirrored by a `.com` twin. A change to a shared design file is
not done until both sides carry it.

## 2. Token architecture

Three layers, one source of truth.

```
tokens/tokens.json            ← the only hand-edited token file
        │  pnpm gen
        ▼
packages/tokens/tokens.css            L1 core + L3 variant blocks
packages/tokens/profiles/*.css        L2 profile overrides
packages/tokens/primitives.css        hand-maintained component classes
packages/tailwind-preset/index.js     Tailwind theme extension
packages/tokens/dist/{tokens.json,index.js,index.d.ts,antd-theme.js,chart.js}
```

- **L1 `core`** — palette, semantic colors, type scale, space, radius, shadow,
  motion, focus, z-index, layout, a11y, imagery. Global, surface-independent.
- **L2 `profiles`** — `console`, `marketing`, `docs`, `developer`. A profile may
  override L1 values. `console` is the canonical baseline and overrides nothing.
- **L3 `variants`** — `portal`, `auth`, `authenticator`, `auth-tenant`. Runtime
  or page-level themes layered on top of a profile.

### Consumption

```css
/* app or site entry stylesheet */
@import '@autional/tailwind-preset/tokens.css';   /* L1 core + variants */
@import '@autional/tokens/profiles/docs.css';     /* L2, load AFTER core */
@import '@autional/tokens/primitives.css';        /* shared brand classes */
```

```ts
// tailwind.config.ts
import preset from '@autional/tailwind-preset';
export default { darkMode: 'class', presets: [preset], content: [...], theme: { extend: {} } };
```

Generated artifacts are **committed**. Consumers need no build step and no
network access at build time. CI asserts that re-running `pnpm gen` produces no
diff.

### Cascade order is load-bearing

The generator emits variant blocks in a fixed order:
`portal` → `auth` → `dark` → `authenticator`.

`.`dark` must beat `[data-theme="portal"]` and `[data-theme="auth"]`, because a
user can enable dark mode while on a portal or auth page. `[data-theme="authenticator"]`
must beat `.dark`, because that app is dark-first by design. Do not reorder these
blocks by hand; change `VARIANT_ORDER` in `scripts/generate.mjs` if it must change.

### Tailwind overrides — read before writing utility classes

The preset **overrides** several Tailwind defaults, matching the design system's
existing scale. These differ from stock Tailwind and are a common source of
surprise:

| Utility | Autional value | Stock Tailwind |
|---|---|---|
| `rounded-lg` | 24px | 8px |
| `rounded-md` | 16px | 6px |
| `rounded-sm` | 8px | 2px |
| `text-lg` | 18px **+ `font-weight: 500`** | 18px, weight inherited |
| `text-xl` / `text-2xl` / `text-3xl` | sets weight 600 / 700 / 700 | weight inherited |

The type scale carrying weights is deliberate: headline hierarchy should come
from one class. It also means `text-lg font-normal` is required to opt out.

`rounded-2xl` (16px), `rounded-3xl`, bare `rounded` (4px), and `shadow-sm`/`shadow-md`/`shadow-lg`
are **not** part of the token scale — the preset uses `theme.extend`, so they fall through to
Tailwind's factory values and still compile. That is exactly why they need a gate: a class that
renders is not a class that is allowed. Use `rounded-{xs,sm,md,lg,xl,xxl}` and
`shadow-{soft,card,brand}`. `rounded-none` and `shadow-none` stay legal — zero is not a step,
it is the absence of one.

Round 55 added the missing steps rather than re-educating the fleet twice: `radius-xs` (4px, the
"tighter" case below), the density half steps, the 64/80 rhythm steps. `scripts/check-token-tiers.mjs`
derives the legal sets **from `tokens/tokens.json`** — this paragraph and that gate cannot drift.

`text-4xl` (36px / 40px) is the one case that was **promoted into the scale** instead
of being left to fall through. Reason: the ladder had a ×1.333 hole between `3xl`
(30px) and `display-lg` (40px) — the largest adjacent jump in the whole scale, every
other step being ≤ ×1.25 — and the fleet had independently settled on 36px for page
titles (`text-4xl` appears 68× across all 14 sites, alongside 63× `text-3xl` and 40×
`text-5xl`). The preset defines it with stock Tailwind's values (36px / 40px, no
weight or tracking), so switching an existing `text-4xl` onto the token is a no-op
by construction. Rationale is recorded in `core.font-size.$font-size-note`.

#### Ramp families have no `DEFAULT` — spell the step

`primary`, `sky`, `amber`, `neutral`, `chart`, and `method` are exposed as **ramp
objects** with numbered steps only. There is deliberately **no `DEFAULT` key**, so bare
`bg-primary`, `text-primary`, `border-primary` — and the same with any other utility
prefix — generate **no CSS at all**. The build succeeds, the page silently keeps
whatever it had. `scripts/check-classnames.mjs` fails the build on any such class.

This is a decision, not an oversight (settled 2026-09-29). Two unambiguous spellings
already exist, and a `DEFAULT` could only pick one of them and silently mistranslate
the other:

| You mean | Write this | Resolves to |
|---|---|---|
| The brand blue, `#003153` | `bg-primary-700`, `text-primary-700` | `--color-primary-700` |
| The page background | `bg-[var(--color-bg-primary)]` | `--color-bg-primary` (= `--color-neutral-50`) |
| Body text | `text-[var(--color-text-primary)]` | `--color-text-primary` (= `--color-primary-900`) |

The trap is specific and worth stating plainly: **`--color-bg-primary` is the page
background, not the brand blue**, while `primary-700` *is* the brand blue. A
`colors.primary.DEFAULT` would have to mean one of them and would be wrong — and
invisible — for everyone who meant the other. That trades a loud build failure for a
quiet wrong colour, which is the exact failure mode this rule exists to end.

Nothing is lost by omitting it: the source design system (`autional/ui`, `DESIGN.md`)
defines `primary: "#003153"`, which is exactly `primary-700`, and the ramp already
addresses that step. If a `DEFAULT` is ever added on purpose, the gate above reads the
palette list out of the SSOT rather than hard-coding it, so those classes start
passing automatically — the rule follows the tokens, not a written-down list.

## 3. Color

One deep brand blue, one sky accent, one amber accent, a neutral ramp, four
semantic states.

- **Primary** — authority and trust. Headings, primary buttons, active navigation, deep surfaces.
- **Sky** — technical lift and hover states. Supports primary; never competes with it.
- **Amber** — a strict accent. Urgency and emphasis only. Never a large background.
- **Neutral** — most of any layout. The brand reads as premium through structure
  and restraint, not through saturation.

### Semantic colors

`success` / `warning` / `danger` / `info`. Use these for state. Do not improvise
local state colors. `error` is a deprecated alias for `danger`; both work in
Tailwind classes, `danger` is canonical in CSS variables and new code.

### The canonical scale beats per-site improvisation

Where a heritage site and the console fleet disagreed, the fleet scale wins —
it is the one twelve repositories already ship, and it is the continuous
50→900 ramp:

| Was | Canonical | Note |
|---|---|---|
| website `primary-500` `#2c8ec0` | `#235f84` | the website's value was an isolated point, not a ramp |
| website amber ramp (shifted one step) | console amber ramp | `#ffbf00` stays at 500 |
| website shadow names | `soft` / `card` / `brand` trio | same names now mean one thing everywhere |
| local chart colors (`#10b981`, `#8b5cf6`, `#722ed1`, `#6366f1`, …) | `chart-1…8` | see below |
| local HTTP method colors | `method-*` | see below |

### Chart series

`chart-1…8` are **pinned literals**, not references into the brand scales.
`chart-1` is `primary-700` so single-series charts sit on the brand anchor; 2…8 alternate hue
family and lightness so adjacent series differ in both.

Pinning is deliberate. Deriving them from primary/sky/amber looked tidier, but the docs and developer
profiles redefine those scales as their own tint, so derived series silently followed the profile
(worst pair fell to dE 10.7 normal / 8.4 deuteranopia in docs-dark). A categorical palette is a
system-level property: two portals drawing the same chart must draw it in the same colours.
Asserted by `scripts/check-chart-palette.mjs`.

**Never use `chart-N` for status-like series.** Health, delivery, pass/fail and
similar semantics use `success` / `warning` / `danger`. A categorical breakdown
of unrelated things uses `chart-N`.

For chart libraries that need literal hex strings rather than CSS variables:

```js
import chart from '@autional/tokens/chart';
// chart.chart['1'], chart.method.get, chart.semantic.success
```

### HTTP method palette

`method-get` / `post` / `put` / `patch` / `delete` / `head`, shared by the wiki,
reference, and admin surfaces. Use the token; do not re-pick a green for `POST`.

### Code and syntax colors

`plain / comment / keyword / string / number / function / type / tag`, exposed as `text-syntax-*`.
The group exists because a brand scale cannot express a **role**. A keyword and a string sit on the
same line, so what matters is that any two roles are distinguishable — not which brand hue carries
"string". Before this group, sites hand-picked Tailwind defaults (`text-sky-300`,
`text-emerald-300`, `text-violet-300`, `text-green-400`, `text-slate-100`); five of those families
are not in the design system at all.

Values are **pinned literals**, never `{color.*}` references, for the same reason as `chart-*`.
`scripts/check-syntax-palette.mjs` asserts them against the fleet's real code surfaces
(`slate-900` / `slate-950`): every role ≥ 4.5:1 contrast (this is text, so 1.4.8 AA, not the 3:1
used for chart marks), and any two roles ≥ 12 dE normal / ≥ 10 dE deuteranopia. The first candidate
set looked fine in normal vision (18.9) and collapsed under deuteranopia (3.3) — purple and sky are
the same colour once red/green is removed, and keyword/function are exactly the pair that appears
next to each other.

Scope: **dark code surfaces only**. The four light-surface `<pre>` blocks in admin/security inherit
the page foreground and are deliberately out of scope. The code surface colour itself
(`bg-slate-900` / `bg-slate-950`) is still a Tailwind default rather than a token — registered as a
follow-up, and the gate pins the two literals until it is.

### Borders are profile-dependent

`border-subtle` deliberately resolves per profile: `console` keeps
`primary-200`, `docs`/`developer` use `primary-100`. Same name, profile-appropriate
value. Never hard-code a border color that is a border token's job.

## 4. Dark mode

Enabled by `class="dark"` on the root element (`darkMode: 'class'`), or by
`[data-theme="dark"]`. Both selectors are emitted together and are equivalent.

**Dark mode inverts the neutral ramp and rebinds surfaces and semantic text
tokens. It does not invert primary, sky, or amber.**

That single rule explains nearly every dark-mode bug in this codebase:

```jsx
// WRONG — primary-900 is #041d31 in both schemes; invisible on a dark surface
<h1 className="text-primary-900">

// RIGHT — follows the scheme
<h1 style={{ color: 'var(--color-text-primary)' }}>
```

Rules:

- Color **text** with `var(--color-text-primary | --color-text-secondary | --color-text-muted)`,
  or with `neutral-*` steps (which invert automatically).
- Raw `primary-*`, `sky-*`, `amber-*` steps are for **surfaces, borders, and
  accents that are correct in both schemes** — not for body text.
- Build dark-capable surfaces from `--color-bg-surface` / `--color-bg-elevated` /
  `--color-bg-muted`. Do not paint a light background and hope.
- **`docs` / `developer` / `reference` / `wiki` are light-only surfaces.** They
  do not ship dark mode; `.docs-prose` assumes a light background (its tables and
  blockquotes have light fills). If dark mode is ever added there, `.docs-prose`
  needs a dark variant first.
- `authenticator` is dark-first with pure black. It is a variant, not a dark
  mode; it wins over `.dark`.

### Per-profile strategy

| Profile | Dark support | Notes |
|---|---|---|
| `console` | full | `.dark` on root; antd uses `theme.darkAlgorithm` |
| `marketing` | full | `darkMode: 'class'`; the reference implementation for brand surfaces |
| `docs`, `developer` | none | light-only; stray `dark:` utility classes are inert |
| variant `authenticator` | always dark | pure black, ignores the light scheme |

## 5. Typography

**Latin: self-hosted Inter** (`@fontsource/inter`). **CJK: system stack** —
`PingFang SC`, `Microsoft YaHei`, `Noto Sans CJK SC`, with `Inter` first so Latin
glyphs render in the brand face.

CJK webfonts are **rejected for the web surfaces**: a usable subset exceeds 2MB
and the LCP cost on Vercel behind a mainland-China network is not acceptable.
Previous declarations of `Noto Sans SC` loaded nothing at all; that is why the
stack is now explicit about what is actually available. `Source Han Serif SC`
remains an editorial accent only, never the UI voice.

- **Display/hero** — heavy, tight tracking, short line lengths.
- **Body** — comfortable leading, tuned for bilingual reading.
- **Labels/kickers** — uppercase, high tracking; they create brand rhythm.
- **Code** — monospace, dark panel, high contrast, generous line-height.

Use weight, spacing, and hierarchy before reaching for another family. Do not
mix multiple expressive personalities on one page.

## 6. Motion

Tokens: `--motion-duration-{instant,fast,base,slow,slower}` and
`--motion-ease-{standard,out,in,in-out}`.

- Hover/press feedback: `fast` (150ms) with `standard`.
- Surface entrances and expansions: `base` (200ms) with `out`.
- Anything longer than `slow` (300ms) needs a reason.

`prefers-reduced-motion: reduce` is honored globally by the generated
stylesheet: animations and transitions collapse to ~0ms and smooth scrolling is
disabled. Do not re-enable long motion inside a component without checking the
media query.

Motion should express state change, not decorate. No bouncing, no attention-seeking
loops, no animated gradients.

## 7. Accessibility

Non-negotiable minimums.

- **Focus is always visible.** A global `:focus-visible` rule draws a 2px ring
  with 2px offset in `--focus-ring-color` (`primary-500`; `sky-500` on dark and
  authenticator surfaces). Components that draw their own ring must disable the
  outline (`focus-visible:outline-none`) rather than removing the base rule.
- **Touch targets ≥ 44px** (`--a11y-touch-target`). Applies to icon-only buttons,
  table row actions, and mobile navigation.
- **Body text ≥ 4.5:1** against its surface; large text and UI borders ≥ 3:1.
- **Color is never the only signal.** Status carries an icon or label, not just
  a red tint.
- **Icons that are the only content need `aria-label`.** Decorative icons need
  `aria-hidden`.
- **Dialogs** trap intent: `Escape` closes, `aria-label` on the close control.
- **Forms**: every input has a programmatically associated label; errors are
  text, not color alone.

### Known contrast debt (fix when touched, do not propagate)

- `--color-text-muted` resolves to `#64748d` in **both** schemes. On dark
  surfaces that is ≈3.9:1 — below AA for body text. Dark-mode muted text should
  move up the sky/neutral ramp; do not copy the current value into new work.
- Amber-family fills with white text (e.g. a warning toast) fall below 3:1.
  Warning surfaces should use dark text on amber, or an amber-tinted surface
  with dark text.
- `--color-text-muted` on `--color-bg-muted` is near the AA boundary in light
  mode; reserve that pairing for secondary metadata, not body copy.

## 8. Layout and z-index

- Content max width: `--layout-max-width` (1280px). Prose column:
  `--layout-prose-width` (768px).
- Breakpoints are the Tailwind defaults and match the `--layout-breakpoint-*`
  tokens: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.
  **CSS variables cannot be used inside media queries** — those tokens exist to
  document the scale; media queries must repeat the literal values.
- Spacing has **two domains**, and the domain decides which values are legal:
  - **Layout rhythm** (page and block level): `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80`.
    The upper two (`space-16` = 64px, `space-20` = 80px) were added in round 55: content sites
    were already using them in 85 places while the documented ladder stopped at 48, so "the rule
    is too small" was being recorded as "the site overstepped". One page uses one rhythm step —
    mixing 64 and 80 inside one site is the inconsistency, not either value on its own.
  - **Control density** (inside a control): the half steps `0.5 / 1.5 / 2.5 / 3.5`
    (2 / 6 / 10 / 14px) are legal — badge padding, gaps between inline chips, dense table rows.
    They are in the token scale, not Tailwind leftovers (round 55), so "is 6px allowed?" now has
    an answer. Use them for density, never to fine-tune page rhythm.
  - A token must have a consumer. `hero-gap` (40px) had none and duplicated `space-10`, so it
    was deleted in round 55 rather than kept as a second name for the same value.
- The layout is containment-first and card-based. Group related information into
  surfaces instead of letting it float.

### z-index

Use the `z-*` utilities backed by `--z-*` tokens, not arbitrary values:

| Token | Value | For |
|---|---|---|
| `base` | 0 | page flow |
| `dropdown` | 1000 | menus, selects |
| `sticky` | 1020 | sticky headers |
| `fixed` | 1030 | fixed chrome |
| `modal-backdrop` | 1040 | scrim |
| `modal` | 1050 | dialogs |
| `popover` | 1060 | popovers, tooltips with content |
| `toast` | 1070 | notifications |
| `tooltip` | 1080 | non-interactive tooltips |

Legacy `z-50` / `z-[100]` are still legal but sit outside the scale; migrate them
when touching the file.

## 9. Elevation and shapes

Depth supports hierarchy; it does not create spectacle.

- `shadow-soft` — pills, small buttons, subtle lift.
- `shadow-card` — standard cards and contained blocks.
- `shadow-brand` — hero shells and the whole **floating layer**: menus, popovers, dialogs,
  drawers, toasts. A floating surface always sits above content, so it always takes this step.
- Dark technical panels may carry deeper shadows; they represent dense content.

These five are **one language, not a palette**. Round 55 measured the fleet and found two
languages running in parallel: the design system's own components used Tailwind's factory
`shadow-sm` / `shadow-lg` (neutral black), while content sites and the `docs` / `developer`
profiles used this family (brand-tinted). A single page could therefore show both. Components
converge onto this family — do not add a neutral shadow step to accommodate them.

Prefer surface separation plus a subtle border over shadow stacks. Do not use
large fuzzy colored glows. In documentation, readability outranks atmosphere.

Shapes are rounded but disciplined: pills and buttons full-round; cards `radius-lg`
(24px); premium shells `radius-xl` (28px); developer panels up to `radius-xxl`
(32px); inline chips and code `radius-xs` (4px) — round 55 added that step because this
sentence already said "tighter" while the scale stopped at `radius-sm` (8px), and the fleet
answered with bare `rounded` (Tailwind's 4px default) in 109 places. Keep one radius family per page. Rounded
means refined, not playful — never mix sharp industrial corners into a soft shell
without a semantic reason.

## 10. Components

### 10.1 Shared brand classes

Defined in `packages/tokens/primitives.css`, consumed with zero build step.

| Class | Role |
|---|---|
| `brand-shell` | premium outer surface, hero frames, grouped sections (blur + soft elevation) |
| `brand-card` | default elevated content card |
| `brand-button-primary` / `-secondary` | primary and supporting action, full radius |
| `brand-kicker` | uppercase section eyebrow, high tracking |
| `brand-grid` | restrained background grid, product/data areas only |
| `developer-panel` / `developer-code` / `developer-chip` / `developer-nav-link` | dark technical surfaces |
| `docs-nav-link`, `docs-prose` | documentation navigation and prose |

`primitives.css` is hand-maintained. Every absolute typographic and color value in
it is a `var()` reference — measured 35 of 36 typographic declarations (the single
exception is a relative `0.92em` on inline code) — so the same class renders
correctly under every profile. Reuse these before inventing a new button, card, or
shell. If a new reusable pattern is needed, it belongs in this file, not inline in
one page.

> **Consumption status (measured 2026-09).** Despite being documented here as the
> shared component layer, **none of the 14 sites imports this file** — 0 references
> by relative path or package name. These classes are instead re-implemented by hand
> in six sites' own `global.css` (`brand-shell`, `brand-button-primary`,
> `brand-kicker`), and the docs site's build loads only a single `_astro/*.css`.
> Treat this section as the **intended** contract, not the delivered one. The gap is
> tracked as `KI-010` and enforced by `pnpm typography` (rule TY5).

It also carries the content-site base layer: `html { scroll-behavior: smooth }`,
the page wash, and `::selection`. The page wash reads
`body { background-image: var(--image-page-light) }` and flips through
`.dark body { … var(--image-page-dark) }`. It lives in `core.image` because it is
brand surface, not page decoration — override `image.page-light` /
`image.page-dark` in a profile instead of writing a local gradient.

### 10.2 Console components

Shared React components live in each SPA's `packages/ui`. These are the canonical
behaviors; deviations are bugs.

- **Button** — variants `primary` / `secondary` / `outline` / `ghost` / `danger`;
  sizes `sm` (h-8) / `md` (h-10) / `lg` (h-12); `isLoading` shows a spinner and
  disables the control; `rounded-md`; disabled at 50% opacity.
  One primary action per view.
- **StatusBadge** — `success` / `warning` / `danger` / `info` / `neutral`, tinted
  at 10% with the matching text color, `rounded-full`, `text-xs`.
- **Input / Label / Toggle** — label always associated; error text is explicit.
- **Modal** — scrim `bg-black/40`, panel `bg-surface` + `border-subtle` +
  `rounded-xl`, header/footer `px-6 py-4`, footer right-aligned `gap-3`, `Escape`
  closes, body scroll locked while open. Widths `sm`/`md`/`lg`.
- **ConfirmDialog** — destructive actions always confirm; the confirm button is
  `danger`.
- **Toast** — `success` / `error` / `warning` / `info`, top-right stack, `gap-2`,
  auto-dismiss ~3s, manual dismiss available, one line where possible.
  Warning toasts must not pair amber with white text (see §7).
- **EmptyState** — dashed `border-subtle` on `bg-muted`, centered icon + title +
  one-line description. Every list and table needs one.
- **LoadingScreen** — spinner in `--color-brand` + 1-line message; `fullScreen`
  variant for route-level suspense, inline (`h-40`) for panels.
- **ErrorBoundary / ErrorState** — route-level failure is a surface with a retry
  affordance, never a blank page.
- **SectionCard / PageContainer / PageHeader** — page scaffolding; `SectionCard`
  padding `sm` p-4 / `md` p-6 / `lg` p-8.

**Fixed in round 55 — in one unit with the release.** 13 places inside the design system itself used
off-scale classes: the card components `shadow-sm`, the floating layer `shadow-lg`, two bare
`rounded`, one `rounded-2xl`. They now read `shadow-card` / `shadow-soft` / `shadow-brand` /
`rounded-xs` / `rounded-lg`, and `verification/token-tiers.json` keeps an **empty** allowance:
a new off-scale class in the design system is a hard failure with no registration path.

They could not be fixed alone: a site's stylesheet only contains a class if the **published** package
uses it, so renaming here without shipping leaves `check-ds-classes` red — correctly, because the
components would then render half-styled in every portal. So this change ships together with the
`@autional/ui` rc release, and only lands on the portals after they bump the version and rebuild.

Do not "fix" this by adding a neutral shadow step to the scale to legalise the old names. The
scale is a language; the fix is to speak it.

### 10.3 Tables

Console tables are antd `Table` with the token bridge applied (§11). Rules:

- Numeric columns right-aligned; identifiers and timestamps monospace.
- Status is a `StatusBadge`, never raw colored text.
- Row actions are icon buttons with `aria-label` and a ≥44px hit area.
- Empty state via antd `locale.emptyText`, styled as `EmptyState`.
- Pagination is server-driven; page size is user-visible.

### 10.4 Forms

- One column unless fields are genuinely paired; labels above inputs.
- Required fields marked; validation messages appear next to the field.
- Destructive submit confirms first.
- On failure, preserve user input.

## 11. antd bridge

antd is a first-class dependency of the console face — kept, not replaced — and
is bound to the token system through `ConfigProvider`:

```tsx
import antdToken from '@autional/tokens/antd-theme';

<ConfigProvider
  theme={{
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: (isDark ? antdToken.dark : antdToken.light).token,
  }}
>
```

This injects `colorPrimary` (`#003153`), the semantic colors, container colors,
text color, `borderRadius: 8`, and the font family. A console **must not** fall
back to antd's default `#1677ff` — an unbridged `ConfigProvider` is a brand
violation. Per-component overrides that fight the injected tokens should be
deleted, not stacked.

## 12. Icons and brand marks

- **One icon library: `lucide-react`.** No mixed icon sets on a page. The admin
  app still imports `@ant-design/icons` in many places; those are migration debt
  and should be replaced with the lucide equivalent when the file is touched.
- Icons inherit `currentColor` and the surrounding text size unless the component
  specifies otherwise.
- Sizing follows the component scale (h-4/h-5 for inline, h-6 for empty states).

### Logo and favicon

- Header carries primary brand recognition. Do not repeat a heavy logo lockup in
  the footer.
- `assets/logo/` holds the marks; `assets/favicon/` holds the favicon family
  (light/dark/mono, SVG first).
- Use the light/dark favicon pair for `prefers-color-scheme`, and the mono
  variants on photographic or low-contrast backgrounds.
- The color mark's own palette (`#93BFDE` / `#223A58` / `#E8B440`) is intentionally
  distinct from the token blue. Do not "correct" it to `#003153`.

## 13. Asset and metadata governance

- **Favicons: one canonical set.** Each site consumes `assets/favicon/`; historical
  per-site variants (`favicon-master-blue-v7.png` and its siblings) are retired.
  A site shipping its own one-off favicon is drift.
- **`theme_color` is a token, not a mood.** It must equal the surface the PWA
  chrome sits against:
  - brand surfaces → `#003153`
  - light content sites → `#ffffff`
  - `authenticator` (dark-first) → `#0a0a0a`
  Current known deviation: `user` declares `#4f46e5` (indigo), which is not in
  the system at all. `status` (`#003153`), `authenticator` (`#0a0a0a`), and the
  content sites (`#ffffff`) are correct.
- `site.webmanifest` names must match the site (`reference` currently ships
  `"Autional Docs"` — a copy error).
- `.cn` and `.com` twins share design files byte-for-byte. A design change lands
  on both sides in the same round of work.

## 14. Copy and brand voice

- **`Autional`** is the product name; keep its capitalization everywhere,
  including in prose and UI strings.
- **Sentence case** for UI labels, buttons, and headings. Not Title Case, not ALL
  CAPS — uppercase is reserved for kickers and eyebrow labels (which use the
  `label-caps` treatment).
- **Never claim what the platform does not do.** Marketing and compliance copy
  must not assert certifications, download availability, or capabilities the
  system has not shipped. Regulated wording is reviewed, not improvised.
- Bilingual surfaces keep the same information density in both languages; do not
  let one language become the "real" page.
- Error messages state what happened and what to do next. No raw error codes as
  the primary message, no blame.

## 15. Do's and Don'ts

**Do**

- Edit `tokens/tokens.json`, run `pnpm gen`, and commit the generated output.
- Build most layouts from neutral surfaces plus deep blue hierarchy.
- Reuse shared primitives and semantic tokens before writing local styles.
- Keep one primary action and one supporting secondary action per view.
- Verify both light and dark when touching a dark-capable surface.
- Check the profile — the same class renders differently under `docs` than under
  `console`, on purpose.

**Don't**

- Don't hard-code a hex that a token already carries.
- Don't edit anything under `packages/*/` that is generated — fix the SSOT.
- Don't use raw `primary-*`/`amber-*` steps for text on a dark-capable surface.
- Don't use `amber` as a large background or a repeated decorative accent.
- Don't use `chart-N` for state or `success`/`danger` for unrelated categories.
- Don't mix icon libraries, radius families, or gray ramps on one page.
- Don't let a console render antd's default blue.
- Don't make docs feel like marketing, or marketing feel like a console.
- Don't add a new color, shadow, or radius outside the token system.
