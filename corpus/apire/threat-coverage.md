# Threat Coverage — The 27+ Categories APIRE Blocks

**What this file contains:** The exhaustive enumerated list of every threat category APIRE detects and blocks, the encoding-attack subsystem, risk classification tiers, and the multi-vector correlation engine. Generation that describes "what threats does APIRE stop" should pull names from this file exactly.

**Sources:**
- `APIRE AI Security Platform Datasheet_2026.pdf` (visual transcription)
- `Understanding APIRE's Five Layers of AI Defense.docx`
- `A Beginner's Guide to Layered AI Security.docx`
- `Competitive Playbook_ APIRE vs.docx`
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `Implementation Proposal_ Securing Enterprise AI with the APIRE.docx`
- `PRODUCT-FACTS-EXTRACTED.md`

---

## The 27+ headline framing

APIRE's marketing leads with "**Block 27+ threat categories with a 5-layer intelligent defense system**". The 27+ aggregate is composed of:

- **14 Content Safety Categories** (Layer 1)
- **5 Core AI Threat Categories** (Layer 2)
- **8 Advanced AI Threat Categories** (Layer 2)

= 14 + 5 + 8 = **27**. The "+" leaves room for custom customer-defined threat categories on top.

---

## Layer 1 — 14 Content Safety Categories (datasheet canonical order)

1. **Violent Crimes**
2. **Non-Violent Crimes**
3. **Indiscriminate Weapons**
4. **Sex-Related Crimes**
5. **Child Sexual Exploitation** (CSAM)
6. **Hate Speech**
7. **Suicide & Self-Harm**
8. **Defamation**
9. **Sexual Content**
10. **Specialized Advice**
11. **Elections**
12. **Privacy Violations**
13. **Intellectual Property**
14. **Code Interpreter Abuse**

**Grouped framing used in briefings:**
- *Critical Protection:* Violence, CSAM, Weapons, Self-Harm
- *Legal & Compliance:* Defamation, IP Theft, Privacy Violations
- *Content Integrity:* Hate Speech, Misinformation, Sexual Content
- *AI-Specific:* Code Interpreter Abuse

**Verdict shape:** Binary SAFE / UNSAFE plus automatic severity scoring (Critical / High / Medium).

**Coverage:** 32+ languages.

---

## Layer 2 — 5 Core AI Threat Categories

1. **Prompt Injection** — Direct or indirect manipulation through carefully crafted inputs designed to override system instructions or safety rules. Identified by OWASP as the #1 AI security risk.
2. **Jailbreaking** — Bypassing the AI's safety rules to elicit prohibited outputs.
3. **Data Exfiltration** — Attempts to extract sensitive data the model has access to or has previously seen.
4. **Social Engineering** — Manipulation of the AI to assist in attacks against humans or systems.
5. **Model Inversion** — Reconstructing training data or sensitive model behavior through carefully crafted queries.

---

## Layer 2 — 8 Advanced AI Threat Categories

1. **Adversarial Attacks** — Inputs engineered to cause model misbehavior, hallucination, or specific incorrect outputs.
2. **Compliance Violations** — Outputs that would breach regulatory or policy requirements (GDPR, HIPAA, SEC disclosures, etc.).
3. **IP Theft** — Attempts to extract proprietary code, trade secrets, or competitive intelligence via AI interaction.
4. **Shadow AI Usage** — Unsanctioned AI tool usage by employees outside organizational governance.
5. **API Security** — Attacks targeting the AI API surface itself (auth abuse, rate-limit evasion, etc.).
6. **Content Abuse** — Use of the AI to produce harmful content at scale (spam, phishing, disinformation).
7. **Business Logic Attacks** — Manipulation of AI-driven business workflows to produce unauthorized outcomes (fraudulent transactions, unauthorized actions).
8. **Context Attacks** — Exploitation of the AI's context window or retrieval-augmented inputs to inject malicious instructions or extract context data.

---

## Dashboard pre-configured threat categories (Cloud)

The Cloud dashboard ships with **9 pre-configured threat categories**:
1. Prompt Injection
2. Jailbreaking
3. Data Exfiltration
4. Social Engineering
5. Adversarial Attacks
6. Compliance Violations
7. Model Inversion
8. IP Theft
9. Content Abuse

Customers can define additional custom categories beyond these defaults.

---

## Layer 4 — 12 Data Leakage Detection Categories

