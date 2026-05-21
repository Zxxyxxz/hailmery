# Compliance Coverage — Regulatory Framework Mapping

**What this file contains:** The full set of compliance frameworks APIRE addresses, with the specific architectural mechanism that handles each. Includes the article-by-article EU AI Act mapping (a key competitive differentiator), the NIS2 scope and fine details, GDPR / HIPAA / PCI-DSS / SOX handling, and the "compliance by design" argument.

**Sources:**
- `APIRE AI Security Platform Datasheet_2026.pdf` (visual transcription)
- `APIRE_Solution_Architecture_Document.pdf` v2.1
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `APIRE_ AI Security & Governance Platform Briefing.docx`
- `APIRE.IO_ Competitive Analysis in the AI Security Market.docx`
- `Competitive Playbook_ APIRE vs.docx`
- `Strategic Memo_ SentinelOne_s Acquisition of Prompt Security and Its Implications for APIRE.docx`
- `Implementation Proposal_ Securing Enterprise AI with the APIRE.docx`
- `PRODUCT-FACTS-EXTRACTED.md`

---

## Compliance badges (datasheet)

The 2026 datasheet displays six explicit compliance badges:

**GDPR · HIPAA · PCI-DSS · EU AI Act · NIS2 · SOX**

These are the six frameworks APIRE leads with publicly. The product's "Compliance Ready" framing.

## The strategic argument: compliance by design, not bolt-on

APIRE's compliance posture is **architectural, not procedural**. Because the platform stores nothing (Zero-Retention Architecture), the primary object of most regulation (stored personal data) is structurally eliminated. The result: compliance becomes an **automatic outcome** of the architecture, not a configuration overlay.

The headline framing used in marketing:

> APIRE's compliance-by-design posture transforms regulatory adherence from a manual burden into an automated outcome.

---

## EU AI Act — Article-by-Article Mapping

APIRE explicitly maps to four of the EU AI Act's most critical articles. **This article-level mapping is a key competitive differentiator** — Prompt Security and Lakera marketing claim "GDPR/HIPAA support" but neither provides specific, technical mapping to EU AI Act articles.

| Article | Requirement | APIRE Solution |
|---|---|---|
| **Article 10** | Data & Data Governance | **Data Leakage Fortress** provides comprehensive DLP controls (950+ rules) and real-time data masking — enforces robust data governance and prevents unauthorized data exposure. |
| **Article 14** | Human Oversight | **Auto/Manual tuning modes**, comprehensive audit trails, and operator override mechanisms. Dual-mode tuning allows security teams to choose between automated intelligence and granular manual control. |
| **Article 15** | Accuracy, Robustness & Cybersecurity | **AI Threat Protection Shield** defends against 13 AI-specific threats (5 core + 8 advanced) that could compromise model integrity. Multi-Word Pattern Protection adds robust, context-aware filtering. |
| **Article 52** | Transparency | **Content Safety Shield** delivers clear, binary SAFE/UNSAFE verdicts with automatic severity scoring and full audit logging. Provides unambiguous and transparent content moderation decisions. |

**Compliance-relevant feature stack for the EU AI Act:**
- Dual-Mode Tuning (auto + manual) → Article 14
- Traceable Decision Audits (human-readable audit trails of every AI-driven security decision) → Article 14
- Operator Override Mechanisms → Article 14
- Risk-based control (mandatory human approval for high-risk applications) → Article 14
- Inline data masking before AI receives the prompt → Article 10
- 950+ pre-configured rules + custom rules → Article 10
- Closed AI models never trained on customer data → supports transparency and data governance

---

## NIS2 Directive

**Scope:** Affects **160,000+ EU entities** (essential and important entities under the directive).

**Penalties:** Fines up to **€10 million or 2% of global turnover** for non-compliance — whichever is higher.

**APIRE's positioning:** Out-of-the-box compliance for these affected entities. Real-time threat detection enables active incident prevention with audit-ready dashboards for regulatory reporting.

**Why this matters:**
- **68% of European businesses struggle to understand EU AI Act responsibilities.**
- **40% of IT spending in Europe goes toward compliance-related costs.**
- APIRE is positioned as the fastest path to provable NIS2 + EU AI Act compliance.

**NIS2 + AI specifically:** APIRE has an explicit and deep focus on NIS2 as a primary purchasing driver. Marketing copy: "Prove NIS2 compliance. Stop PII leaks. One platform, zero code changes."

---

## GDPR (General Data Protection Regulation)

**Mechanism:** Zero-Retention Architecture removes the primary object of regulation — stored personal data.

