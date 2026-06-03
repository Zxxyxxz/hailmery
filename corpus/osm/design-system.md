---
name: v13-3d-design
description: Strict execution rules for designing and generating new HTML pages that match the premium V13 3D Enterprise aesthetic. Derived from deep visual + code analysis of the live OSM homepage at localhost:8787.
---

# V13 3D Enterprise — Master Design System

> [!WARNING]
> DO NOT generate basic Tailwind cards, flat layouts, or plain grids. Every page must match the premium visual signature of the OSM homepage: **deep cosmic black, animated hexagonal 3D data sources, floating agent cards, glassmorphic bento panels, pulsing accent halos, and intelligent Z-pattern deep dives**. You MUST read this entire document before generating a single line of HTML.

---

## MANDATORY: Pre-Generation Checklist

Before writing any HTML, always:
1. Read `Website/Design Principles/osm_design_system.md` — color tokens, type scale, component classes
2. Open `Website/Homepage/Active/how_osm_works.html` as the canonical HTML template for V13 bento cards  
3. Open `Website/Homepage/Active/osm_agents.html` for the agent card + hexagonal data-source pattern
4. Open `Website/Homepage/Active/osm_advantage.html` for the full-width horizontal advantage row pattern
5. Open `Website/Homepage/Active/extensive_visibility.html` for the central orb + radial connection layout

---

## 1. Typography System

### Font Stack
```html
<!-- Always inject BOTH preload and noscript fallback -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload"
      href="https://fonts.googleapis.com/css2?family=Questrial&family=JetBrains+Mono:wght@400;600;700&display=swap"
      as="style"
      onload="this.onload=null;this.rel='stylesheet'">
<noscript>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Questrial&family=JetBrains+Mono:wght@400;600;700&display=swap">
</noscript>
```

### Rules
- **ALL headings and body copy**: `font-family: 'Questrial', -apple-system, system-ui, sans-serif`
- **ALL tags, eyebrows, KPIs, data labels, badges**: `font-family: 'JetBrains Mono', monospace`
- **NEVER** use system default fonts — Questrial must load for the premium look
- Always add: `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;`

### Type Scale (verified from homepage)
| Element | Font | Size | Weight | Letter-spacing |
|---------|------|------|--------|----------------|
| Hero title (main) | Questrial | `clamp(3rem, 8vw, 6.5rem)` | 700 | `-0.03em` |
| Hero title (gradient) | Questrial | same | 700 | `-0.03em` — with cyan→purple→magenta gradient |
| Section heading | Questrial | `clamp(2.4rem, 5vw, 4rem)` | 700 | `-0.02em` |
| Card title | Questrial | `1.1rem–1.35rem` | 400 | normal |
| Card description | Questrial | `0.82rem–0.95rem` | 400 | normal |
| Eyebrow label | JetBrains Mono | `0.62rem–0.7rem` | 700 | `0.14em–0.22em` uppercase |
| Advantage row category | JetBrains Mono | `0.68rem` | 700 | `0.18em` uppercase |  
| Tag pill | JetBrains Mono | `0.7rem` | 700 | `0.12em` uppercase |
| KPI value | Questrial | `3rem–4rem` | 400 | normal — with accent gradient text |
| KPI label | Questrial | `0.8rem` | 400 | normal, color `#9CA3AF` |
| Stat numbers in cards | Questrial | `1.8rem–2.5rem` | 400 | normal, accent color |
| Stat label | JetBrains Mono | `0.65rem` | 700 | `0.1em` uppercase, muted |

---

## 2. Color System

### Foundation
```css
/* Page background — Cloudflare/standalone (NOT Wix embed) */
background: #000000;
color: #ffffff;

/* Card surface */
background: linear-gradient(155deg, rgba(14,14,26,0.95), rgba(8,8,20,0.98));
border: 1px solid rgba(255,255,255,0.07);
```

