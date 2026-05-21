# Deployment Models, Integration, and Supported AI Providers

**What this file contains:** The three deployment models (Cloud, On-Premise, Hybrid), the three-step integration process, the full enumerated list of supported AI providers (cloud and local), hardware requirements for on-premise, operating modes, and the role/identity model. Content about "how do I deploy APIRE" or "which AI providers does APIRE support" should pull from here.

**Sources:**
- `APIRE AI Security Platform Datasheet_2026.pdf` (visual transcription)
- `APIRE_Solution_Architecture_Document.pdf` v2.1
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `APIRE_ AI Security & Governance Platform Briefing.docx`
- `Implementation Proposal_ Securing Enterprise AI with the APIRE.docx`
- `APIRE.IO_ Competitive Analysis in the AI Security Market.docx`
- `PRODUCT-FACTS-EXTRACTED.md`

---

## Three deployment models

### 1. Cloud Deployment (CLOUD FIRST)

**Description (exact from datasheet):** Instant activation — zero infrastructure. Ready-to-use with global AI providers. Credit and subscription-based.

**Key characteristics:**
- Immediate deployment via transparent security proxy on a global edge network (Cloudflare)
- Zero infrastructure requirements or maintenance
- Activation method: API endpoint URL change (`api.openai.com` → `app.apire.io`)
- All four detection layers + Layer 0 Sentinel included
- Licensing: Credit-based consumption model (pay-as-you-go)
- Enterprise features: Multi-tenant capabilities, AD integration, user-based monitoring and quota limiting (Enterprise+)
- Includes APIRE Security Proxy + APIRE Secure Chat
- Automatic updates
- Dedicated and closed LLM models available

### 2. On-Premise Deployment

**Description (exact from datasheet):** Complete data sovereignty with air-gapped security. Physical or virtual appliance. Bring Your Own Key.

**Status:** Available now (v2.32.44 referenced in Competitive Playbook). Earlier docs cited "Available December 2025"; current implementation has shipped.

**Key characteristics:**
- Deployed as physical or virtual appliance inside customer infrastructure
- Maximum data sovereignty — data never leaves customer infrastructure
- Supports air-gapped LAN operation
- Bring Your Own Key (BYOK) support
- AD / LDAP identity integration (Keycloak-based)
- Local LLM support (organization-hosted models inside the org network)
- Any OpenAI-API-compatible provider supported, including local and private models
- DevSecOps integration: Infrastructure-as-Code support, **Terraform module** available
- Manual updates via `update_prepare.sh` / `update.sh`
- Licensing: Base license fee + per-request fee
- Data Logging and Identity Integration features included

### 3. Hybrid Deployment

**Description (exact from datasheet):** On-premise and cloud operating together. Unified policy, consistent security across any topology.

**Status:** Available now. Earlier docs cited "Available December 2025"; current implementation has shipped.

**Key characteristics:**
- Cloud + on-premise simultaneously
- Virtual appliance on-premise
- AI Brain provided from cloud
- Unified management and logging
- Seamless failover and scaling
- **API Gateway Mode** — integrates with existing API management solutions (**Kong**, **Apigee**)
- Can run API proxy in cloud while hosting Secure Chat interface and Log Appliance on-premise
- Licensing: Combination of credit-based (cloud) and subscription-based (on-premise license)

---

## On-Premise hardware requirements (important caveat)

- **Physical appliance with GPUs is required for Layers 1 (Content Safety Shield) and 2 (AI Threat Protection Shield)** — these are AI-powered.
- **Virtual appliance** supports **Layers 3 and 4 only** (Multi-Word Pattern Protection and Data Leakage Fortress).
- An on-premise deployment using only Layers 3 and 4 can run on a virtual appliance; full 5-layer protection requires the GPU-backed physical appliance.

---

## Operating modes

- **IN-LINE PROTECTION** — Real-time proxy. All AI traffic analyzed and filtered before reaching the provider.
- **OUT-OF-BAND ANALYTICS** — Analytics appliance integrated via API with existing SIEM and security tooling.
- **MULTI-TENANT SUPPORT** — Both Security Proxy and Secure Chat support full multi-tenancy with per-tenant policy control.

---

## The three-step integration ("Frictionless 3-Step Integration")

> **From zero to protected in under 5 minutes.**

### Step 01 — Sign Up & Get API Key
- Create an account at `apire.io/signup`
- Receive a unique API key instantly
- Choose plan
- No credit card required (Free tier)

### Step 02 — Change API URL
- One-line change in application code
- Fully OpenAI SDK compatible — nothing else to modify
- Old: `api.openai.com`
- New: `app.apire.io`
- `// That's it.`

### Step 03 — Configure & Go Live
- Set protection preferences
- Add custom rules
- Configure masking policies
- Deploy
- Go live ✓

