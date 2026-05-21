# APIRE — Canonical Entity Lists

**What this file is:** Flat lists of every named entity (product, feature, layer, persona, threat category, framework, competitor, pricing tier) drawn from APIRE source material. **No prose.** The Brand Guardian validator uses this file as the ground-truth allow-list — if a generated draft references a name not in this list, it is flagged as a hallucination candidate for human review.

**Last updated from source documents:** May 2026.

---

## Product names

- APIRE
- APIRE.IO
- APIRE Security Proxy
- APIRE Secure Chat
- APIRE Browser Agent
- APIRE Log Appliance
- APIRE Local AI Appliances
- APIRE Security Dashboard
- APIRE Admin Portal
- Platform Admin Portal
- Customer Portal
- Wholesaler portal

## Defense layers (canonical 5-layer system)

- Layer 0 — Sentinel — AI-Powered Gateway
- Sentinel
- Layer 1 — Content Safety Shield
- Layer 2 — AI Threat Protection Shield
- Layer 3 — Multi-Word Pattern Protection
- Layer 4 — Data Masking Fortress
- Layer 4 — Data Leakage Fortress
- Four-Layer Defense System (older framing; still referenced)
- Five-Layer Defense System (current canonical framing)
- Multi-Layer AI Defense System
- 11-stage security pipeline

## Architectural concepts

- Zero-Retention Architecture
- ZRA
- Zero Trust + Zero Retention
- Zero-Touch Deployment
- Privacy-First by Design
- Compliance-by-Design
- Memory-Only Execution
- Ephemeral Data Lifecycle
- Minimal Data Footprint
- Multi-Vector Correlation Engine
- Semantic Threat Analysis
- Threat Correlation Engine
- Zero-Day Defense
- Transparent Security Proxy
- API Gateway Mode
- Bring Your Own Key
- BYOK

## Personas

- Claudia Weiss — Compliance-First CISO, Tier-1 Financial Services, Frankfurt, Germany
- Ben Park — Builder CTO, Series A SaaS Company, Austin TX
- Priya Natarajan — Principal DevSecOps Architect, Pan-EU Healthcare Provider, London UK

## Layer 1 — 14 Content Safety Categories

- Violent Crimes
- Non-Violent Crimes
- Indiscriminate Weapons
- Sex-Related Crimes
- Child Sexual Exploitation
- CSAM
- Hate Speech
- Suicide & Self-Harm
- Defamation
- Sexual Content
- Specialized Advice
- Elections
- Privacy Violations
- Intellectual Property
- IP Theft (used as Layer 1 category synonym in some materials)
- Code Interpreter Abuse
- Misinformation (appears in some older briefings)

## Layer 2 — 5 Core AI Threat Categories

- Prompt Injection
- Jailbreaking
- Data Exfiltration
- Social Engineering
- Model Inversion

## Layer 2 — 8 Advanced AI Threat Categories

- Adversarial Attacks
- Compliance Violations
- IP Theft
- Shadow AI Usage
- API Security
- Content Abuse
- Business Logic Attacks
- Context Attacks

## Layer 4 — 12 Data Leakage Detection Categories

- PII (Personal Data)
- PHI (Health Information)
- PCI (Payment Card Data)
- Company Confidential & IP
- Financial Information
- Credentials & API Keys
- EU GDPR Data
- Regulatory Obligations
- Indicators of Compromise
- Suspicious Activity
- Acceptable Use
- Custom — User Defined

## Risk classification tiers (Layer 2 — 6 tiers)

- NO_RISK (0.00–0.15)
- MINIMAL (0.15–0.30)
- LOW (0.30–0.50)
- MEDIUM (0.50–0.65)
- HIGH (0.65–0.80)
- CRITICAL (0.80–1.00)

## Severity scoring (Layer 1)

- Critical
- High
- Medium

## Policy enforcement actions

- AUDIT
- PREVENTION

## Detection classification taxonomy

- AI Content Safety
- AI Threat Protection
- Pattern Protection
- Data Masking

## Encoding attack vectors (Layer 0 / pipeline stages 2-3)

- Base64
- URL Encoding
- Percent Encoding
- HTML Entity Encoding
- Unicode Homoglyphs
- Invisible Unicode
- Nested Encoding
- Token Boundary Exploitation
- Bidirectional Text Override
- Combining Character Stacking
- Markdown Injection
- ROT13
- Caesar Cipher
- Leetspeak
- Null Byte Injection