### Brand Gradient (ALWAYS use Cyan → Purple → Magenta)
```css
/* Hero heading gradient — the signature OSM gradient */
background: linear-gradient(135deg, #22D3EE 0%, #C084FC 45%, #F472B6 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
background-clip: text;

/* Animated version for hero accents */
background-size: 200% 200%;
animation: grad-shift 6s ease infinite;
@keyframes grad-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
```

### Semantic Color Map (assign one accent per section/component)
| Accent | Hex | Use Case |
|--------|-----|----------|
| Cyan | `#22d3ee` / `#06B6D4` / `#0ea5e9` | Telemetry, scanning, network, primary |
| Purple | `#a855f7` / `#C084FC` | AI, brain, reasoning, knowledge store |
| Magenta/Pink | `#F472B6` / `#c026d3` | Analytics, hero gradient terminus |
| Emerald | `#10B981` / `#34d399` | Defense, compliance, proactive |
| Sky Blue | `#38bdf8` | Governance, reporting |
| Amber | `#F59E0B` / `#fbbf24` | Container, source code |
| Red | `#EF4444` / `#f87171` | Critical risk, alerts |
| Lime | `#84CC16` | Visibility, coverage |
| Orange | `#fb923c` | Stakeholder output |

### CSS Custom Property Pattern
```css
/* Always pass accent as CSS var with RGB triplet for rgba() flexibility */
style="--accent: 34,211,238;"  /* cyan */
style="--accent: 168,85,247;"  /* purple */

/* Usage */
border-color: rgba(var(--accent), 0.5);
box-shadow: 0 0 40px rgba(var(--accent), 0.15);
background: rgba(var(--accent), 0.07);
color: rgb(var(--accent));
```

---

## 3. The 9 Section Types — Templates

You MUST choose from these 9 section types. Do not invent new patterns.

### 3.1 Hero Section (Full Viewport Height)
The hero always features:
- A large two-line heading: **line 1 = white,  line 2 = animated cyan→purple→magenta gradient**
- Below the heading: a horizontal row of **floating agent cards** (mini glassmorphic cards with Lucide icons and names)
- Below agents: an **"AGENTS POWERED BY ⬙ CORE"** connector strip
- Below that: a **central AI orb** (glowing sphere, cyan/purple radial gradient, brain icon, `OSM AI` label)
- Below that: a **"CORE FUELED BY ⬙ DATA"** connector strip
- Below that: a row of **4 hexagonal data sources** (Security Data, Security Context, Realtime Risk Data, Asset Composition)

```html
<!-- Hero structure skeleton -->
<section class="hero">
  <div class="hero-heading">
    <h1>Your Virtual</h1>
    <h1 class="gradient-text">AI Powered Security Team</h1>
  </div>
  <div class="agent-row"><!-- 7 agent mini-cards --></div>
  <div class="connector-strip">AGENTS POWERED BY ⬙ CORE</div>
  <div class="osm-ai-orb"><!-- brain icon, glow, orbit rings --></div>
  <div class="connector-strip">CORE FUELED BY ⬙ DATA</div>
  <div class="data-source-row"><!-- 4 hexagonal prisms --></div>
</section>
```

### 3.2 Bento 2-Column Grid (How OSM Works)
- Section heading: monochrome word + COLOR word + monochrome word (e.g., "How **OSM** Works")
- Two cards side by side, each with: orb icon container, card number (01/02/03...), title, description paragraph, tag pill
- Left card: cyan accent. Right card: purple accent
- Cards have L-shaped **corner reticles** (top-left / bottom-right) visible on hover
- Card has `02` numbering in top-right corner (`font: JetBrains Mono 0.65rem, opacity:0.4`)
- **Mouse-tracking 3D tilt** (see Section 5.3)

