# Unverified Claims — Things to Flag, Not Cite

**What this file contains:** Claims that appear in APIRE marketing source material but are **NOT supported by technical documentation** and have been flagged `[UNVERIFIED — confirm with Baran]` in source files. Content generation should NEVER use these without explicit confirmation. The Brand Guardian validator should check generated drafts against this list.

**Sources (where these claims appear):**
- `Competitive Playbook_ APIRE vs.docx`
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `Implementation Proposal_ Securing Enterprise AI with the APIRE.docx`
- `PRODUCT-FACTS-EXTRACTED.md` (which catalogs the unverified items in section C)

---

## Things that appear in marketing but should NOT be cited as facts

### Customer references and case studies

- **"Major banks" as customers** — No specific named bank confirmed.
- **"Largest airline in Turkey"** as a POC reference — flagged unverified.
- **"4-week POC with major international airline"** — flagged unverified.
- **Tier-1 European Bank case study** (NIS2 compliance, 3-week deployment, 0 leakage, 40% cost reduction) — archetypal template, not a real deployment.
- **Pan-European Healthcare Provider case study** (HIPAA, real-time PHI masking) — archetypal template.
- **Series B SaaS Company case study** (passed 10+ enterprise reviews, 0 PII incidents, 30% cost savings) — archetypal template.
- **Customer logos** in general — APIRE has not published a customer list. Don't cite specific company names as APIRE customers.

### Specific business metrics

- **Customer counts** ("500+ enterprises", "trusted by X organizations", "100 customers", "Fortune 500 customers") — none are in technical docs.
- **Specific ARR / MRR / revenue figures** — not published.
- **Employee headcount** — not published.
- **Funding history / investor list** — not in technical docs.
- **Pipeline numbers** — not published.

### Performance numbers

- **"3.2 seconds to breach"** — appears in AI Security & Privacy Briefing and Implementation Proposal; flagged `[UNVERIFIED]`. Do not use.
- **Specific latency in milliseconds** (e.g., "<10ms p99", "<50ms total") — source material says "sub-millisecond per stage / within milliseconds total" but does not cite specific p99 numbers.
- **Throughput claims** (RPS / QPS) — none in source.
- **Specific SLA percentages** (e.g., "99.99% uptime guarantee") — "99.9% uptime" appears only as a *target*, not a published SLA.

### Certifications and audits

- **SOC 2 Type II** — not confirmed as completed. Appears as an "alignment target" or evaluation criterion but not a held certification.
- **ISO 27001** — same; not confirmed as held.
- **FedRAMP authorized** — not present in source material.
- "Penetration test results" — referenced as available but specifics not in source.

### Analyst recognition

- **Gartner Magic Quadrant placement** — not present.
- **Forrester Wave placement** — not present.
- **IDC MarketScape placement** — not present.
- (Note: Lakera is named in Gartner AI TRiSM 2025 and Prompt Security in Gartner Cool Vendors 2025 — APIRE has no such named recognition in source material.)

### Support claims

- **"24/7 phone support"** — not in source. Support tiers documented as: Community Forum, Web Portal & Email, Dedicated Support (Enterprise+). Phone support is not specifically named.

### Pricing

- **Specific dollar prices per credit or per request** — not published.
- **Specific contract values** — ranges ($25k–$500k) are aspirational, not posted.

### Threat / detection accuracy

- **"99%+ detection accuracy"** as a published number — source material says "very high detection accuracy" and "0% false negatives on critical data" but does not publish overall detection accuracy percentage.
- **"0% false positives"** — appears for **configured patterns** (Layer 3) and **on critical data** (Layer 4), not as a general claim.

### Generic competitor smear

- "Their architecture has these specific weaknesses" type claims about competitors not in source material — only cite the weaknesses documented in `competitive-landscape.md`.

---

## Numbers that are real (use freely)

For contrast, the following numbers ARE supported by technical source documentation and can be cited:

- 5 defense layers (Sentinel + 4 detection)
- 27+ threat categories (14 + 5 + 8)
- 14 Content Safety categories
- 5 Core AI threats + 8 Advanced AI threats = 13 AI-specific threats
- 12 Data Leakage categories
- 100K+ attack vectors (Layer 0)
- 950+ DLP rules
- 150+ data types
- 32+ languages
- 26+ encoding attack vectors
- 13-stage encoding normalization pipeline
- 11-stage technical security pipeline
- 3 levels of nested encoding recursion
- 5-minute deployment
- 2,500+ daily AI threats observed
- 67% YoY increase in AI-specific attacks
- $4.2M average AI breach cost (+45% annually)
- 89% of enterprises lack purpose-built AI security
- 160,000+ NIS2 entities
- €10M / 2% turnover NIS2 fines
- 86% of companies had AI security incidents
- 8.5% of prompts contain sensitive data
- $670,000 higher breach cost with shadow AI
- 98% of employees use unsanctioned AI
- 6 compliance frameworks (GDPR, HIPAA, PCI-DSS, EU AI Act, NIS2, SOX)
- 4 EU AI Act articles mapped (10, 14, 15, 52)
- 7 pricing tiers (Free, Onboard, Standard, Growth, Advanced, Enterprise, Enterprise+)
- 4 products in the suite
- 4 risk surfaces covered
- 3 deployment models
- 3 personas (Claudia, Ben, Priya)

---

## Brand Guardian directive

**The Brand Guardian validator should flag any generated content that contains:**

1. **A specific named customer** of APIRE (none are confirmed; flag for review)
2. **A "Fortune X" customer count** (e.g., "Fortune 500 customers", "trusted by 50 banks")
3. **The "3.2 seconds" breach figure**
4. **A specific SOC 2 / ISO 27001 / FedRAMP certification claim**
5. **A specific latency p99 number** (e.g., "<10ms", "<50ms")
6. **A specific QPS / RPS throughput claim**
7. **A "Gartner Magic Quadrant" or "Forrester Wave" placement** for APIRE
8. **A dollar-denominated pricing figure** (e.g., "$5,000 / month", "$0.01 per request")
9. **"24/7 phone support"** claim
10. **A specific customer revenue / employee count for APIRE**

When the Guardian flags one of these, the content should be re-generated without the unverified claim.
