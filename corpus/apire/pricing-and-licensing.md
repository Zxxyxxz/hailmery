# Pricing, Plans, and Licensing

**What this file contains:** All seven named pricing tiers with their exact quotas, the credit-based consumption model details, on-premise licensing model, plan-to-persona mapping, and the credit-attention / credit-over states. Generation about pricing should never invent dollar figures — source material does not include specific dollar prices, only request/credit/rule quotas.

**Sources:**
- `PRODUCT-FACTS-EXTRACTED.md` (canonical pricing table)
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `APIRE_Solution_Architecture_Document.pdf` v2.1
- `APIRE - Complete Brand Context Document.docx`

---

## Pricing tier table (Cloud) — exact quotas

| Plan | Monthly API Requests | AI Credits | Protection Rules | Applications | Support |
|---|---|---|---|---|---|
| **Free** | 1,000 | 2,500 | 5 | 1 | Community Forum |
| **Onboard** | 5,000 | 12,500 | 10 | 1 | Community Forum |
| **Standard** | 10,000 | 25,000 | 15 | 1 | Community Forum |
| **Growth** | 25,000 | 50,000 | 30 | 1 | Web Portal & Email |
| **Advanced** | 100,000 | 125,000 | 50 | 20 | Web Portal & Email |
| **Enterprise** | 500,000 | 250,000 | 100 | 100 | Web Portal & Email |
| **Enterprise+** | Custom | Custom | Custom | Custom | Dedicated Support + LDAP Integration |

**Every tier includes:**
- Data Loss Prevention (DLP)
- Security Analytics Dashboards
- Cost Management
- Complete security pipeline (encoding protection, threat detection, content safety, pattern protection, data masking)

## Credit consumption model (Cloud)

Customers purchase credit packages for a **one-year usage period**. Credits are consumed by AI provider routing (Layer 4 → AI provider) and AI-powered analysis (Layers 1 and 2 specifically).

### Credit state thresholds

- **Normal:** Above 1,000 credits remaining.
- **"Credit Attention"** state: Below 1,000 credits remaining → dashboard warning.
- **"Credit Over"** state: 0 credits remaining → AI-powered Content Safety (Layer 1) + AI Threat Detection (Layer 2) are **suspended**. Other layers (0, 3, 4) continue operating.

### What this means for customers

- Layer 3 (Multi-Word Pattern Protection) and Layer 4 (Data Leakage Fortress) are not credit-gated — they continue running regardless of credit state.
- Layers 1 and 2 use the proprietary AI models that consume credits; these are the layers that go offline if credits run out.
- Customers can still send traffic but lose AI-powered moderation and threat detection until credits are replenished.

## Enterprise+ — special features

The Enterprise+ plan is designed for large enterprises and includes:
- Custom quotas (requests, credits, rules, applications)
- Dedicated Support
- **LDAP / Active Directory Integration** (standard on Enterprise+ in Cloud; standard on all On-Prem deployments)
- Multi-tenant capabilities
- User-based monitoring and quota limiting

## On-Premise licensing model

On-Premise uses a different model:
- **Base license fee + per-request fee.**
- License key governs:
  - Features enabled
  - Tenant limits
  - Application limits
  - Rule allocations
  - Support tier
  - License duration (perpetual or term)
- The cost varies depending on whether the customer or APIRE provides the required hardware (Layers 1 and 2 require GPUs in a physical appliance).

## Hybrid licensing

Hybrid deployments combine:
- Credit-based usage for cloud components
- Subscription-based usage for on-premise license

## Reseller / Wholesaler model

- **Reseller role** has Wholesaler portal access for activation code management and credit allocation.
- Activation codes are used for Enterprise+ credit allocation through the channel.

## Plan-to-persona mapping (recommended)

| Persona | Likely Plan |
|---|---|
| Ben (Builder CTO, Series A SaaS) | **Starter** or **Growth** Plan |
| Priya (Principal DevSecOps Architect) | **Professional** or **Enterprise** Plan |
| Claudia (Compliance-First CISO, Tier-1 Financial Services) | **Enterprise** Plan |

Note: "Starter" and "Professional" appear in persona documents as plan names. The canonical 7-tier list above is from technical documentation. These are likely informal plan-name labels — when generating content for personas, refer to the canonical 7-tier names (Free / Onboard / Standard / Growth / Advanced / Enterprise / Enterprise+).

## Average contract value indicators (from GTM strategy)

The Marketing Strategy doc cites typical ACV ranges (informal):
- **Enterprise:** $200–500k
- **Mid-Market:** $75–150k
- **SMB:** $25–50k

These are aspirational targets, not posted prices.

## Pricing transparency stance

**APIRE positions itself as more pricing-transparent than its competitors.** Both Lakera and Prompt Security do not publish specific tier pricing — both are flagged as having "pricing transparency" as a competitive weakness. APIRE's published quota table (above) is a competitive positioning asset.

## What APIRE does *not* publish about pricing

- **Specific dollar prices per credit or per request** — not in technical docs.
- **Specific SLA guarantees** (e.g., "99.99% uptime") — not in technical docs.
- **"24/7 phone support"** — support tiers are Community Forum, Web Portal & Email, Dedicated Support (Enterprise+); phone support not specifically mentioned.

Do not fabricate dollar pricing.

## Contradictions / things to flag

- **"Starter" vs "Onboard":** Persona documents say Ben uses "Starter" plan; the technical pricing table doesn't list "Starter" — the entry-level tier is **Onboard** (5,000 requests). Treat "Starter" as informal shorthand; the canonical plan name is **Onboard**.
- **"Professional" plan name:** Persona docs say Priya could use "Professional"; the canonical tiers don't include "Professional" — the equivalent technical tier is **Advanced** or **Growth** depending on company size. When in doubt, use the canonical 7-tier names.
- Persona document plan-mapping language predates the formal 7-tier table. Reconcile by using the **canonical tier names** in any new content.