```css
/* Corner reticle (always present, transition opacity on hover) */
.card-corner-tl,
.card-corner-br {
  position: absolute; width: 12px; height: 12px;
  border-color: var(--accent); border-style: solid; opacity: 0;
  transition: opacity 0.3s;
}
.card-corner-tl { top: 12px; left: 12px; border-width: 1.5px 0 0 1.5px; }
.card-corner-br { bottom: 12px; right: 12px; border-width: 0 1.5px 1.5px 0; }
.card:hover .card-corner-tl,
.card:hover .card-corner-br { opacity: 1; }
```

### 3.3 4-Column KPI Strip
- A single horizontal glassmorphic strip: `border: 1px solid rgba(255,255,255,0.07); border-radius: 18px;`
- 4 KPI items separated by thin vertical dividers
- Each item: large number (Questrial, `3.5rem`, gradient text) + label below (Questrial, `0.82rem`, `#9CA3AF`)
- Numbers use the animated brand gradient

```css
.kpi-strip {
  display: flex; align-items: center; justify-content: space-around;
  padding: 40px 48px;
  background: linear-gradient(155deg, rgba(14,14,26,0.9), rgba(8,8,20,0.95));
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 18px;
  max-width: 960px; margin: 0 auto;
}
.kpi-divider {
  width: 1px; height: 52px; align-self: center;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.08), transparent);
}
```

### 3.4 "Why OSM?" / Advantage Cards Grid (Z-Pattern with Central Orb)
- Large section heading centered
- Two columns of feature cards flanking a central animated **OSM orb** (the hub)
- Cards have: colored icon square, **dual-line eyebrow** (category / feature name), H-tag title, `VS [ALTERNATIVE]` comparison badge, description, metric stats (two rows)
- **Cyan metric numbers** for the primary stat (`2rem`, Questrial), `#6B7280` for secondary
- Cards have a thin top accent bar (2px, gradient from accent to transparent)
- Category text uses JetBrains Mono uppercase tracking `0.18em`

### 3.5 "The OSM Advantage" Full-Width Row Cards
- Section heading appears once centered
- Cards are **full-width horizontal**: flex row, icon on left, then content block
- Icon: `44px` rounded square, accent-colored
- Structure per card: `[num] / [CATEGORY]` eyebrow → `H3 title` → `VS [ALTERNATIVE]` badge → `description` → two `[STAT] / [LABEL]` metric pairs → multi-label tag strip
- Cards stack vertically with `margin-bottom: 16px`
- Left accent: `3px` colored top border extends full card width

### 3.6 Hexagonal Data Source Prisms
Used to represent ingested data types. Always 3D hexagonal:
```css
.hex {
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  background: linear-gradient(135deg, rgba(ACCENT,0.3), rgba(ACCENT,0.08));
  border: 1.5px solid rgba(ACCENT, 0.6);
  filter: drop-shadow(0 0 15px rgba(ACCENT, 0.35));
}
/* 3D depth via pseudo-element left & right faces */
.hex::before { /* right face — rotateY(90deg) translateX(50%) */ }
.hex::after  { /* left face — rotateY(-90deg) translateX(-50%) */ }
/* Animated scanline inside */
.hex-scanline { animation: scan-v 3s linear infinite; }
/* Ground glow projector */
.hex-ground-glow { radial-gradient at bottom } 
```

### 3.7 Agent Mini-Cards (Hero floating row)
7 floating agent cards, each:
- `width: 140px–160px`, `border-radius: 14px`, `padding: 16px`
- Icon: `40px` circle, accent color, glow
- Name: Questrial `0.78rem`
- 3D depth bar at the top (3-4px) with unique gradient per agent
- Subtle bottom shadow glow
- Slight hover `translateY(-6px)` lift with `cubic-bezier(0.34,1.56,0.64,1)`

### 3.8 Deep Dive Feature Rows (Z-Pattern alternating)
2- or 3-column rows where text alternates left/right with a visual element (terminal, orb, diagram):
- Text side: eyebrow → H3 title → description → bullet list with check-icon
- Visual side: glassmorphic mock-terminal, data visualization, or animated diagram
- Alternate direction: row 1 = text-left/visual-right, row 2 = visual-left/text-right
- **Mock Terminal Pattern**: macOS dots (`●●●`), cyan `font-family: JetBrains Mono` output lines, `>` prompt prefix

