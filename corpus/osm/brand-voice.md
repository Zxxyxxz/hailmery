# OSM — Brand Voice, Tone & Messaging Principles

**What this file contains:** OSM's voice characteristics, tone by context, preferred/avoided terms, messaging principles, and persona hooks. **Every generated OSM piece should match this voice.** Derived from the consistent rhetorical patterns across all 20 OSM source documents.

**Sources:** all 20 OSM source documents; voice is most pronounced in the sales playbooks, the 2026 benefits one-pager, and the beginner guides.

> **Caveat:** OSM did not ship a formal brand-guidelines document like APIRE did. This voice profile is inferred from the source corpus. Treat it as a working standard, not a published style guide — refine with the OSM owner.

---

## The voice in one line

**Urgent, authoritative, and analogy-driven** — OSM sells a paradigm shift ("you can only defend against AI with AI") using vivid, concrete metaphors (the **collision sensor**, the **virtual security team**) backed by hard numbers.

## The four voice characteristics (use all four, weighted to context)

### 1. Urgent & Consequential
- Lead with the stakes: the 48-hour window, the 270-day remediation gap, the Big Data flood.
- Frame 2026 as a "state of emergency" and a "new mathematical reality."
- Definitive, not tentative: "Organizations relying on periodic scans are defenseless."

### 2. Confident & Authoritative
- Backed by data and named sources (Mandiant M-Trends, Gartner, React2Shell).
- Definitive statements ("OSM triages up to 94% of alert noise" — not "may help reduce alerts").
- **No hedging** ("we believe," "might help," "could possibly").

### 3. Technical but Accessible
- Explain via analogies: the **collision sensor for cyber threats**, the **virtual AI security team**, **digital whack-a-mole**, "a map without a car" (CTEM), continuous MRI vs. periodic X-ray.
- Define technical terms inline (CTEM, SBOM, TTPs, SAST/DAST/IAST).
- Respect technical readers; don't oversimplify architecture content.

### 4. Action-Oriented & Strategic
- Focus on **outcomes and business impact**, not feature lists.
- Strong verbs: predict, prevent, prioritize, neutralize, steer away, outmaneuver.
- Always tie technical capability back to the **People / Money / Complexity** headaches.

---

## Tone variations by context

### Website / Marketing — Confident & Compelling
- "The Collision Sensor for cyber threats."
- "You can only defend against AI with AI."
- "From digital whack-a-mole to Continuous Offensive Security."

### Sales / Enterprise — Strategic & ROI-Focused
- "Hire a tireless AISecOps Autonomous Workforce for a fraction of the cost of a SOC."
- "Replace 83+ disconnected tools with one Executive Command Center."
- "80 days faster breach containment; $1.9M in savings."

### Technical / Documentation — Clear & Instructional
- "OSM AI Memory is a hybrid graph, vector, and time-series database that stores Security Context."
- "Asset Composition Analysis compares a live SBOM against threat intel every 15 minutes."

### Executive / Boardroom — Risk & Governance
- "A single source of truth for enterprise risk, mapped to NIS2 and PCI DSS."
- "Allocate finite resources to the ~2% of exposures that actually threaten the business."

---

## Messaging principles (apply to every piece)

1. **Lead with the stakes, then the solution.** Open on the Big Data problem / 48-hour window, resolve with the AISecOps Autonomous Workforce.
2. **Be specific.** Use the corpus numbers (40,000+ vulns, 270 days, 94% noise, 15-minute cadence) — never "many" or "fast."
3. **Anchor on the three headaches.** People, Money, Complexity — name the pain before pitching.
4. **Use the two core analogies** (collision sensor, virtual AI team) — they are the brand's signature.
5. **Show, don't dump.** The output is the **OSM Issue** (a human-readable action plan), never a list of alerts.

---

## Preferred terms (use these exactly)

| Use | Not |
|---|---|
| **AISecOps Autonomous Workforce** | "AI tool" / "AI feature" |
| **5 Specialized AI Agents** | "the AI" / "our algorithm" |
| **Executive Command Center** | "dashboard" |
| **OSM AI Memory** | "database" / "knowledge base" |
| **Continuous Offensive Security** | "scanning" / "continuous scanning" |
| **Continuous Threat Exposure Management (CTEM)** | "vulnerability management" |
| **OSM Issue** | "alert" / "ticket" / "finding" |
| **Real Risk Score** | "CVSS score" / "risk rating" |
| **Asset Composition Analysis** | "inventory scan" |
| **Priority Actions** | "top alerts" |
| **Vendor-independent** | "agnostic tool" |
| **Collision Sensor (for cyber threats)** | "early-warning system" |

