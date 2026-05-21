# APIRE Five-Layer Defense Architecture (Layer 0 → Layer 4)

**What this file contains:** The canonical layer-by-layer specification of APIRE's defense system. Every layer's name, function, key metrics, tags, capabilities, and EU AI Act article mapping. Generation about the platform's technical depth must use these exact names and numbers.

**Sources:**
- `APIRE AI Security Platform Datasheet_2026.pdf` (visual transcription) — canonical 5-layer framing
- `APIRE_Solution_Architecture_Document.pdf` v2.1 (Nov 2025) — described as 4-layer; pre-Sentinel framing
- `Understanding APIRE's Five Layers of AI Defense.docx`
- `A Beginner's Guide to Layered AI Security.docx`
- `The Security Revolution of Storing Nothing_ An Introduction to Zero-Retention Architecture.docx`
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `APIRE_ AI Security & Governance Platform Briefing.docx`
- `PRODUCT-FACTS-EXTRACTED.md`
- `Competitive Playbook_ APIRE vs.docx`

---

## Layer 0 — Sentinel — AI-Powered Gateway

**Role:** The outer perimeter — first line of defense on every single request. Sits in front of the four detection layers and stops well-known attacks before they reach deeper analysis.

**Function:** AI-powered content moderation at scale. Updated by AI in real time with hundreds of attack categories and 100K+ attack vector detection at minimal latency.

**Key metrics:**
- Detection: **100K+ Vectors**
- Training: **Continuous AI**
- Latency: **Minimal**

**Tags (datasheet):** 100K+ Attack Vectors · AI-Updated · Minimal Latency

**Watchtower analogy:** Sentinel is the watchtower on the castle wall — it scans the horizon for known threats and stops the obvious attackers before they ever reach the gate. By handling loud, well-known attacks at the perimeter, the four specialized shields behind it can focus their effort on the subtle, sophisticated threats that need deeper analysis.

---

## Layer 1 — Content Safety Shield

**Role:** AI-powered content moderation. Acts as a gatekeeper for harmful, inappropriate, or illegal content before it can cause damage.

**Function:** Real-time content classification across 14 comprehensive safety categories with binary SAFE/UNSAFE verdicts and automatic severity scoring (Critical / High / Medium). Contextual AI understanding reduces false positives.

**Key metrics:**
- Categories: **14**
- Languages: **32+** (sometimes written exactly "32")
- False Positive Ratio: Very Low
- Engine: Powered by AI (proprietary, closed model — never trained on customer data)

**Tags (datasheet):** 14 Categories · 32 Languages · Binary Verdict · Auto Severity Score

**14 Detection Categories (exact order from datasheet):**
1. Violent Crimes
2. Non-Violent Crimes
3. Indiscriminate Weapons
4. Sex-Related Crimes
5. Child Sexual Exploitation
6. Hate Speech
7. Suicide & Self-Harm
8. Defamation
9. Sexual Content
10. Specialized Advice
11. Elections
12. Privacy Violations
13. Intellectual Property
14. Code Interpreter Abuse

**Key benefits:**
- Binary SAFE/UNSAFE verdicts — no ambiguity.
- Contextual understanding prevents false positives.
- Real-time classification with automatic severity scoring.
- Multi-language support across 32 languages.
- Powered by state-of-the-art AI models.

**EU AI Act mapping:** **Article 52 (Transparency)** — the Content Safety Shield delivers clear, binary SAFE/UNSAFE verdicts with full audit logging.

---

## Layer 2 — AI Threat Protection Shield

**Role:** Specialized defense against AI-specific attacks that target the logic and behavior of AI models. Uses semantic analysis to understand attacker intent, not just keywords.

**Function:** Defends against **13 AI-specific threats** — 5 core categories plus 8 advanced categories. Auto-tuning + manual tuning. Zero-day protection. Threat correlation across multi-vector attacks.

**Key metrics:**
- Core Threats: **5**
- Advanced Threats: **8**
- Analysis: Semantic AI
- Tuning: Auto + Manual