**Effect:**
- No personal data is stored in logs, caches, databases, or backups.
- Removes key breach notification requirements (no data to be breached).
- Removes data residency triggers from APIRE itself (the platform retains nothing).
- Simplifies data minimization compliance.

**Caveat:** The customer's own use of the AI provider (e.g., OpenAI) still must address provider-side data handling. APIRE neutralizes the proxy/middleware layer.

---

## HIPAA (Health Insurance Portability and Accountability Act)

**Mechanism:** Protected Health Information (PHI) is processed ephemerally and is never stored or exposed.

**Effect:**
- PHI never persists anywhere within APIRE
- Inline masking prevents PHI from reaching AI models in the first place
- Layer 4 includes a dedicated PHI category (medical records, diagnoses, prescriptions)
- Aligns with strict healthcare privacy standards

**Customer example positioning:** Healthcare providers using APIRE for clinical decision support, patient engagement, and medical coding — see Persona 3 (Priya, principal DevSecOps architect at a pan-EU healthcare provider).

---

## PCI-DSS (Payment Card Industry Data Security Standard)

**Mechanism:** Cardholder data is instantly identified and masked or blocked before it can be processed or stored.

**Effect:**
- Card numbers, CVVs, bank account details detected as PCI category in Layer 4
- Pre-built compliance templates included
- Cardholder data is intercepted before reaching AI providers
- Built-in DLP detector includes Luhn-validated credit card detection

---

## SOX (Sarbanes-Oxley Act)

**Mechanism:** Comprehensive audit trails and compliance reporting dashboards support financial data governance.

**Effect:**
- Pre-built compliance templates within Data Leakage Fortress enforce controls over financial data
- Audit trail for every detection event
- Supports SEC/SOX disclosure controls

---

## Additional frameworks named in source material

While the six datasheet badges are the headline list, source material also mentions:

- **SOC 2** — Customer trust requirement for SaaS / Technology vertical; cited but not in the badge list.
- **ISO 27001** — Cited as enterprise-evaluation requirement; not in the badge list.
- **12+ other standards** — Layer 4 includes regulatory templates for "12+ standards" beyond GDPR / HIPAA / SOX / PCI-DSS (specific list not enumerated in source).

---

## How APIRE talks about compliance to each persona

**To Claudia (the Compliance-First CISO):**
> Prove EU AI Act / NIS2 compliance. Stop PII leaks. One platform, zero code changes. With APIRE, you get a complete, immutable audit trail of every threat blocked and policy enforced — board-ready, regulator-ready evidence.

**To Ben (the Builder CTO):**
> Pass enterprise security reviews fast. Compliance evidence comes from the architecture, not from a separate workflow you have to maintain.

**To Priya (the DevSecOps Policy Orchestrator):**
> Compliance with EU AI Act / NIS2 / HIPAA through versioned, auditable policies-as-code. Terraform modules and CI/CD integration mean compliance is part of every deploy.

---

## Competitive contrast on compliance

- **vs. Prompt Security (SentinelOne):** Claim support for GDPR / HIPAA but provide **no specific, technical mapping to individual articles of the EU AI Act**. Frame this as "checkbox compliance" vs. APIRE's provable, article-by-article mapping.
- **vs. Lakera (Check Point):** Lakera markets HIPAA, GDPR, PCI-DSS, SOC 2 alignment but does not have a published EU AI Act article-mapping or NIS2 deep focus.
- **vs. Traditional DLP:** Traditional DLP wasn't built for AI conversational traffic, doesn't address EU AI Act, doesn't address NIS2 incident reporting requirements for AI systems.

---

## Contradictions / things to flag

- **"Formal certifications" — what APIRE has not formally claimed:** SOC 2 Type II, ISO 27001, FedRAMP authorizations do **not** appear as completed certifications in technical source documents — only as *alignment* targets or evaluation criteria. Do not claim APIRE *is* SOC 2 / ISO 27001 / FedRAMP certified. Stick to "compliance alignment" and the six datasheet-listed frameworks for *certification* claims.
- **Compliance vs. Certification — careful wording:** APIRE provides "compliance-by-design alignment" with these frameworks. Marketing copy can say APIRE "supports", "enables", "aligns with", or "addresses" GDPR / HIPAA / EU AI Act / NIS2 / SOX / PCI-DSS — avoid saying APIRE "is certified" unless the user explicitly confirms a certification exists.
- **NIS2 entity count:** 160,000+ EU entities is the figure used consistently across all source material.
- **NIS2 fine cap:** €10M or 2% of global turnover (whichever higher). Both numbers are cited; use both when context allows.
