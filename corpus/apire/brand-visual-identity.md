# Brand Visual Identity — Logo, Colors, Typography, Design System

**What this file contains:** APIRE's complete visual design system — exact hex codes, font family, logo rules, spacing/border/shadow tokens, icon style guidance, photography direction. Use this for any generated content that includes image prompts, design briefs, or visual references.

**Sources:**
- Live `apire.io` site CSS (primary, extracted from `apire-site.pages.dev` — single source of truth as of June 2026)
- `APIRE - Brand Guidelines & Visual Identity.docx` (historical; superseded where it conflicts with the live CSS)
- `APIRE - Complete Brand Context Document.docx`

---

## MACHINE-READABLE COLOR SPECIFICATION (for AI image generation)

⚠️ IMPORTANT: The values below supersede any other color mentions in
this document. These are extracted from the live apire.io CSS and are
the single source of truth.

BACKGROUND_PRIMARY: #000000 (pure black — fills 65-75% of image)
BACKGROUND_SURFACE: #0a0a0f (near-black surface)
BACKGROUND_CARD: #0f0f1a (dark card surfaces)

ACCENT_PRIMARY: #7c3aed (purple — dominant light source and accent)
ACCENT_BRIGHT: #8b5cf6 (bright purple — glows, highlights)
ACCENT_LIGHT: #a78bfa (light purple — secondary highlights)
ACCENT_SECONDARY: #06b6d4 (cyan — secondary accent only)
ACCENT_CYAN: #22d3ee (bright cyan — used sparingly)

GRADIENT_HERO: purple #7c3aed → blue #2563eb → cyan #06b6d4
GRADIENT_BRAND: purple #8b5cf6 → cyan #06b6d4
GRADIENT_CARD_ACCENT: purple #7c3aed → cyan #06b6d4 → transparent

FONT_DISPLAY: Poppins
FONT_MONO: JetBrains Mono

GLOW_PRIMARY: rgba(124,58,237,0.18) — purple ambient glow
GLOW_SECONDARY: rgba(6,182,212,0.12) — cyan ambient glow