**Tags (datasheet):** 5 Core + 8 Advanced · Prompt Injection · Jailbreak Defense · Zero-Day

**5 Core AI Threat Categories:**
1. Prompt Injection
2. Jailbreaking
3. Data Exfiltration
4. Social Engineering
5. Model Inversion

**8 Advanced AI Threat Categories:**
1. Adversarial Attacks
2. Compliance Violations
3. IP Theft
4. Shadow AI Usage
5. API Security
6. Content Abuse
7. Business Logic Attacks
8. Context Attacks

**Cloud dashboard note:** Cloud documentation lists **9 pre-configured threat categories** in the dashboard (Prompt Injection, Jailbreaking, Data Exfiltration, Social Engineering, Adversarial Attacks, Compliance Violations, Model Inversion, IP Theft, Content Abuse). The "5 core + 8 advanced = 13" framing is customer-facing; the dashboard ships with 9 pre-configured categories and customers can define additional custom categories.

**Risk classification (6 tiers) used by Layer 2:**
- `NO_RISK` (0.00–0.15)
- `MINIMAL` (0.15–0.30)
- `LOW` (0.30–0.50)
- `MEDIUM` (0.50–0.65)
- `HIGH` (0.65–0.80)
- `CRITICAL` (0.80–1.00)

**Multi-vector correlation amplification (exact):** 2 categories +10%, 3 categories +20%, 4+ categories +40%.

**Key benefits:**
- Semantic analysis — understands intent, not just keywords.
- Auto-tuning protection adapts to your threat landscape.
- Zero-day defense against emerging attack patterns.
- Manual tuning for full flexibility.
- Threat correlation identifies multi-vector attacks.
- Real-time correlation and threat analysis.
- Uses a proprietary, closed AI model that is **never trained on customer data**.

**EU AI Act mapping:** **Article 15 (Accuracy, Robustness & Cybersecurity)** — AI Threat Protection Shield defends against sophisticated attacks on model integrity.

---

## Layer 3 — Multi-Word Pattern Protection

**Role:** High-speed, dictionary-based detection of custom words and complex multi-word phrases. Like an "instant 'find' feature" or custom watchlist for the organization.

**Function:** Lightning-fast pattern recognition with single and multi-word detection. Bring your own custom dictionary in any language. Real-time hot updates with auto-refresh — zero downtime, zero false negatives on configured patterns. Microsecond-level pattern matching at enterprise scale.

**Key metrics:**
- Detection: Single & Multi
- Updates: Real-Time
- Languages: Any
- False Negatives on configured patterns: **0%**

**Tags (datasheet):** Custom Dictionary · Any Language · Hot Updates · 0% False Neg.

