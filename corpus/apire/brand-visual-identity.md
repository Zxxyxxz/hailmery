# Brand Visual Identity — Logo, Colors, Typography, Design System

**What this file contains:** APIRE's complete visual design system — exact hex codes, font family, logo rules, spacing/border/shadow tokens, icon style guidance, photography direction. Use this for any generated content that includes image prompts, design briefs, or visual references.

**Sources:**
- `APIRE - Brand Guidelines & Visual Identity.docx` (primary)
- `APIRE - Complete Brand Context Document.docx`

---

## Logo

**Primary logo:** White "APIRE" text in all caps, clean modern sans-serif typeface. Typically displayed on dark blue background (#060C2E).

**Logo variations:**
- **Primary:** White on dark blue
- **Reversed:** Dark blue on white
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
- Add effects (shadows, glows, gradients) to the logo
- Place on busy backgrounds that reduce legibility
- Recreate or modify the logo typeface

---

## Color palette

### Primary colors

| Role | Name | Hex | RGB | Meaning / Usage |
|---|---|---|---|---|
| Primary background | **Deep Blue** | `#060C2E` | 6, 12, 46 | Trust, security, professionalism, depth. Headers, navigation, main CTAs, hero sections. |
| Primary text / logo | **White** | `#FFFFFF` | 255, 255, 255 | Clarity, simplicity, transparency. Text on dark backgrounds, logo on dark, clean space. |

### Accent colors

| Role | Name | Hex | RGB | Meaning / Usage |
|---|---|---|---|---|
| Primary accent | **Bright Blue** | `#18A4FB` | 24, 164, 251 | Innovation, technology, action, energy. CTAs, links, highlights, interactive elements, icons. |
| Secondary accent | **Light Blue** | `#60CFFF` | 96, 207, 255 | Approachability, clarity, modern tech. Gradients, hover states, secondary highlights. |

### Supporting colors

| Role | Name | Hex | RGB | Usage |
|---|---|---|---|---|
| Background | **Light Gray** | `#F5F6FA` | 245, 246, 250 | Section backgrounds, cards, subtle separation. |
| Body text | **Black** | `#000000` | 0, 0, 0 | Body text on light backgrounds, high-contrast elements. |
| Secondary text | **Medium Gray** | `#6B7280` | 107, 114, 128 | Secondary text, captions, metadata. |

### Semantic colors

| State | Hex | Usage |
|---|---|---|
| Success Green | `#10B981` | Success messages, positive metrics, "threat blocked" indicators |
| Warning Orange | `#F59E0B` | Warnings, medium-priority alerts |
| Error Red | `#EF4444` | Errors, critical alerts, high-priority threats |
| Info Blue | `#3B82F6` | Informational messages, tips, guidance |

### Gradients

- **Primary gradient (CTAs & highlights):** `#18A4FB → #60CFFF`, direction 135deg (diagonal) or 90deg (vertical). Use for primary buttons, featured sections.
- **Background gradient (hero sections):** `#060C2E → #0A1854`, direction 180deg (top to bottom).

### Color combinations

- **High contrast (primary):** Deep Blue (`#060C2E`) + White (`#FFFFFF`). Use for headers, navigation, hero sections.
- **Accent combination:** Bright Blue (`#18A4FB`) + Deep Blue (`#060C2E`). Use for CTAs, interactive elements.
- **Light theme:** White (`#FFFFFF`) + Black (`#000000`) + Light Gray (`#F5F6FA`). Use for content areas, documentation, forms.

### Accessibility (WCAG AA verified)

- Deep Blue on White: **15.8 : 1** ✅
- White on Deep Blue: **15.8 : 1** ✅
- Bright Blue on Deep Blue: **4.8 : 1** ✅
- Black on White: **21 : 1** ✅
- Medium Gray on White: **4.6 : 1** ✅

All primary color combinations meet WCAG AA (4.5 : 1 for normal text, 3 : 1 for large text).

---

## Typography

### Primary typeface: **Inter**

- **Family:** Inter
- **Designer:** Rasmus Andersson
- **Classification:** Geometric sans-serif
- **License:** Open Font License (free for commercial use)

**Why Inter:**
- Optimized for screen readability
- Excellent legibility at all sizes
- Modern, neutral, professional
- Wide language support
- Variable font technology for precise weight control

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
| Caption | 12px | Regular or Medium | 1.4 | 0.01em |

### Web font stack (fallback)

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
```

### Print / Office

- Primary: Inter
- Fallback: Arial, Helvetica

### Code typography

- **Monospace font:** JetBrains Mono or Fira Code
- Sizes: 14–16px
- Background: Light gray (`#F5F6FA`) or Deep Blue (`#060C2E`)

### Typography best practices

DO:
- Use Inter for all brand communications
- Maintain consistent hierarchy
- Use appropriate line heights (1.5–1.6 for body)
- Limit to 2–3 font weights per design
- Ensure sufficient contrast for readability

DON'T:
- Mix Inter with other typefaces (except code fonts)
- Use too many font weights in one design
- Set body text below 14px
- Use tight line heights (<1.4) for body text
- Use all caps for long-form content

---

## Visual style and design elements

### Design philosophy

APIRE's visual style is **modern, minimal, and security-focused**. Prioritize clarity over decoration. Clean layouts, ample white space, purposeful design elements that reinforce *security without friction*.

### Key visual characteristics

1. **Clean, minimal layouts** — ample padding and white space, clear visual hierarchy, grid-based alignment.
2. **Dark-to-light contrast** — heavy use of deep blue backgrounds with white space for breathing room.
3. **Flat, modern iconography** — flat, monotone SVG icons; blue accents (`#18A4FB`); 2px stroke; rounded corners (2–4px).
4. **Subtle depth** — minimal use of shadows, soft drop-shadows on cards, elevation through layering rather than heavy shadows.

### Shadows

- **Card shadow (default):** `0 2px 8px rgba(0, 0, 0, 0.1)`
- **Card shadow (hover):** `0 4px 16px rgba(0, 0, 0, 0.15)`
- **Button shadow (subtle):** `0 1px 3px rgba(0, 0, 0, 0.12)`
- **Modal / overlay shadow:** `0 8px 32px rgba(0, 0, 0, 0.2)`

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
- Hover: buttons get slight brightness increase + gradient shift; cards get elevation increase (shadow); links shift to bright blue (`#18A4FB`).
- Loading: skeleton screens with subtle pulse animation. Spinner: rotating circle in bright blue.
- Micro-interactions: button press → slight scale down (0.98); success → checkmark animation; error → shake animation.

---

## Icon style

- **Style:** Flat, outlined (not filled).
- **Stroke:** 2px width, rounded line caps and joins.
- **Default size:** 24px × 24px. Scalable to 16px, 32px, 48px.
- **Colors:** Bright Blue (`#18A4FB`) primary; White on dark backgrounds; Medium Gray for neutral; semantic colors for state.

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
- Limited color palette (blues, white, gray)
- Abstract representations of security concepts
- **No** photorealistic or skeuomorphic elements
- **No** playful mascots or characters

**Themes:**
- Data flow and protection
- AI / ML networks and nodes
- Security barriers and shields
- Compliance checkmarks and documents
- Multi-provider ecosystems

---

## Photography direction

**Characteristics:**
- Modern, professional environments
- Technology and security themes
- Diverse, authentic people
- Natural lighting with slight blue tint
- Clean, uncluttered backgrounds

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

**Image treatment:**
- Slight blue tint to align with brand colors
- High contrast for clarity
- Desaturate slightly for professional look
- Dark blue (`#060C2E`) overlay at 60–80% opacity for hero sections
- Gradient overlays for text readability

---

## Diagrams & technical illustrations

**Style:**
- Clean, minimal line diagrams
- Blue (`#18A4FB`) for primary elements
- Gray (`#6B7280`) for secondary elements
- Arrows / connectors with 2px stroke
- Clear labels in Inter

**Common diagrams APIRE uses:**
- Architecture diagrams (APIRE as middleware between app and AI providers)
- Data flow diagrams (input → APIRE → AI provider)
- Threat detection workflows
- Multi-provider governance visualization
- The 5-layer defense diagram (Sentinel + 4 shields)

---

## Application examples

### Website hero
- Background: Deep Blue (`#060C2E`) with subtle gradient
- Headline: Inter Bold, 56px, white
- Subheading: Inter Regular, 20px, white at 80% opacity
- CTA button: Bright Blue → Light Blue gradient
- Supporting image: Abstract security illustration or product screenshot

### Feature cards
- Background: White (`#FFFFFF`)
- Border: None or 1px Light Gray
- Shadow: `0 2px 8px rgba(0,0,0,0.1)`
- Icon: Bright Blue (`#18A4FB`), 32px
- Title: Inter SemiBold, 20px, Black
- Description: Inter Regular, 16px, Medium Gray

### Email
- Header: Deep Blue background, white logo, left-aligned
- Body: White background, Black text, Inter Regular 16px
- Blue links and CTAs
- Footer: Light Gray, contact info, social links, unsubscribe

---

## Brand asset naming conventions

- Logo files: `APIRE_logo_primary_white.svg`, `APIRE_logo_reversed_blue.svg`, etc.
- Marketing materials: `APIRE_[material-type]_[version]_[date].ext` (e.g., `APIRE_one-pager_v2_2025-10-18.pdf`)

## Contradictions / things to flag

- None significant. Visual identity is well-locked in source material.
- Brand contact for asset requests / brand questions: `be@ofsecman.io`.
