# APIRE — Product Facts Extracted (Ground Truth)

Source: `/Users/xxxyxxx/Downloads/AI Docs Merged/cloud/*` (7 md), `/onprem/*` (9 md), `APIRE_Solution_Architecture_Document.pdf` (v2.1, Nov 2025), `APIRE AI Security Platform Datasheet_2026 2.pdf`.

---

## A) PRODUCT FACTS

### A.1 What is APIRE?

APIRE.IO is an **AI API Security and Governance Platform** that operates as a **transparent security proxy** between organizational applications and AI providers. It delivers real-time inspection, threat detection, content moderation, and data protection on every prompt and response, under a **Zero-Retention Architecture (ZRA)** — all data processing happens in volatile RAM, then is irrevocably erased. Integration is **zero-touch / zero code change**: a single endpoint URL swap (e.g., `api.openai.com` → `app.apire.io`). The product brand line is "AI Security Without Friction" and the tagline "Process Everything. Store Nothing. Protect Always." (also rendered "Process Everything. Keep Nothing. Protect Always."). Three deployment models: **Cloud (SaaS)**, **On-Premise** (physical or virtual appliance), and **Hybrid**.

### A.2 Security Layers / Pipeline

**Marketing / architectural framing (PDFs):** **5-Layer Defense System** (datasheet) / **Four-Layer Defense System** (architecture doc) — the datasheet adds Layer 0 as a perimeter gateway in front of the four detection layers:

| Layer | Name | Function |
|---|---|---|
| **Layer 0** | **Sentinel — AI-Powered Gateway** | First line of defense; AI-powered moderation at scale, **100K+ attack vectors**, AI-updated continuously, minimal latency |
| **Layer 1** | **Content Safety Shield** | AI-powered moderation across **14 safety categories**, **32+ languages**, binary SAFE/UNSAFE verdicts with automatic severity scoring (Critical / High / Medium) |
| **Layer 2** | **AI Threat Protection Shield** | Semantic defense against **27+ AI-specific threats** — **5 core + 8 advanced**; auto-tuning + manual tuning; zero-day defense; multi-vector correlation |
| **Layer 3** | **Multi-Word Pattern Protection** | Dictionary-based single & multi-word matching; **any language**; real-time hot updates; **0% false negatives** on configured patterns |
| **Layer 4** | **Data Masking Fortress / Data Leakage Fortress** | DLP engine with **950+ pre-configured rules** (PII, PHI, PCI, API keys, credentials, IP); zero-trust inspection; **0% false negatives** on critical data; inline masking & anonymization; visual rule builder (no regex required) |

**Technical pipeline framing (cloud docs Part 3):** every API request traverses an **11-stage security pipeline** with sub-millisecond latency impact. Exact stage order:

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

Stages 1–3 run automatically on every request; stages 4–7 are policy-driven; stages 9–11 are configuration-driven. Policy enforcement actions are **AUDIT** (log, permit) or **PREVENTION** (block or mask). The encoding-attack subsystem covers **26+ encoding attack vectors** and runs a **13-stage normalization pipeline** supporting up to **3 levels of nested encoding recursion**.

### A.3 Threats Detected & Blocked

**AI Threat Categories — Core 5** (Layer 2): Prompt Injection, Jailbreaking, Data Exfiltration, Social Engineering, Model Inversion.

**AI Threat Categories — Advanced 8** (Layer 2 / datasheet): Adversarial Attacks, Compliance Violations, IP Theft, Shadow AI Usage, API Security, Content Abuse, Business Logic Attacks, Context Attacks.

> Cloud docs list **9 pre-configured threat categories**: Prompt Injection, Jailbreaking, Data Exfiltration, Social Engineering, Adversarial Attacks, Compliance Violations, Model Inversion, IP Theft, Content Abuse. The datasheet's "5 core + 8 advanced = 13" framing is the customer-facing positioning; the dashboard ships with at least 9 pre-configured categories, and customers can define additional custom categories (Layer 2 advanced threats and customer-defined ones).