**Key benefits:**
- Bring your own dictionary in any language.
- Single and complex multi-word phrase matching.
- Auto-refresh updates without downtime.
- Extremely fast lookups — optimized for performance.
- Zero false positives on configured patterns (additional claim from the Beginner's Guide).
- Custom pattern library for any industry vertical.
- Context-aware semantic engine reduces false positives below traditional keyword filters.

**Example use:** A company could use this layer to instantly block any mention of its secret 'Project Titan' from being sent to an external AI.

**EU AI Act mapping:** **Article 15** (supporting role) — robust pattern enforcement contributing to robustness and cybersecurity.

---

## Layer 4 — Data Masking Fortress (also called "Data Leakage Fortress")

**Role:** Enterprise-grade Data Loss Prevention (DLP) engine. The strongest line of defense against sensitive data exposure — the "vault door" of the architecture.

**Function:** 950+ pre-configured DLP rules protecting PII, PHI, PCI data. Zero-trust architecture — every request is scanned with no exceptions. 0% false negatives on critical data. Inline masking and anonymization with visual rule builder — no regex expertise required. Inline blocking, masking, or anonymization in real-time before data reaches AI models. Response-time role-based data restoration so authorized users see unmasked content.

**Key metrics:**
- DLP Rules: **950+**
- Data Types: **150+**
- Architecture: **Zero-Trust**
- False Negatives on critical data: **0%**

**Tags (datasheet):** 950+ DLP Rules · Inline Masking · Zero-Trust · 0% False Neg.

**12 Data Leakage Detection Categories (datasheet, exact order):**
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
12. **Custom — User Defined** (Unlimited business-specific rule creation)

**Built-in dashboard DLP rule examples:** Turkish TCKN (checksum-validated), credit card (Luhn-validated), email, phone, IPv4/IPv6, plus arbitrary custom regex.

**Compliance templates included:** GDPR, HIPAA, SOX, PCI-DSS, and 12+ other standards.

**Key benefits:**
- 950+ pre-configured PII, PHI, PCI rules out-of-the-box.
- Zero-trust — every request scanned, no exceptions.
- Perfect accuracy — 0% false negatives on critical data.
- Inline blocking and masking / anonymization.
- Visual rule builder — no regex expertise required.
- Complete audit trail for regulatory documentation.
- Response-side role-based data unmasking for authorized users.

**EU AI Act mapping:** **Article 10 (Data & Data Governance)** — Data Leakage Fortress provides comprehensive DLP controls and real-time data masking.

---

## How the layers operate together

The full 5-layer system runs as an **integrated immune system** for AI traffic. Threat intelligence is shared between layers in real-time; multi-vector attacks are correlated. Every layer runs in volatile memory only (Zero-Retention Architecture) — none of the inspection state persists.

**Castle analogy used in source material:**
- **Layer 0 (Sentinel)** = the watchtower on the castle wall
- **Layer 1 (Content Safety Shield)** = the gatekeeper
- **Layer 2 (AI Threat Protection Shield)** = the strategist / intelligent guard captain
- **Layer 3 (Multi-Word Pattern Protection)** = the watchlist of forbidden words
- **Layer 4 (Data Leakage Fortress)** = the vault door

## The 11-stage technical pipeline (cloud docs)

The cloud documentation describes the same defense system as an **11-stage security pipeline** that every API request traverses with sub-millisecond latency impact per stage:

1. Authentication & Rate Verification
2. Encoding Attack Detection
3. Encoding Normalization
4. Content Safety Analysis (AI Guard Categories)
5. AI Threat Detection (Threat Categories)
6. Custom Pattern Matching (Dictionaries)
7. Data Masking (Request) (Rules)
8. AI Provider Routing
9. Data Unmasking (Response) (role-based)
10. Response Security Analysis
11. Audit Logging

Stages 1–3 run automatically on every request; stages 4–7 are policy-driven; stages 9–11 are configuration-driven. Policy enforcement actions are **AUDIT** (log, permit) or **PREVENTION** (block or mask).

**Encoding-attack subsystem:** Covers **26+ encoding attack vectors** and runs a **13-stage normalization pipeline** supporting up to **3 levels of nested encoding recursion**. Vectors include Base64, URL/Percent, HTML Entity, Unicode Homoglyphs, Invisible Unicode, Nested Encoding (≤3 levels), Token Boundary Exploitation, Bidirectional Text Override, Combining Character Stacking, Markdown Injection, ROT13/Caesar, Leetspeak, Null Byte Injection, and others.

## Contradictions to flag

- **Layer 4 name:** Datasheet calls it "Data Masking Fortress"; Solution Architecture Document and most briefings call it "Data Leakage Fortress". Both refer to the same layer. **Treat as interchangeable**; "Data Leakage Fortress" appears more often in detailed technical/compliance content, "Data Masking Fortress" appears on the marketing datasheet.
- **Layer 1 datasheet phrasing — "Hate Speech":** Datasheet lists 14 categories explicitly. Some older briefings list "Misinformation" as a 14th category (replacing one of: Defamation, Elections, or Specialized Advice — varies by document). The **datasheet 14-category list above is canonical**.
- **Threat count framing:** "27+ threat categories" is the customer-facing aggregate (14 content safety + 5 core AI threats + 8 advanced AI threats = 27). "13 AI-specific threats" (5 core + 8 advanced) is the AI-specific subset. The dashboard's 9 pre-configured Layer-2 categories is a separate, narrower fact about dashboard defaults. Be precise about which number is being cited.