### 3.9 Unified Cyber Intelligence / Integration Grid
- Dense grid of 3–4 columns
- Each cell is a compact card: icon, title, description, integration tags
- Uses `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px`
- No orbs or 3D elements — flatter data-rich format

---

## 4. Component CSS Reference

### 4.1 Glassmorphic Card (universal)
```css
.card {
  background: linear-gradient(155deg, rgba(14,14,26,0.95), rgba(8,8,20,0.98));
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 18px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 28px 56px rgba(0,0,0,0.6),
    0 8px 16px rgba(0,0,0,0.45);
  position: relative;
  overflow: hidden;
  transition: border-color 0.3s, box-shadow 0.3s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1);
}
.card:hover {
  border-color: rgba(var(--accent), 0.35);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 0 0 1px rgba(var(--accent), 0.2),
    0 36px 72px rgba(0,0,0,0.7),
    0 0 60px rgba(var(--accent), 0.12);
  transform: translateY(-4px);
}
```

### 4.2 Gloss Sweep (on every premium card)
```css
.card::before {
  content: '';
  position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent);
  transform: skewX(-15deg);
  animation: gloss-sweep 9s ease-in-out infinite;
  pointer-events: none;
}
@keyframes gloss-sweep {
  0%, 100% { left: -120%; }
  55% { left: 160%; }
}
```

### 4.3 Accent Top Bar (on every card)
```css
.card-top-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, rgba(var(--accent),0.9), rgba(var(--accent),0.2), transparent);
  border-radius: 18px 18px 0 0;
  transition: height 0.3s;
}
.card:hover .card-top-bar { height: 3px; }
```

### 4.4 Eyebrow / Section Badge
```css
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 14px; border-radius: 999px;
  border: 1px solid rgba(var(--accent), 0.3);
  background: rgba(var(--accent), 0.07);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: rgb(var(--accent));
}
.eyebrow-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgb(var(--accent));
  box-shadow: 0 0 8px rgba(var(--accent), 0.9);
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.75); }
}
```

### 4.5 Circle Orb Icon Container
```css
.icon-orb {
  width: 80px; height: 80px; border-radius: 50%;
  background: radial-gradient(circle at 33% 33%,
    rgba(var(--accent), 0.5),
    rgba(var(--accent), 0.15) 50%,
    rgba(var(--accent), 0.03) 100%);
  border: 1.5px solid rgba(var(--accent), 0.5);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.2),
    0 0 30px rgba(var(--accent), 0.3);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
/* Dashed orbit ring (appears on hover) */
.icon-orb::after {
  content: ''; position: absolute;
  width: calc(100% + 20px); height: calc(100% + 20px);
  border-radius: 50%;
  border: 1px dashed rgba(var(--accent), 0.3);
  transform: rotate(0deg);
  transition: opacity 0.3s;
  opacity: 0;
  animation: orbit-spin 8s linear infinite;
}
.card:hover .icon-orb::after { opacity: 1; }
@keyframes orbit-spin { to { transform: rotate(360deg); } }
```

### 4.6 Tag Pill
```css
.tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 999px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: rgb(var(--accent));
  border: 1px solid rgba(var(--accent), 0.25);
  background: rgba(var(--accent), 0.07);
}
.tag-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
}
```

### 4.7 VS Comparison Badge
```css
.vs-badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #9CA3AF;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
}
```