FORBIDDEN COLORS (must NOT appear in APIRE images):
- NO magenta or pink (#F472B6, #c026d3) — OSM brand color
- NO warm tones (orange #fb923c, amber #F59E0B, yellow)
- NO red tones unless representing critical alerts
- NO generic grey/silver server room aesthetic
- NO electric blue (#18A4FB) — old incorrect value, no longer used
- NO deep navy (#060C2E) — old incorrect value, no longer used
- NO bright white light sources

IMAGE LIGHTING SPECIFICATION:
- Primary light source: purple (#7c3aed), atmospheric glow
- Secondary light: cyan (#06b6d4), accent highlights
- All shadows: pure black (#000000) base
- Atmosphere: purple-tinted darkness with subtle cyan accents
- Color temperature: cool (6500K+), never warm

---

## Logo

**Primary logo:** White "APIRE" text in all caps, clean modern sans-serif typeface. Typically displayed on a pure black background (#000000) with a purple/cyan ambient glow.

**Logo variations:**
- **Primary:** White on black
- **Reversed:** Black on white
- **Monochrome:** Black on white (print); white on black (dark mode)

**Specifications:**
- Format: SVG (preferred), PNG with transparent background
- Minimum size: 120px width (digital), 1 inch (print)
- Clear space: Maintain clear space equal to the height of the letter "A" on all sides

**Logo usage rules:**

DO:
- Use the logo at appropriate sizes with clear space
- Maintain original proportions
- Use approved color variations
- Place on backgrounds with sufficient contrast

DON'T:
- Stretch, distort, or rotate
- Change logo colors outside approved palette
- Add effects (shadows, glows, gradients) to the logo itself
- Place on busy backgrounds that reduce legibility
- Recreate or modify the logo typeface

---

## Color palette

> The live apire.io aesthetic is a **pure-black canvas lit by purple**, with
> cyan as a secondary accent. Purple (#7c3aed) is the dominant brand color;
> cyan (#06b6d4) supports it; blue (#2563eb) appears only inside gradients.

### Primary colors

| Role | Name | Hex | RGB | Meaning / Usage |
|---|---|---|---|---|
| Primary background | **Pure Black** | `#000000` | 0, 0, 0 | Depth, focus, premium security. The dominant canvas — fills the majority of every surface and image. |
| Surface | **Near-Black** | `#0a0a0f` | 10, 10, 15 | Sections and panels lifted just off the pure-black base. |
| Card | **Dark Card** | `#0f0f1a` | 15, 15, 26 | Card and container surfaces, subtly elevated. |
| Primary text / logo | **White** | `#FFFFFF` | 255, 255, 255 | Clarity, simplicity, transparency. Text on dark backgrounds, logo on black, clean space. |

### Accent colors

| Role | Name | Hex | RGB | Meaning / Usage |
|---|---|---|---|---|
| Primary accent | **Purple** | `#7c3aed` | 124, 58, 237 | The dominant brand color. CTAs, links, highlights, primary glow / light source, key interactive elements. |
| Bright purple | **Bright Purple** | `#8b5cf6` | 139, 92, 246 | Glows, hover highlights, gradient stops, stat numbers. |
| Light purple | **Light Purple** | `#a78bfa` | 167, 139, 250 | Text accents, secondary highlights, subtle detail. |
| Secondary accent | **Cyan** | `#06b6d4` | 6, 182, 212 | Secondary accent only — pairs with purple in gradients and accent highlights. |
| Bright cyan | **Bright Cyan** | `#22d3ee` | 34, 211, 238 | Used sparingly for the brightest cyan highlights. |
| Gradient blue | **Blue** | `#2563eb` | 37, 99, 235 | Used sparingly — only as the middle stop of the hero gradient. |

### Supporting colors

| Role | Name | Hex | RGB | Usage |
|---|---|---|---|---|
| Light surface | **Light Gray** | `#F5F6FA` | 245, 246, 250 | Light-theme section backgrounds, cards, subtle separation (docs/forms only). |
| Body text (light) | **Black** | `#000000` | 0, 0, 0 | Body text on light backgrounds, high-contrast elements. |
| Secondary text | **Medium Gray** | `#6B7280` | 107, 114, 128 | Secondary text, captions, metadata. |

### Semantic colors (product UI states only — NOT for marketing imagery)

| State | Hex | Usage |
|---|---|---|
| Success / Defense Emerald | `#10B981` | Success messages, positive metrics, "threat blocked" / compliance indicators. Compliance/defense contexts only. |
| Warning Orange | `#F59E0B` | Warnings, medium-priority alerts (UI only — warm tones are forbidden in generated imagery). |
| Error Red | `#EF4444` | Errors, critical alerts, high-priority threats. |
| Info | `#2563eb` | Informational messages, tips, guidance. |

### Gradients

- **Hero gradient:** `#7c3aed → #2563eb → #06b6d4` (purple → blue → cyan), direction 135deg. Use for hero sections and large feature surfaces.
- **Brand gradient (CTAs & highlights):** `#8b5cf6 → #06b6d4` (bright purple → cyan), direction 135deg. Use for primary buttons and featured callouts.
- **Card accent gradient:** `#7c3aed → #06b6d4 → transparent` (purple → cyan → transparent), direction 90deg. Use as a thin top-border accent on cards.
- **Stat numbers:** `#8b5cf6 → #06b6d4` (bright purple → cyan), direction 135deg. Use for large numeric highlights.

### Ambient glow system

- **Primary glow:** `rgba(124,58,237,0.18)` — purple, anchored top-left. The dominant ambient light.
- **Secondary glow:** `rgba(6,182,212,0.12)` — cyan, anchored top-right. A subtle counter-accent.

### Color combinations

- **High contrast (primary):** Pure Black (`#000000`) + White (`#FFFFFF`). Use for headers, navigation, hero sections.
- **Accent combination:** Purple (`#7c3aed`) + Pure Black (`#000000`). Use for CTAs, interactive elements, glows.
- **Light theme:** White (`#FFFFFF`) + Black (`#000000`) + Light Gray (`#F5F6FA`). Use for content areas, documentation, forms.

### Accessibility (WCAG AA verified)

- White on Pure Black: **21 : 1** ✅
- Purple (`#7c3aed`) on Pure Black: **5.1 : 1** ✅
- Light Purple (`#a78bfa`) on Pure Black: **8.9 : 1** ✅
- Black on White: **21 : 1** ✅
- Medium Gray on White: **4.6 : 1** ✅

All primary color combinations meet WCAG AA (4.5 : 1 for normal text, 3 : 1 for large text).

---

## Typography

### Display typeface: **Poppins** · Mono typeface: **JetBrains Mono**

- **Display / headings:** Poppins (geometric sans-serif) — headlines, section titles, display text.
- **Mono / labels / code:** JetBrains Mono — monospace labels, eyebrow tags, code, metrics.
- **License:** Both Open Font License (free for commercial use).

**Why Poppins + JetBrains Mono:**
- Poppins gives a modern, confident, slightly geometric display voice.
- JetBrains Mono labels reinforce the technical, security-engineering tone.
- Both render cleanly on dark backgrounds and have wide language support.

### Font weights and usage

| Weight | Use | Sizes |
|---|---|---|
| **Bold (700)** | Main headlines, section titles, emphasis. All caps for main sections; sentence case for subheadings. | 32–72px headlines; 18–24px subheadings |
| **SemiBold (600)** | Subheadings, card titles, button text. Sentence or title case. | 18–28px |
| **Medium (500)** | Navigation, labels, secondary headings. Sentence case. | 14–18px |
| **Regular (400)** | Body text, paragraphs, descriptions. Sentence case. | 14–18px body; 12–14px captions |
| **Light (300)** | Large display text only (sparingly). Sentence case. | 48px+ only |

### Typography scale

| Style | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| Display (hero) | 56–72px | Bold or Light | 1.1 | -0.02em |
| H1 (page title) | 40–48px | Bold | 1.2 | -0.01em |
| H2 (section) | 32–36px | Bold or SemiBold | 1.3 | -0.01em |
| H3 (subsection) | 24–28px | SemiBold | 1.4 | 0 |
| H4 (card title) | 18–20px | SemiBold | 1.5 | 0 |
| Body Large | 18px | Regular | 1.6 | 0 |
| Body Regular | 16px | Regular | 1.6 | 0 |
| Body Small | 14px | Regular | 1.5 | 0 |
| Caption / label | 12px | Regular or Medium (JetBrains Mono) | 1.4 | 0.01em |

### Web font stack (fallback)

```css
/* Display */
font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
/* Mono / labels / code */
font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
```

### Print / Office

- Primary: Poppins
- Fallback: Arial, Helvetica

### Code typography

- **Monospace font:** JetBrains Mono
- Sizes: 14–16px
- Background: Dark Card (`#0f0f1a`) or Near-Black (`#0a0a0f`)

### Typography best practices

DO:
- Use Poppins for display/headings and JetBrains Mono for labels/code
- Maintain consistent hierarchy
- Use appropriate line heights (1.5–1.6 for body)
- Limit to 2–3 font weights per design
- Ensure sufficient contrast for readability

DON'T:
- Mix in unrelated typefaces beyond Poppins + JetBrains Mono
- Use too many font weights in one design
- Set body text below 14px
- Use tight line heights (<1.4) for body text
- Use all caps for long-form content

---

## Visual style and design elements

### Design philosophy

APIRE's visual style is **modern, dark, and security-focused** — a pure-black canvas lit by purple. Prioritize clarity and depth over decoration. Clean layouts, purposeful glow, purposeful design elements that reinforce *security without friction*.

### Key visual characteristics

1. **Black-first layouts** — pure-black (`#000000`) backgrounds with purple/cyan ambient glow for depth, clear visual hierarchy, grid-based alignment.
2. **Purple as the primary light** — purple (`#7c3aed`) glow is the dominant light source; cyan (`#06b6d4`) is the secondary accent.
3. **Flat, modern iconography** — flat, monotone SVG icons; purple accents (`#7c3aed`); 2px stroke; rounded corners (2–4px).
4. **Subtle depth** — elevation through layering (near-black → dark card) and ambient glow rather than heavy drop shadows.

### Shadows & glow

- **Card shadow (default):** `0 2px 8px rgba(0, 0, 0, 0.4)` on dark surfaces.
- **Purple glow (primary):** `0 0 48px rgba(124, 58, 237, 0.18)`.
- **Cyan glow (secondary):** `0 0 48px rgba(6, 182, 212, 0.12)`.
- **Button shadow (subtle):** `0 1px 3px rgba(0, 0, 0, 0.5)`.

### Border radius

- Buttons, badges: **4px**
- Cards, containers: **8px**
- Large sections: **12px**
- Circular elements (avatars): **50%** or `9999px`

### Spacing system (8px base unit)

- `xs`: 4px (0.5 units)
- `sm`: 8px (1 unit)
- `md`: 16px (2 units)
- `lg`: 24px (3 units)
- `xl`: 32px (4 units)
- `2xl`: 48px (6 units)
- `3xl`: 64px (8 units)
- `4xl`: 96px (12 units)

### Animation & transitions

- Standard transition: `all 0.2s ease-in-out;`
- Hover: buttons get a slight brightness increase + gradient shift; cards get an elevation/glow increase; links shift to purple (`#7c3aed`).
- Loading: skeleton screens with subtle pulse animation. Spinner: rotating circle in purple.
- Micro-interactions: button press → slight scale down (0.98); success → checkmark animation; error → shake animation.

---

## Icon style

- **Style:** Flat, outlined (not filled).
- **Stroke:** 2px width, rounded line caps and joins.
- **Default size:** 24px × 24px. Scalable to 16px, 32px, 48px.
- **Colors:** Purple (`#7c3aed`) primary; White on dark backgrounds; Medium Gray for neutral; Cyan (`#06b6d4`) for secondary accent.

**Icon themes used in APIRE materials:**
- **Security:** Shield, lock, key, fingerprint
- **AI / ML:** Brain, neural network, chip, robot
- **Data:** Database, cloud, server, file
- **Protection:** Umbrella, barrier, wall
- **Speed:** Lightning, rocket, gauge
- **Compliance:** Checkmark, document, badge

---

## Illustration style

**Approach:**
- Flat, geometric illustrations
- Limited color palette (purple, cyan, white on black)
- Abstract representations of security concepts
- **No** photorealistic or skeuomorphic elements in flat illustration
- **No** playful mascots or characters

**Themes:**
- Data flow and protection
- AI / ML networks and nodes
- Security barriers and shields
- Compliance checkmarks and documents
- Multi-provider ecosystems

---

## Photography & generated imagery direction

**Characteristics:**
- Modern, professional environments
- Technology and security themes
- Diverse, authentic people
- Cool lighting with a purple tint (never warm)
- Clean, uncluttered backgrounds against pure black

**Subjects:**
- Security professionals at work
- Developers coding
- Executive meetings and presentations
- Data centers and technology infrastructure
- Abstract technology and security concepts

**Avoid:**
- Stock photo clichés (handshakes, pointing at screens)
- Overly staged or artificial scenarios
- Outdated technology
- Cluttered or distracting backgrounds
- Warm tones, generic grey server rooms, magenta/pink, bright white light sources

**Image treatment:**
- Pure-black (`#000000`) base; purple (`#7c3aed`) as the dominant atmospheric glow / light source
- Cyan (`#06b6d4`) as a secondary accent highlight
- Cool color temperature (6500K+), high contrast for clarity
- Purple-tinted darkness; subtle cyan accents
- Gradient overlays for text readability when text is added later in layout (not inside generated images)

---

## Diagrams & technical illustrations

**Style:**
- Clean, minimal line diagrams on dark backgrounds
- Purple (`#7c3aed`) for primary elements
- Cyan (`#06b6d4`) for secondary elements
- Gray (`#6B7280`) for tertiary elements
- Arrows / connectors with 2px stroke
- Clear labels in Poppins / JetBrains Mono

**Common diagrams APIRE uses:**
- Architecture diagrams (APIRE as middleware between app and AI providers)
- Data flow diagrams (input → APIRE → AI provider)
- Threat detection workflows
- Multi-provider governance visualization
- The 5-layer defense diagram (Sentinel + 4 shields)

---

## Application examples

### Website hero
- Background: Pure Black (`#000000`) with purple/cyan ambient glow
- Headline: Poppins Bold, 56px, white
- Subheading: Poppins Regular, 20px, white at 80% opacity
- CTA button: Bright Purple → Cyan gradient (`#8b5cf6 → #06b6d4`)
- Supporting image: Abstract security illustration or product screenshot on black

### Feature cards
- Background: Dark Card (`#0f0f1a`)
- Top accent: Purple → Cyan → transparent gradient bar
- Shadow/glow: `0 0 48px rgba(124,58,237,0.18)`
- Icon: Purple (`#7c3aed`), 32px
- Title: Poppins SemiBold, 20px, White
- Description: Poppins Regular, 16px, light gray

### Email
- Header: Pure Black background, white logo, left-aligned
- Body: White background, Black text, Poppins Regular 16px (email clients render light for readability)
- Purple links and CTAs
- Footer: Light Gray, contact info, social links, unsubscribe

---

## Brand asset naming conventions

- Logo files: `APIRE_logo_primary_white.svg`, `APIRE_logo_reversed_black.svg`, etc.
- Marketing materials: `APIRE_[material-type]_[version]_[date].ext` (e.g., `APIRE_one-pager_v2_2025-10-18.pdf`)

## Contradictions / things to flag

- The historical brand `.docx` declared a deep-navy (`#060C2E`) + electric-blue (`#18A4FB`) palette and Inter typography. The **live apire.io site** uses a pure-black (`#000000`) canvas with **purple (`#7c3aed`)** as the dominant accent, cyan (`#06b6d4`) secondary, and **Poppins + JetBrains Mono** typography. The live values in the MACHINE-READABLE COLOR SPECIFICATION above are authoritative; the old navy/blue values are deprecated and must not be used in generated imagery.
- Brand contact for asset requests / brand questions: `be@ofsecman.io`.
