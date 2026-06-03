# OSM — Competitive Landscape

**What this file contains:** How OSM positions against the alternatives — traditional/legacy security tooling and the adjacent modern categories (ASM, BAS, Automated Pentesting) — plus the relationship to the companion product APIRE.IO. Grounded in the OSM source documents.

**Sources:** `Competitive Analysis_ Offensive Security Manager (OSM) vs.txt`, `Comprehensive Sales & Marketing Documentation_ OSM and APIRE.txt`, the sales playbooks, and the strategic/whitepaper briefs.

> **Fidelity note:** The OSM material competes primarily against a **model of security** (siloed, reactive, periodic) and adjacent **categories**, not against a roster of named competitor companies the way APIRE's material does. Named products appear mostly as **integration targets / legacy tools OSM orchestrates**, not as head-to-head rivals. Do not invent named competitors.

---

## Primary competitive frame: OSM vs. the Traditional/Legacy Model

The status quo is "digital whack-a-mole." Core limitations of traditional security tools:

- **Scattered, siloed tools** → fragmented view of risk.
- **Periodic scanning** → point-in-time snapshots, wide windows of exposure.
- **Manual data correlation** → overwhelms human teams, invites error.
- **Lack of business context** → generic CVSS scores, alert fatigue.

### Head-to-head differentiators

| Dimension | Traditional tools | OSM |
|---|---|---|
| Data aggregation | Disconnected dashboards | Unified **Executive Command Center** (single source of truth) |
| Risk analysis | Generic CVSS scores | **AI Risk Manager + OSM AI Memory** → **Real Risk Score** (business context) |
| Threat detection | Periodic scans, gaps | **Continuous Offensive Security** + Asset Composition Analysis (every 15 min) |
| Output | Data dump of alerts | The **"OSM Issue"** action plan (Attacker Scenarios, Prevention Guidance, Remediation Plan) |
| Workforce | Overwhelmed humans | **AISecOps Autonomous Workforce** (5 Specialized AI Agents, 24/7) |
| Licensing | Per-asset, expensive | Bundled unlimited scanning + AI brain |

## Adjacent categories OSM positions against

OSM differentiates by bringing **full-cycle CTEM directly to the Executive Command Center**, powered by the AISecOps Workforce and OSM AI Memory — solving the People, Money, and Complexity headaches concurrently. The named adjacent categories:

- **ASM (Attack Surface Management)** — OSM goes beyond visibility to autonomous analysis and remediation across all four layers.
- **BAS (Breach & Attack Simulation)** — OSM adds continuous, context-aware prioritization and human-readable action plans.
- **Automated Penetration Testing** — OSM automates the full pentester analysis/reporting workflow *and* supports manual pentesting with Master Pentester/Pentester quality workflows.

## Legacy / integrated tools (OSM orchestrates, does not replace)

OSM is **vendor-independent** and creates a "synergy ecosystem," maximizing ROI on existing investments. Named tools in the source material (as integration targets):

- **Vulnerability / network:** Nessus, Qualys, Tenable, OpenVAS
- **Web app:** Burp Suite, Acunetix, ZAP
- **Container/code:** Trivy, SonarQube, Snyk
- **Workflow/CI:** Jira, Jenkins, GitLab
- **Defensive controls:** SIEM, SOAR, EDR, WAF, firewalls

> Positioning line: OSM consolidates and makes existing tools *smarter* via the AI Risk Manager — it replaces the fragmented **dashboards**, not necessarily the scanners underneath. Replaces **83+ disconnected tools** at the management layer.

## Standard objections & responses

- **"Just another vulnerability scanner?"** → "That's the key difference. We provide an Executive Command Center with Continuous Offensive Security that generates human-readable remediation plans — we orchestrate scanners, we're not one."
- **"AI hallucinates."** → "Our AI analysis is grounded in verifiable data from scanners and strengthened by OSM AI Memory retaining your organizational constraints."
- **"We already have tool X."** → "OSM acts as the Executive Command Center that makes existing tools smarter via the AI Risk Manager."
- **"It's too expensive."** → "OSM's Continuous Offensive Security costs a fraction of manual pentesting, and bundles unlimited scanning."
- **"Integration seems too complex."** → "API-first architecture designed for fast deployment; PoC in 15 minutes via the Scanner VA."

## Companion product: APIRE.IO (complementary, not competitive)

**APIRE.IO** is OSM's sister product — **AI Data Leakage Prevention** for GenAI traffic. It is a transparent proxy securing employee/enterprise interactions with public LLMs:

- Protects **100M+ requests**
- **950+ data masking rules**, **14 content safety categories**, **13 threat detection categories**
- **Four-layer defense architecture**, zero-touch deployment, multi-provider, cost tracking, regulatory compliance automation
- In OSM's architecture, APIRE.IO (a.k.a. A-P.ai / Apieye) also serves as the **secure cloud-AI proxy** that masks sensitive data before queries reach public AI models.

Together OSM + APIRE.IO = a **dual-platform** offering: OSM secures the enterprise attack surface; APIRE.IO secures the GenAI adoption surface.

Related: [[positioning]] · [[product-overview]] · [[technical-architecture]] · [[entities]]