### 4.8 Section Heading (Word-by-Word Gradient)
Applied to section titles exactly as seen on the homepage: **"How OSM Works"** — neutral, colored, neutral.
```html
<h2 class="section-heading">
  How <span class="heading-accent">OSM</span> Works
</h2>
```
```css
.heading-accent {
  background: linear-gradient(135deg, #22D3EE, #C084FC, #F472B6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

## 5. Animation Architecture

### 5.1 Core Keyframes Library (always include all of these)
```css
@keyframes gloss-sweep {
  0%, 100% { left: -120%; }
  55% { left: 160%; }
}
@keyframes orbit-spin { to { transform: rotate(360deg); } }
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.75); }
}
@keyframes core-pulse {
  0%, 100% { box-shadow: 0 0 60px rgba(168,85,247,0.3), 0 0 120px rgba(6,182,212,0.15); }
  50% { box-shadow: 0 0 80px rgba(168,85,247,0.5), 0 0 160px rgba(6,182,212,0.25); }
}
@keyframes float-idle {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}
@keyframes grad-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes scanline-v {
  0% { top: 0%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
```

### 5.2 IntersectionObserver Entrance Reveals (REQUIRED)
All sections must be invisible on load and reveal on scroll:
```javascript
const io = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      e.target.style.transitionDelay = (i * 0.12) + 's';
      e.target.style.transition = 'opacity 0.9s cubic-bezier(0.22,1,0.36,1), transform 0.9s cubic-bezier(0.22,1,0.36,1)';
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(48px)';
  io.observe(el);
});
```

### 5.3 Mouse-Tracking 3D Tilt (on Bento Cards)
```javascript
document.querySelectorAll('.card-3d').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 10}deg) scale3d(1.03,1.03,1.03) translateZ(10px)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transition = 'transform 0.65s cubic-bezier(0.34,1.56,0.64,1)';
    card.style.transform = '';
    setTimeout(() => card.style.transition = '', 650);
  });
});
```

### 5.4 Standard Hover Easing
```css
/* Card lift */
transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);

/* Color/shadow changes */
transition: border-color 0.3s ease, box-shadow 0.3s ease;

/* Icon glow */
transition: box-shadow 0.3s ease, filter 0.3s ease;
```

### 5.5 Performance Requirements (non-negotiable)
```javascript
// Pause when tab hidden
document.addEventListener('visibilitychange', () => {
  document.body.style.animationPlayState =
    document.hidden ? 'paused' : 'running';
});

// Canvas throttle
const FRAME_MS = 1000 / 24; // 24 fps cap
let lastFrameTs = 0;
function draw(ts) {
  if (ts - lastFrameTs < FRAME_MS) { requestAnimationFrame(draw); return; }
  lastFrameTs = ts;
  // ... draw logic
  requestAnimationFrame(draw);
}
```

Must include on heavy animated elements:
```css
will-change: transform;
backface-visibility: hidden;
transform-style: preserve-3d;
```

---

## 6. Page-Level Layout Rules

### Spacing System
```css
/* Container */
max-width: 1280px; /* sections */
max-width: 960px;  /* content (text-heavy sections) */
margin: 0 auto; padding: 0 32px;

/* Section vertical rhythm */
padding-top: 96px; padding-bottom: 96px;

/* Card gaps */
gap: 20px–24px; /* bento grid */
gap: 16px;       /* advantage cards */
gap: 32px;       /* deep dive rows */
```

### Grid Templates
```css
/* Bento 2-col */
display: grid; grid-template-columns: 1fr 1fr; gap: 20px;

/* 3-col integration grid */
display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;

/* Full-width advantage rows */
display: flex; flex-direction: column; gap: 16px;