**Content Safety Categories — 14** (Layer 1): Violent Crimes · Non-Violent Crimes · Indiscriminate Weapons · Sex-Related Crimes · Child Sexual Exploitation · Hate Speech · Suicide & Self-Harm · Defamation · Sexual Content · Specialized Advice · Elections · Privacy Violations · Intellectual Property · Code Interpreter Abuse.

**Risk Classification (Layer 2)** — 6 tiers: NO_RISK (0.00–0.15) · MINIMAL (0.15–0.30) · LOW (0.30–0.50) · MEDIUM (0.50–0.65) · HIGH (0.65–0.80) · CRITICAL (0.80–1.00). Multi-vector correlation: 2 categories +10%, 3 +20%, 4+ +40%.

**Encoding-attack vectors (26+):** Base64, URL/Percent, HTML Entity, Unicode Homoglyphs, Invisible Unicode, Nested Encoding (≤3 levels), Token Boundary Exploitation, Bidirectional Text Override, Combining Character Stacking, Markdown Injection, ROT13/Caesar, Leetspeak, Null Byte Injection, etc.

**Layer 4 DLP detection categories (datasheet):** PII (names, addresses, IDs, national IDs, passports) · PHI (medical records, diagnoses, prescriptions) · PCI (card numbers, CVVs, bank account details) · Company Confidential & IP (trade secrets, source code) · Financial Information (revenue, forecasts, M&A) · Credentials & API Keys · EU GDPR Data · Regulatory Obligations · Indicators of Compromise · Suspicious Activity · Acceptable Use · Custom (user-defined).

Built-in DLP rules in the Cloud dashboard include: Turkish TCKN (checksum-validated), credit card (Luhn-validated), email, phone, IPv4/IPv6, plus custom regex.

### A.4 Deployment Models

| | Cloud (SaaS) | On-Premise | Hybrid |
|---|---|---|---|
| Infrastructure | APIRE-managed global edge | Self-hosted physical or virtual appliance | Cloud + on-prem combined |
| Activation | Instant — URL swap | Appliance install + license | Mixed (cloud proxy + on-prem chat / logging, etc.) |
| Data Sovereignty | Cloud provider regions | Full — data never leaves customer infrastructure; air-gap supported | Per-component |
| Auth | API Key + session | Keycloak (OIDC) + LDAP/AD | Mixed |
| Multi-tenancy | Org-scoped | Full tenant management with quotas | Full |
| AI Providers | All cloud providers | Cloud + Local AI Appliances (BYOK, local LLMs) | Cloud + Local |
| Licensing | Credit-based / subscription | Base license fee + per-request fee | Combination |
| Updates | Automatic | Manual via `update_prepare.sh` / `update.sh` | Mixed |
| Hardware (On-Prem) | n/a | Physical appliance with GPUs required for Layers 1 & 2; virtual appliance supports Layers 3 & 4 only | n/a |
| Integration Mode | Inline proxy | Inline proxy + API Gateway Mode | API Gateway Mode (Kong, Apigee), out-of-band analytics |

### A.5 Supported AI Providers

**Cloud / hosted (datasheet):** OpenAI (GPT-4, GPT-3.5-Turbo, GPT-4o, GPT-4.1) · Anthropic (Claude 3 Opus / Sonnet / Haiku, Claude-3-7 Sonnet) · Google Gemini (Pro, Ultra, 2.5 Flash) · xAI (Grok, Grok-3) · Mistral AI · DeepSeek · Meta Llama · Azure OpenAI · AWS Bedrock · Groq · Cohere · Together AI · Perplexity · Fireworks AI · Ollama · Any OpenAI-API-compatible provider.

**Local & On-Premise:** Ollama (local runtime) · LM Studio (desktop LLM runner) · Jan.ai (open-source LLM client) · Custom / Private self-hosted models · APIRE **Local AI Appliances** (organization-hosted AI models inside the org network — enables true air-gapped operation). On-Premise endpoint list also includes **Zed**.

### A.6 Compliance