### Key integration advantages

- **Zero code changes required** — no SDK modifications or architectural rework
- **100% API compatibility** — maintains full compatibility with existing AI provider APIs, authentication, and SDKs
- **Instant activation** — protection is active immediately upon configuration
- **Zero learning curve** — development teams continue to use familiar tools, libraries, and workflows
- **Minimal latency** — real-time processing with sub-millisecond impact per stage; total pipeline within milliseconds

---

## Supported AI Providers

### Global Cloud Providers (16 explicitly listed on datasheet)

1. OpenAI (GPT-4, GPT-3.5-Turbo, GPT-4o, GPT-4.1)
2. Anthropic (Claude 3 Opus / Sonnet / Haiku, Claude-3-7 Sonnet)
3. Google Gemini (Pro, Ultra, 2.5 Flash)
4. xAI (Grok, Grok-3)
5. Mistral AI
6. DeepSeek
7. Meta Llama
8. Azure OpenAI
9. AWS Bedrock
10. Groq
11. Cohere
12. Together AI
13. Perplexity
14. Ollama
15. Fireworks AI
16. **Any OAI API** — any OpenAI-API-compatible endpoint

### Local & On-Premise providers (4 explicitly listed)

1. **Ollama** — Local model runtime
2. **LM Studio** — Desktop LLM runner
3. **Jan.ai** — Open-source LLM client
4. **Custom / Private** — Any self-hosted model

### Additional on-premise support

- **Zed** is also listed in the On-Premise endpoint inventory.
- **APIRE Local AI Appliances** — organization-hosted AI models inside the org network, enabling true air-gapped operation. Same 5-layer security applies to local-model traffic.

---

## Role-based access model

### Cloud roles

- **Platform Admin** — System-wide / cross-organizational administration (Cloud Admin Portal only)
- **Tenant Admin** — Org-level full admin (applications, policies, billing, user provisioning)
- **Tenant User** — Read-only analytics, request logs, Playground access; no config changes
- **Reseller** — Wholesaler portal access for activation code management and credit allocation

### On-Premise roles (Keycloak-backed)

- Same Tenant Admin / Tenant User model as Cloud
- Plus a dedicated **Platform Admin Portal** (separate from Customer Portal) governing tenants, license, AI appliances, integrations, logging, updates
- LDAP / AD integration with 3-step wizard (Connection & Auth → Synchronization → Cache Policy)
- Bind types: `simple` / `none`
- Edit modes: `READ_ONLY` / `WRITABLE` / `UNSYNCED`
- Cache policies: `DEFAULT` / `EVICT_DAILY` / `EVICT_WEEKLY` / `MAX_LIFESPAN` / `NO_CACHE`

---

## Recommended implementation approach (3 phases)

### Phase 1 — Scoping & Technical Deep-Dive
Collaborative workshop with APIRE solutions architects to:
- Discuss specific enterprise use cases (developer IDE copilots, internal chatbots, customer-facing applications)
- Align on optimal deployment model (Cloud, On-Premise, or Hybrid)
- Review detailed integration requirements

### Phase 2 — Proof of Concept (POC)
Structured, time-boxed evaluation (typically 4 weeks):
- Deploy in controlled environment with pre-defined success criteria
- Validate against security, compliance, and operational objectives
- Comprehensive testing of all four detection layers against real-world scenarios

### Phase 3 — Enterprise Rollout
- Prioritize based on POC findings and risk assessment
- Start with highest-risk applications or greatest immediate value
- Expand coverage across business units systematically

---

## Performance and latency claims

- **<5 minutes** to deploy / "from zero to protected in under 5 minutes"
- **Sub-millisecond latency impact** per stage; total pipeline within milliseconds
- **100K+ attack vectors** detected by Layer 0 (Sentinel)
- **2,500+ daily AI threats** observed
- **32+ language support** (Layer 1 Content Safety)

## Contradictions / things to flag

- **On-Prem and Hybrid availability dates:** Some materials still cite "Available December 2025" — current Implementation Proposal and Competitive Playbook state these are **GA now** (On-Prem at v2.32.44). Use "available now" framing.
- **Endpoint host:** Use `app.apire.io` for cloud; `app.apire.ai` appears in some older docs (treat as historical/synonymous).
- **Edge network:** AI Security & Privacy Briefing mentions Cloud is delivered via "global edge network (Cloudflare)" — the implementation detail can be cited, but the Cloudflare specifically only appears in that one source.
- **Specific latency numbers in milliseconds:** Source material says "sub-millisecond per stage / within milliseconds total" but **does not cite specific p99 figures** (e.g., no "<10ms p99" claim). Don't fabricate latency numbers.
- **Throughput (RPS/QPS):** Not present in technical docs. Do not invent.