## Deployment models

- Cloud Deployment
- On-Premise Deployment
- Hybrid Deployment

## Operating modes

- In-Line Protection
- Out-of-Band Analytics
- Multi-Tenant Support

## Supported AI providers — Global Cloud

- OpenAI (GPT-4, GPT-3.5-Turbo, GPT-4o, GPT-4.1)
- Anthropic (Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku, Claude-3-7 Sonnet)
- Google Gemini (Pro, Ultra, 2.5 Flash)
- xAI (Grok, Grok-3)
- Mistral AI
- DeepSeek
- Meta Llama
- Azure OpenAI
- AWS Bedrock
- Groq
- Cohere
- Together AI
- Perplexity
- Ollama
- Fireworks AI
- Any OAI API (any OpenAI-compatible endpoint)

## Supported AI providers — Local & On-Premise

- Ollama
- LM Studio
- Jan.ai
- Zed (on-prem endpoint list)
- Custom / Private (any self-hosted model)

## Pricing tiers (Cloud) — 7 tiers

- Free
- Onboard
- Standard
- Growth
- Advanced
- Enterprise
- Enterprise+

## Credit states

- Normal
- Credit Attention (below 1,000 credits)
- Credit Over (0 credits — Layers 1 and 2 suspended)

## Role names

- Platform Admin
- Tenant Admin
- Tenant User
- Reseller

## Compliance frameworks (datasheet badge list)

- GDPR
- HIPAA
- PCI-DSS
- EU AI Act
- NIS2
- SOX

## EU AI Act articles mapped by APIRE

- Article 10 — Data & Data Governance
- Article 14 — Human Oversight
- Article 15 — Accuracy, Robustness & Cybersecurity
- Article 52 — Transparency

## Additional compliance frameworks referenced

- SOC 2 (alignment, not certified)
- ISO 27001 (alignment, not certified)
- OWASP Top 10 for LLM Applications

## Identity / auth integrations

- LDAP
- Active Directory
- AD/LDAP
- Keycloak (OIDC)
- SSO
- RBAC
- mTLS / Client Certificates
- Multi-Factor Authentication

## SIEM / Syslog protocols and formats

- UDP
- TCP
- TLS
- RFC 5424
- RFC 3164

## Integration interfaces

- REST API
- POST /v1/chat/completions
- OpenAI-compatible API
- Webhooks
- HTTPS POST
- Alert Rules
- Policy import/export (JSON)
- Playground (in-dashboard testing)

## DevSecOps integrations

- Terraform
- Infrastructure-as-Code (IaC)
- CI/CD
- GitOps

## API Gateway integrations (Hybrid)

- Kong
- Apigee

## Built-in DLP detector examples

- Turkish TCKN
- Credit Card (Luhn-validated)
- Email
- Phone
- IPv4
- IPv6

## Direct competitors named in source material