/* Z-pattern deep dive */
display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;
```

### Ambient Background Glow (per section)
Each major section has a colored ambient blob in one corner:
```css
.section-glow {
  position: absolute; border-radius: 50%; pointer-events: none;
  filter: blur(80px); opacity: 0.12;
}
.section-glow-tl {
  top: -100px; left: -100px;
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(34,211,238,0.4), transparent 70%);
}
.section-glow-br {
  bottom: -100px; right: -100px;
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(168,85,247,0.4), transparent 70%);
}
```

---

## 7. Responsive Rules

| Breakpoint | Changes |
|------------|---------|
| `1024px` | Grid → 2 col, reduce hero font size |
| `768px` | Grid → 1 col, stack all rows, simplify orb |
| `640px` | Disable 3D transforms, hide orbit rings, reduce section padding |
| `480px` | Minimize all decorative elements, font-size reductions |

```css
@media (max-width: 768px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
  .z-pattern { grid-template-columns: 1fr; }
  .orbit-ring, .depth-face, .ground-projector { display: none; }
}
@media (max-width: 640px) {
  * { animation: none !important; }
  .card-3d { transform: none !important; }
}
```

---

## 8. Cloudflare Architecture Rules

These pages run natively on Cloudflare Workers (NOT Wix embeds):
1. `html, body { background: #000000; color: #fff; }` — solid black, never transparent
2. Navigation is provided by the shared Cloudflare layout shell — do NOT include `<nav>` or `<footer>` in page HTML
3. `overflow-x: hidden` on body to prevent horizontal scroll from animated elements overshooting
4. No GSAP dependency required — use IntersectionObserver exclusively
5. Images must use `/assets/` paths relative to the Cloudflare static asset root
6. Each page is a **partial HTML fragment** assembled by `node scripts/build.js` into `dist/`
7. Source files live in `Website/[Category] Pages/[filename].html`

---

## 9. Messaging Architecture (from AI Training Docs)

When writing copy for any OSM page, apply these narrative frameworks:

### The 5 Core Messages (never deviate)
1. **The 2026 Emergency**: "Cybersecurity is now a Big Data problem. 40,000+ new CVEs/year. You cannot process this manually."
2. **The 48-Hour Survival Window**: "After an exploit drops, you have 48 hours before breach. Weekly scans = defenseless."
3. **Fight AI with Autonomous AI**: "Your enemy is an AI engine at machine speed. You need an AISecOps Autonomous Workforce."
4. **The Collision Sensor**: "OSM is not a scanner. It is your autonomous collision sensor — anticipating threats before impact."
5. **Actionable Wisdom**: "OSM distills 40,000 CVEs into a handful of Priority Actions. Not noise — wisdom."

### Copy Tone Rules
- **Bold, assertive statements** — Not "may help with" but "eradicates"
- **Attacker's perspective** — Describe the adversary first, then OSM's counter
- **Quantify everything** — `94% noise reduction`, `80% faster`, `48 hours`, `26,000+ CVEs`
- **"VS" framing** — Every feature card should include a `VS [ALTERNATIVE]` comparison badge
- **Eyebrow = verb** — `PREDICTIVE THREAT DETECTION`, `AUTOMATED REMEDIATION`, not just `FEATURES`

---

## 10. Design Principles Summary (the 10 Laws)

1. **Dark-Void Canvas**: Every page starts from absolute black — cards float in a dark cosmos
2. **One Accent Per Component**: Single accent color per card/section — never mix two accent colors in one card
3. **Gradient Text for Impact**: Hero headings and KPI numbers always use `cyan→purple→magenta` gradient text
4. **Motion = Meaning**: Every animation communicates something — a pulsing dot = live data, an orbit ring = connectivity, a scanline = active analysis
5. **Progressive 3D Depth**: Cards have top bar + corner reticles + ground glow + gloss sweep — physical presence, not flat graphics
6. **VS Framing**: Always contrast OSM against a named alternative to sharpen value propositions
7. **Section Badge Eyebrow**: Every section starts with a pill-shaped JetBrains Mono eyebrow label with pulsing dot
8. **IntersectionObserver Reveals**: Nothing renders visible on initial load — all content enters from `translateY(48px) opacity:0`
9. **Typography Duality**: Questrial for humanity and readability, JetBrains Mono for machine-data — the contrast signals "AI interpreted for humans"
10. **Performance as a Feature**: 24fps canvas cap, tab-visibility pausing, `will-change` on transforms — 60fps must be maintained even on complex pages