**Compliance-by-design** (PDFs):
- **EU AI Act** — explicit Article mapping: Art. 10 (Data Governance → Data Leakage Fortress), Art. 14 (Human Oversight → Auto/Manual tuning + audit trails + override), Art. 15 (Accuracy/Robustness/Cybersecurity → AI Threat Protection Shield), Art. 52 (Transparency → Content Safety Shield + audit logging).
- **NIS2 Directive** — out-of-the-box compliance for 160,000+ affected EU entities.
- **GDPR** — zero-retention removes the primary object of regulation; no breach notification or residency triggers from APIRE itself.
- **HIPAA** — PHI processed ephemerally, never stored; inline masking before reaching AI.
- **PCI-DSS** — cardholder data masked/blocked before processing; pre-built templates.
- **SOX** — audit trails + reporting dashboards for financial governance.

Compliance badges on the datasheet: **GDPR · HIPAA · PCI-DSS · EU AI ACT · NIS2 · SOX**.

### A.7 Zero-Retention Architecture (ZRA) — Exact Definition

Foundational philosophy: **"Process Everything. Keep Nothing. Protect Always."** (also rendered "Process Everything. Store Nothing. Protect Always.")

- All data processing (threat detection, content safety, data masking) occurs **exclusively in volatile memory (RAM)**.
- Data exists only for the **milliseconds** required for inspection.
- Data is **instantly and irrevocably erased** upon completion.
- **No storage** in logs, caches, databases, or backup systems.
- **No data used for AI training. No data lake exposure.** Full audit trail is built **from metadata only** — privacy by design.
- Combined with a **Zero Trust** security posture — every request verified, and even if defenses are bypassed, "there is nothing to steal."

### A.8 Pricing Tiers / Plans (Cloud)

| Plan | Monthly API Requests | AI Credits | Protection Rules | Applications | Support |
|---|---|---|---|---|---|
| Free | 1,000 | 2,500 | 5 | 1 | Community Forum |
| Onboard | 5,000 | 12,500 | 10 | 1 | Community Forum |
| Standard | 10,000 | 25,000 | 15 | 1 | Community Forum |
| Growth | 25,000 | 50,000 | 30 | 1 | Web Portal & Email |
| Advanced | 100,000 | 125,000 | 50 | 20 | Web Portal & Email |
| Enterprise | 500,000 | 250,000 | 100 | 100 | Web Portal & Email |
| Enterprise+ | Custom | Custom | Custom | Custom | Dedicated Support + LDAP Integration |

All tiers include: DLP, Security Analytics Dashboards, Cost Management, and the complete security pipeline (encoding protection, threat detection, content safety, pattern protection, data masking).

**Credit thresholds:** below 1,000 → "Credit Attention"; at 0 → "Credit Over" (AI-powered Content Safety + AI Threat Detection are suspended; other layers continue).

**On-Premise licensing:** license key governs features, tenant limits, application limits, rule allocations, support tier, duration (perpetual or term).

### A.9 Roles

**Cloud:**
- **Platform Admin** — system-wide / cross-organizational administration (Cloud Admin Portal only).
- **Tenant Admin** — org-level full admin (applications, policies, billing, user provisioning).
- **Tenant User** — read-only analytics, request logs, Playground access; no config changes.
- **Reseller** — Wholesaler portal access for activation code management and credit allocation.

**On-Premise (Keycloak-backed):** same Tenant Admin / Tenant User model, plus a dedicated **Platform Admin Portal** (separate from the Customer Portal) governing tenants, license, AI appliances, integrations, logging, updates.

### A.10 Integrations

- **API:** drop-in OpenAI-compatible endpoint (`POST /v1/chat/completions`); supports streaming; full provider-native response schemas.
- **Webhooks:** HTTPS POST event delivery, optional shared-secret signature; payload includes `event_type`, `detection_type`, `application_id`, `organization_id`, `request_id`, `matched_value`, `action`, `timestamp`.
- **Alert Rules:** Email + Webhook channels, filtered by detection type, application, severity threshold.
- **LDAP / Active Directory:** Enterprise+ on Cloud; standard on On-Prem (Settings → LDAP); 3-step wizard (Connection & Auth → Synchronization → Cache Policy); Bind types (`simple` / `none`); Edit modes (`READ_ONLY` / `WRITABLE` / `UNSYNCED`); Cache policies (`DEFAULT` / `EVICT_DAILY` / `EVICT_WEEKLY` / `MAX_LIFESPAN` / `NO_CACHE`).
- **SIEM / Syslog (On-Prem):** UDP, TCP, TLS; RFC 5424 and RFC 3164 message formats; APIRE **Log Appliance** product for collection, forensics, and SIEM webhook integration.
- **mTLS / client certs (On-Prem):** supported for environments requiring cryptographic client verification.
- **Identity (On-Prem):** Keycloak (OIDC) with LDAP/AD.
- **DevSecOps (On-Prem):** Infrastructure-as-Code support, **Terraform module**.
- **API Gateway Mode (Hybrid):** integrates with **Kong** and **Apigee**.
- **Policy import/export:** JSON-based.
- **Playground:** in-dashboard interactive API testing without code integration.