- Lakera AI
- Lakera Guard
- Lakera Red
- Gandalf (Lakera's red team game)
- Prompt Security
- Robust Intelligence
- Protect AI
- CalypsoAI
- HiddenLayer
- WhyLabs
- Lasso Security
- LLM Guard

## Acquirer / parent companies of competitors

- SentinelOne (acquired Prompt Security, Aug 2025, ~$180M)
- Check Point Software (acquired Lakera, Sept 2025, ~$300M)
- Palo Alto Networks (acquired Protect AI, 2025)
- F5 Networks (Prompt Security partner)
- Okta (Prompt Security partner)
- Microsoft (Prompt Security partnership for M365 Copilot)

## Traditional security vendors mentioned

- CrowdStrike
- Palo Alto Networks
- Microsoft
- Wiz
- Splunk
- Azure
- AWS
- Azure AI Content Safety
- AWS Bedrock guardrails

## Brand colors (canonical)

- Deep Blue #060C2E
- White #FFFFFF
- Bright Blue #18A4FB
- Light Blue #60CFFF
- Light Gray #F5F6FA
- Black #000000
- Medium Gray #6B7280
- Success Green #10B981
- Warning Orange #F59E0B
- Error Red #EF4444
- Info Blue #3B82F6
- Dark Blue (background gradient end) #0A1854

## Typography

- Inter (primary typeface, geometric sans-serif, Open Font License)
- JetBrains Mono (code typography)
- Fira Code (code typography alternative)

## Domains and endpoints

- apire.io
- www.apire.io
- app.apire.io
- app.apire.ai (alternate, used in some older docs)
- apire.io/signup
- api.openai.com (replaced by app.apire.io)

## Contact emails

- sales@apire.io
- info@apire.io
- be@ofsecman.io (brand owner contact)

## Software / version references

- v2.32.44 (On-Premise GA version, cited in Competitive Playbook)
- update_prepare.sh (On-Premise update script)
- update.sh (On-Premise update script)

## Key statistical claims (verified — safe to cite)

- 5 defense layers
- 27+ threat categories
- 14 content safety categories
- 13 AI-specific threats (5 core + 8 advanced)
- 12 data leakage categories
- 100K+ attack vectors (Layer 0)
- 950+ DLP rules
- 150+ data types
- 32+ languages
- 26+ encoding attack vectors
- 13-stage encoding normalization
- 11-stage security pipeline
- 3 levels nested encoding recursion
- <5 minutes deployment
- 2,500+ daily AI threats observed
- 67% YoY increase in AI-specific attacks
- $4.2M average AI breach cost
- 45% annual breach cost growth
- 89% of enterprises lack purpose-built AI security
- 86% of companies had AI security incidents
- 8.5% of prompts contain sensitive data
- $670,000 higher breach cost with shadow AI
- 98% of employees use unsanctioned AI
- 160,000+ NIS2 entities
- €10 million NIS2 fines (or 2% global turnover)
- 90% of orgs implementing or planning LLM use cases
- 78% of global companies use AI
- 71% use generative AI regularly
- 68% of European businesses struggle with EU AI Act
- 75% of orgs using shadow AI lack governance
- 40% of EU IT spending goes to compliance

## TAM / SAM / SOM projections

- TAM 2025: $25.2 billion
- TAM 2032: $50.4 billion
- TAM CAGR: 25%
- SAM 2025: $8.1 billion
- SAM 2032: $16.2 billion
- SOM Year 1-2: $20-35M / 100-200 customers
- SOM Year 3: $120-180M / 500-1,000 customers
- SOM Year 5: $250-400M / 1,200-2,000 customers

## Canonical taglines (use these exactly)

- AI Security Without Friction
- Process Everything. Keep Nothing. Protect Always.
- Process Everything. Store Nothing. Protect Always.
- The Future of AI Security Starts Here
- Stop AI Threats. Start Securing What Matters.
- Deploy AI security in 5 minutes. Zero code changes. Real-time control. Keep shipping, safely.
- SECURE AI IN MINUTES. ZERO CODE. REAL-TIME CONTROL.
- Keep shipping, safely.

## Persona-specific messaging hooks

- (Claudia) Prove EU AI Act / NIS2 compliance. Stop PII leaks. One platform, zero code changes.
- (Ben) 5-minute drop-in AI security. No code changes. Multi-LLM, cost analytics, content safety.
- (Priya) Policy-as-code, Terraform modules, SIEM / SSO / RBAC. Real-time masking and threat protection.

## DO NOT CITE — entities that are NOT verified

These appear in source material but are flagged as unverified. Brand Guardian should flag if generated content uses them:

- Specific named customers of APIRE (none confirmed)
- "Major banks" / "Largest airline in Turkey" as customer references — unverified
- 4-week POC with "major international airline" — unverified
- "Tier-1 European Bank" case study (archetypal, not real)
- "Pan-European Healthcare Provider" case study (archetypal, not real)
- "Series B SaaS Company" case study (archetypal, not real)
- "3.2 seconds to breach" stat — unverified
- SOC 2 Type II certification — not confirmed as held
- ISO 27001 certification — not confirmed as held
- FedRAMP authorization — not in source
- Gartner Magic Quadrant placement — none
- Forrester Wave placement — none
- 99.99% uptime SLA — not published
- Specific latency p99 numbers — not published
- 24/7 phone support — not in support tiers
- Specific APIRE customer count claims (e.g., "500+ enterprises") — not published
- Specific dollar pricing per credit / per request — not published