## Words and phrases to avoid

### Generic AI-marketing slop (banned)
- Synergy *(except the specific term "synergy ecosystem" used in source for integration)*, Leverage (as a verb), Paradigm shift, Best-in-class / world-class / industry-leading (without evidence), Revolutionary, Game-changing, Disruptive, Seamless (overused), Next-generation, Cutting-edge.

### Vague generalizations (banned)
- "Many enterprises," "some companies," "most CISOs," "often," "generally." Replace with the corpus statistics.

### Soft / hedging language (avoid)
- "might," "could," "may help," "we believe," "potentially." When uncertain about a fact, omit it.

---

## Messaging by persona — hooks

- **CISO:** "One Executive Command Center for risk — board-ready, business-aligned, vendor-independent."
- **Security Ops Manager:** "An AISecOps Autonomous Workforce that triages 94% of the noise, 24/7."
- **DevSecOps Engineer:** "Continuous Offensive Security in your CI/CD — no velocity tax, two-way Jira sync."
- **Compliance Officer:** "Zero-touch reporting mapped to PCI DSS, NIS2, ISO 27001, PSD2."
- **CFO / IT Director:** "Eliminate per-asset scanning fees; add a 100-analyst AI brain for a fraction of the cost."
- **Government / Military:** "Fully air-gapped on-prem AI — your data never leaves the network."

(Full persona detail in [[personas]].)

---

## Headline patterns that work for OSM

**Stakes + Axiom:**
- "40,000 new vulnerabilities a year. 48 hours to breach. You can only defend against AI with AI."

**Analogy + Position:**
- "Your security needs a collision sensor, not another airbag."
- "Stop playing digital whack-a-mole. Start Continuous Offensive Security."

**Contrast (Old Way → OSM Way):**
- "Scattered tools → one Executive Command Center."
- "270 days to fix → solutions in milliseconds."

**Promise + Proof:**
- "Hire a Virtual AI Security Team. 5 specialized agents. 24/7. A fraction of the cost."

---

## Proof points to cite (recurring)

- **40,000+** new vulnerabilities/year, **+30%** YoY; **~8,000** critical; **3,100+**/month
- **270 days** average to remediate a critical vulnerability
- **48 hours** average time-to-breach after exploit release (Mandiant M-Trends)
- **77,000 IPs** breached in 2 days (React2Shell)
- **97%** of breaches via known vulnerabilities
- **Up to 94%** alert-noise auto-triage; **80%+** repetitive work automated
- **Every 15 minutes** risk-profile refresh (Asset Composition Analysis)
- **83+** disconnected tools replaced; **4X** ROI from consolidation
- **80 days faster** breach containment; **$1.9M** savings (AI/automation)
- **~2%** of exposures that actually matter

---

## CTAs (canonical)

- "Book a Demo" · "Start a PoC" (Scanner VA, live in 15 minutes) · "Calculate Your ROI" · "Talk to Sales" · "See the Executive Command Center"

---

## Contradictions / things to flag

- **Agent naming drift:** "Software Layer Security AI" vs. "Source Code AI"; "Container & Cloud Security AI" vs. "Container AI." Prefer the full names; note the short forms are equivalents.
- **A-P.ai / Apieye / APIRE.IO:** the cloud-AI proxy is referred to by all three names across docs. Treat as the same companion service; prefer **APIRE.IO** in marketing, note **A-P.ai / Apieye** as the proxy alias. Confirm canonical spelling with the owner.
- **Domain:** canonical brand domain is **ofsecman.io** (marketing site at **www.ofsecman.io**); the OSM site record and DB seed now both use `ofsecman.io`.
- **Customer evidence:** the corpus contains **no verifiable named-customer case studies**. Do not invent them. (See [[entities]] → "Do not cite.")
- **94% vs 80%:** "up to 94%" of *alert noise* triaged; "80%+" of *repetitive work* automated — these are different claims; don't conflate.

Related: [[positioning]] · [[personas]] · [[sales-playbook]] · [[product-overview]] · [[entities]]
