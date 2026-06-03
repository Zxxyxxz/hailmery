# OSM — Technical Architecture

**What this file contains:** The architecture of the OSM platform — building blocks, the AI engine, the AI Memory, the data-intelligence pipeline, and integrations. Grounded in the OSM source documents. Use for any technical content, datasheets, or architecture briefs.

**Sources:** `Deconstructing the Offensive Security Manager (OSM)_ An Architectural Teardown.txt`, `Offensive Security Manager (OSM)_ A Technical and Operational Brief.txt`, `An Overview of the Offensive Security Manager (OSM) Platform.txt`, `Bilgi Notu-OSM*.txt`.

---

## Design philosophy

OSM stems from a **military and defense background** and is engineered **secure-by-design** with maximum deployment flexibility. It is **not another scanner** — it is an intelligent **analytics and governance layer** (a "risk management layer") that creates a **synergy ecosystem**, maximizing ROI on a customer's existing security investments rather than replacing them.

## The three-layer data philosophy

OSM builds its picture of risk from three distinct layers:

1. **Security Data — the foundation.** Baseline vulnerability information collected from scanners across the four layers (Network, Web, Container, Source Code). Vendor-agnostic ingestion integrates with existing tools (e.g., Tenable, Snyk, Nessus, Qualys) or uses OSM's own appliance.
2. **Security Context — the OSM AI Memory.** A proprietary **hybrid graph, vector, and time-series database** (the "Cognitive Core") storing the relationships between assets, threats, and business value. This is what lets the AI think like a human analyst — e.g., distinguishing a test system from a production system holding 20 million customer records.
3. **Real-Time Risk Data — Continuous Offensive Security.** **Asset Composition Analysis** maintains a live **SBOM (Software Bill of Materials)** and compares it against real-time threat intelligence **every 15 minutes**, closing the blind spots between scheduled scans.

## System building blocks

### Platform Manager (Executive Command Center)
The heart of the platform. Collects and standardizes data (ingestion, deduplication), enriches it via the AI Memory, and hosts the **Executive Command Center** UI where leaders view the **Finding Conversion Funnel** (millions of signals distilled to a handful of Priority Actions). Delivered as a lightweight virtual appliance, **operational within 15 minutes**, via virtual appliance or cloud.

### OSM Scanner Virtual Appliance (VA)
An optional, free standalone VM pre-installed with best-of-breed **open-source scanners — OpenVAS, ZAP, Trivy, SonarQube** — covering Network, Web, Container, and Source Code. Used for rapid Proof of Concept and to fill coverage gaps.

### The AI Brain — AISecOps Autonomous Workforce
Not a single algorithm but a workforce of **5 Specialized AI Agents**:

1. **AI Risk Manager** — orchestrator; aggregates data from all sub-agents and infrastructure, analyzes business impact, and produces prioritized **Priority Actions**.
2. **Network Security AI** — network topology and external exposure; open ports, topology errors; works with Nessus/Qualys reports. Monitors internal and external infrastructure 24/7.
3. **Web App Security AI** — application logic and attack vectors; OWASP-based continuous analysis detecting SQL Injection, XSS, and API vulnerabilities; builds action plans for dev teams.
4. **Container & Cloud Security AI** — Docker, Kubernetes, and cloud misconfigurations; analyzes embedded vulnerabilities in container images proactively.
5. **Software Layer Security AI** (a.k.a. Source Code AI) — OS and third-party software CVEs, dependency risks; drives patch-management urgency prioritization and secure SDLC.

> Note: some documents use shorthand agent names — "Network AI," "Web App AI," "Container AI," "Source Code AI." The Turkish brief also references virtual SOC roles: **Threat Hunter, SOC Triage Agent, Risk Forecaster** (and "SOC AI") as facets of the same Autonomous Workforce.

### AI Engine deployment options
- **On-Premise AI Appliance** — dedicated hardware/VM with a **proprietary, tuned LLM**, enabling a **fully air-gapped** solution (government/military, no internet connection).
- **Cloud AI (via A-P.ai / Apieye)** — connects to global AI providers (e.g., OpenAI) through OSM's secure cloud proxy, **filtering, anonymizing, and masking sensitive data** before it ever leaves the network.

## The data-intelligence pipeline (raw alert → OSM Issue)

1. **Data Collection** — raw data gathered across the four layers (scanners, pentests, CI/CD, SIEM, threat intel).
2. **Ingestion & Preprocessing** — Platform Manager standardizes and deduplicates; normalizes findings into a common language (CVE, CVSS).
3. **Enrichment** — data interacts with the OSM AI Memory, adding business **Security Context** and real-time risk data.
4. **AI Analysis** — the 5 agents analyze the holistic dataset; **SOC AI** filters noise (up to **94%**), predicts attack scenarios, and funnels signals to Priority Actions.
5. **The "OSM Issue"** — final AI-generated briefing: Business Impact, Attacker Scenarios (TTPs), Detection & Prevention Guidance (virtual shield via firewalls/WAFs/EDRs), and a Complete Remediation Plan.

## Holistic security data collection (sources orchestrated)

- **Manual Penetration Tests** — human-led offensive testing workflows.
- **Network, Web, Container Vulnerability Scanners** — automated scan orchestration.
- **SAST, DAST, IAST, IaC Source Code Scanners** — application-security pipeline.
- **CI/CD Pipelines** — DevSecOps integration (Jenkins, GitLab, etc.).
- **Real-Time Security Data** — SIEM feeds, Threat Intelligence, OSM Risk Intelligence.

## Integration ecosystem

- **Scanners (orchestrated, vendor-independent):** Nessus, Qualys, Acunetix, Burp Suite, Trivy, SonarQube, Tenable, Snyk; bundled open-source: OpenVAS, ZAP, Trivy, SonarQube.
- **Ticketing / workflow:** Jira (two-way / bidirectional sync), ticket-management systems.
- **CI/CD & DevSecOps:** Jenkins, GitLab, CI/CD pipelines.
- **Defensive controls (for virtual shielding):** firewalls, WAFs, EDRs, SIEM, SOAR.
- **Architecture style:** API-first, designed for fast deployment.

## Governance & process management

Built-in **SLA tracking**, escalation policies, tags, groups, notifications, status tracking (Open / In-Progress / Closed), automated **compliance mapping** (see [[positioning]]), and **Issue Quality Workflows** with **Master Pentester / Pentester** role-based quality control.

## Data Analytics Wizards

Exploit DB wizard, Vulnerability DB wizard, Integration wizard, and AI Assistance wizard.

Related: [[product-overview]] · [[positioning]] · [[competitive-landscape]] · [[entities]]