### A.11 Performance / Latency / Stats Claims

- **<5 minutes** to deploy / "from zero to protected in under 5 minutes" / under-5-minute installation and activation.
- **Sub-millisecond latency impact** per stage; total pipeline within milliseconds.
- **100K+ attack vectors** detected by Layer 0 (Sentinel).
- **950+ pre-configured DLP rules** (PII, PHI, PCI, API keys, credentials, IP) covering **150+ data types**.
- **0% false negative rate** on critical data (Layer 4) and **0% false negatives** on configured patterns (Layer 3).
- **26+ encoding attack vectors** mitigated; **13-stage normalization pipeline**; **≤3 levels nested encoding recursion**.
- **27+ AI-specific threats** (5 core + 8 advanced + 14 content safety categories overlap).
- **32+ language support** (Layer 1 Content Safety).
- **2,500+ daily AI threats** (datasheet hero stat).
- **Industry context stats (datasheet hero):** 67% YoY increase in AI-specific attacks (prompt injection & jailbreak volume); $4.2M average cost per AI-related data breach (+45% annually); 89% of enterprises lack purpose-built AI security.

---

## B) NEW CAPABILITIES (Not in old marketing — must be added)

These appear in the technical / latest-architecture docs and are likely missing or under-represented in the older marketing docs:

1. **Layer 0: Sentinel — AI-Powered Gateway** — perimeter gateway with 100K+ attack-vector detection, continuously AI-updated. Reframes the "4-layer" story as **5-layer**.
2. **On-Premise as a distinct product line** — physical/virtual appliance, air-gapped operation, Bring Your Own Key (BYOK), Terraform IaC, Platform Admin Portal, Keycloak-based identity, license-key model.
3. **Local AI Appliances** — run AI models on-prem inside the organizational network; enables true air-gap; same 5-layer security applies to local-model traffic.
4. **Hybrid Deployment** — formal third option (cloud + on-prem combined). **API Gateway Mode** for Kong/Apigee. Run proxy in cloud while hosting Secure Chat + Log Appliance on-prem.
5. **Full Product Suite (datasheet):**
   - **APIRE Security Proxy** (the core)
   - **APIRE Secure Chat** — ChatGPT-style end-user chat for employees with all 5 layers, AD/LDAP identity, monitoring/logging; positioned as Shadow-AI killer.
   - **APIRE Browser Agent** — browser-level protection extending the 5 layers to any web AI tool (ChatGPT, Claude, Gemini, etc.); centrally managed via APIRE Security Dashboard.
   - **APIRE Log Appliance** — dedicated AI security event collection, webhook → SIEM, optional full payload logging for forensics, complete audit trail for regulatory compliance.