Layer 4 prevents the *outbound* leakage of these sensitive data types (separate from the 27+ inbound-attack categories above):

1. **PII — Personal Data** (Names, addresses, IDs, national IDs, passports)
2. **PHI — Health Information** (Medical records, diagnoses, prescriptions)
3. **PCI — Payment Card Data** (Card numbers, CVVs, bank account details)
4. **Company Confidential & IP** (Trade secrets, source code, proprietary data)
5. **Financial Information** (Revenue data, forecasts, M&A details)
6. **Credentials & API Keys** (Passwords, tokens, API keys, secrets)
7. **EU GDPR Data** (Special categories under EU regulation)
8. **Regulatory Obligations** (Compliance-relevant data under 12+ standards)
9. **Indicators of Compromise** (IPs, hashes, domains, malware signatures)
10. **Suspicious Activity** (Anomalous user behavior detection)
11. **Acceptable Use** (Policy violation monitoring and enforcement)
12. **Custom — User Defined**

Backed by **950+ pre-configured DLP rules** covering **150+ data types**.

**Built-in dashboard DLP examples:** Turkish TCKN (checksum-validated), credit card (Luhn-validated), email, phone, IPv4/IPv6, plus custom regex.

---

## Encoding-Attack Subsystem (Layer 0 / pipeline stages 2-3)

Coverage: **26+ encoding attack vectors**, **13-stage normalization pipeline**, supports up to **3 levels of nested encoding recursion**.

Vectors include (non-exhaustive):
- Base64
- URL / Percent encoding
- HTML Entity encoding
- Unicode Homoglyphs
- Invisible Unicode characters
- Nested Encoding (≤3 levels deep)
- Token Boundary Exploitation
- Bidirectional Text Override
- Combining Character Stacking
- Markdown Injection
- ROT13 / Caesar ciphers
- Leetspeak transformations
- Null Byte Injection
- (plus 13+ additional vectors documented in cloud architecture)

---

## Risk Classification — 6-Tier Scoring (Layer 2)

| Tier | Score range |
|---|---|
| `NO_RISK` | 0.00 – 0.15 |
| `MINIMAL` | 0.15 – 0.30 |
| `LOW` | 0.30 – 0.50 |
| `MEDIUM` | 0.50 – 0.65 |
| `HIGH` | 0.65 – 0.80 |
| `CRITICAL` | 0.80 – 1.00 |

## Multi-Vector Correlation Amplification

When multiple threat categories fire on the same request, APIRE amplifies the composite score:
- 2 categories triggered → +10%
- 3 categories triggered → +20%
- 4 or more categories triggered → +40%

This catches coordinated multi-vector attack campaigns that any single-category detector would miss.

---

## Policy Enforcement Actions

Every policy decision results in one of two actions:

- **AUDIT** — Log the event, permit the request.
- **PREVENTION** — Block the request, or mask sensitive content before forwarding.

---

## Industry stats APIRE cites in context

(These are the headline numbers used in marketing alongside the threat-coverage story — safe to cite in any content about the threat landscape.)

- **67%** year-over-year increase in AI-specific attacks (prompt injection & jailbreak volume).
- **$4.2M** average cost per AI-related data breach, rising **45% annually**.
- **89%** of enterprises lack purpose-built AI security.
- **2,500+** daily AI threats observed.
- **86%** of companies deploying AI experienced an AI security incident in the past 12 months.
- **8.5%** of prompts submitted to AI tools contain sensitive information (PII, credentials, internal data).
- **$670,000** higher breach costs for organizations using shadow AI.
- **98%** of employees use unsanctioned AI applications (shadow AI).
- **97%** of AI-related security breaches involved systems lacking proper access controls.

---

## Contradictions / things to flag

- **Threat count interpretation:** "27+ threats" = 14 content safety + 5 core AI + 8 advanced AI. The dashboard pre-configures **9** Layer-2 categories specifically, which is a separate, narrower fact. Do not confuse "9 pre-configured" with "9 total" — they are different scopes.
- **"3.2 seconds to breach" claim** appears in the AI Security & Privacy Briefing and Implementation Proposal as an industry stat. Source material flags this as **[UNVERIFIED — confirm with Baran]**. Do not cite without verification.
- **Layer 1 14-category list:** Datasheet ordering is authoritative. Some older briefings substitute "Misinformation" for one of the other 14 — datasheet ordering is canonical.