6. **Risk surfaces covered** — explicit framing of AI Chat Interfaces, Developer IDE & Coding Agents, Enterprise Application AI, and Chatbots/RAG/MCP Agents as protected surfaces.
7. **Expanded AI-provider matrix** — beyond OpenAI/Anthropic/Google: Mistral, Meta Llama, Azure OpenAI, AWS Bedrock, Groq, Cohere, Together AI, Perplexity, Fireworks AI, Ollama, LM Studio, Jan.ai, Zed (on-prem), and any OpenAI-compatible API.
8. **Visual rule builder** for Layer 4 DLP — no regex expertise required.
9. **Auto-tuning + manual tuning** for AI Threat Protection (Layer 2) — adapts to customer threat landscape automatically.
10. **Inline data masking + anonymization** (not just masking) at Layer 4, with response-time **role-based data restoration** so authorized users see unmasked content.
11. **Multi-vector attack correlation engine** — explicit amplification: 2 categories +10%, 3 +20%, 4+ +40%.
12. **6-tier risk classification** (NO_RISK → CRITICAL) with numeric score ranges.
13. **Subscription plan structure refreshed** — 7 named tiers (Free, Onboard, Standard, Growth, Advanced, Enterprise, Enterprise+); "Enterprise+" includes LDAP and dedicated support.
14. **Activation codes** for Enterprise+ credit allocation (Wholesaler/Reseller channel).
15. **Compliance set extended** to: GDPR, HIPAA, PCI-DSS, EU AI Act (with article mapping), NIS2 (with 160k EU entity scope), SOX.
16. **Detection-classification taxonomy in audit logs**: AI Content Safety / AI Threat Protection / Pattern Protection / Data Masking — used in analytics filters and webhook payloads.

---

## C) WHAT THE PRODUCT IS NOT (claims in old marketing that may be outdated / unverifiable)

Items that older marketing docs may assert but that are **not in the current technical docs**, and therefore should be flagged `[UNVERIFIED - confirm with Baran]`:

1. **Specific customer names / case-study results** — no customer logos, named deployments, ROI numbers, or case studies appear in the technical docs.
2. **Specific revenue, ARR, employee headcount, funding history, or pipeline numbers** for APIRE the company.
3. **Specific competitor names beyond positioning context** — technical docs don't compare APIRE to Lakera, Prompt Security, SentinelOne, etc.
4. **Specific industry-vertical guarantees** (e.g., "FedRAMP authorized", "SOC 2 Type II certified", "ISO 27001 certified") — none of these certifications are listed in the technical docs; only EU AI Act / NIS2 / GDPR / HIPAA / PCI-DSS / SOX *alignment* (not formal certification) appears.
4b. **"4-layer defense"** as a fixed brand — the new framing is **5 layers** (Sentinel + 4 detection layers). Old "4-layer" content should be updated to 5-layer, while preserving the four detection-layer story for depth sections.
5. **Latency numbers in absolute milliseconds** beyond "sub-millisecond per stage / within milliseconds total" — anything specifying e.g. "<10ms p99" or "<50ms" is not in the technical docs.
6. **Throughput claims (RPS / QPS)** — no specific RPS/QPS numbers in technical docs.
7. **Specific dollar pricing per credit or per request** — credit and request counts per plan are documented; **dollar prices are not** in the technical docs.
8. **Specific SLA guarantees** (e.g., "99.99% uptime") — no SLA figures in technical docs.
9. **Specific employee / team / partner names** — not in technical docs.
10. **"24/7 phone support"** — support tiers are "Community Forum", "Web Portal & Email", "Dedicated Support" (Enterprise+); phone support is not specifically mentioned.
11. **Industry analyst recognition (Gartner Magic Quadrant, Forrester Wave, etc.)** — not present.
12. **Customer-numeric claims** like "trusted by 500+ enterprises" — not in technical docs (datasheet says "Join organizations already protecting their AI stack with APIRE" with no count).
13. **Older threat counts** — if old marketing says "blocks 15 threats" or "10 categories", the current figure is **27+** threats (5 core + 8 advanced + 14 content safety overlap) and **9 default threat categories** in the dashboard. **2,500+ daily AI threats** is the datasheet's traffic stat (not a category count).
14. **"3-layer" or "4-layer" architecture** as the headline — current headline is **5-layer**.
15. **Old DLP rule counts** (e.g., "200+ rules" or "500+ rules") — current is **950+ rules across 150+ data types**.
16. **Older deployment-time claims** (e.g., "deploys in 30 minutes") — current is **<5 minutes**.
17. **Old language coverage** numbers — current is **32+ languages** (Layer 1).
18. **Old content-safety category counts** — current is **14 categories**.

---

End of Phase 1 facts. These are the canonical numbers and feature lists every rewritten marketing doc must align to.
