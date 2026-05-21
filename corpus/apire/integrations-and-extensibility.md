# Integrations, APIs, and Platform Extensibility

**What this file contains:** Every external integration APIRE supports — REST API, webhooks, alert rules, LDAP/AD, SIEM/Syslog, mTLS, Keycloak, Terraform, API Gateway Mode, policy import/export, the Playground. For content about "how does APIRE integrate with [system X]".

**Sources:**
- `PRODUCT-FACTS-EXTRACTED.md` (canonical integration list)
- `APIRE_Solution_Architecture_Document.pdf` v2.1
- `APIRE.IO_ AI Security & Privacy Briefing.docx`
- `APIRE_ AI Security & Governance Platform Briefing.docx`

---

## REST API (the primary surface)

- **Endpoint shape:** Drop-in OpenAI-compatible: `POST /v1/chat/completions`
- **Streaming:** Supported
- **Response schemas:** Full provider-native (matches OpenAI / Anthropic / Gemini exactly)
- **Authentication:** Bearer token via API key (Cloud); Keycloak OIDC for On-Premise
- **The only change required:** Endpoint URL swap from `api.openai.com` → `app.apire.io`

---

## Webhooks

**Mechanism:** HTTPS POST event delivery.

**Optional signature:** Shared-secret HMAC signature for verifying webhook authenticity.

**Webhook payload fields:**
- `event_type`
- `detection_type`
- `application_id`
- `organization_id`
- `request_id`
- `matched_value`
- `action`
- `timestamp`

**Use cases:**
- SIEM forwarding (Splunk, QRadar, Sentinel, etc.)
- SOC alerting (PagerDuty, Opsgenie)
- Custom incident workflows
- Compliance event logging

---

## Alert Rules

**Channels:** Email + Webhook.

**Filters:**
- Detection type (Content Safety / AI Threat / Pattern / DLP)
- Application
- Severity threshold (Critical / High / Medium)

**Detection-classification taxonomy** used in alerts and analytics filters:
- AI Content Safety
- AI Threat Protection
- Pattern Protection
- Data Masking

---

## LDAP / Active Directory Integration

**Availability:**
- **Cloud:** Enterprise+ plan only
- **On-Premise:** Standard on all deployments

**Configuration:** 3-step wizard
1. **Connection & Auth** — Server URL, bind credentials, base DN
2. **Synchronization** — User and group sync mapping
3. **Cache Policy** — Cache invalidation behavior

**Bind types:**
- `simple` — basic LDAP authentication
- `none` — anonymous bind (read-only directories)

**Edit modes:**
- `READ_ONLY` — Sync from LDAP only
- `WRITABLE` — Bidirectional sync
- `UNSYNCED` — Manual

**Cache policies:**
- `DEFAULT` — Default refresh
- `EVICT_DAILY` — Refresh daily
- `EVICT_WEEKLY` — Refresh weekly
- `MAX_LIFESPAN` — Use max lifespan
- `NO_CACHE` — Always query LDAP

---

## SIEM / Syslog (On-Premise)

**Transports supported:**
- UDP
- TCP
- TLS (encrypted)

**Message formats:**
- **RFC 5424** (modern Syslog format)
- **RFC 3164** (BSD legacy Syslog format)

**Dedicated product for SIEM:** APIRE Log Appliance (see `product-suite-and-risk-surfaces.md`)
- Dedicated AI security event collection
- Webhook connector for SIEM and SOC integration
- Detection-based granular logging with full context
- Optional full payload logging for forensic analysis
- Complete audit trail for regulatory compliance

---

## Mutual TLS (mTLS) / Client Certificates (On-Premise)

Supported for environments requiring cryptographic client verification.

---

## Identity (On-Premise)

- **Keycloak** (OIDC) backed identity layer
- Integrated with LDAP / AD per LDAP configuration above
- Multi-factor authentication via Keycloak
- SSO via OIDC

---

## DevSecOps Integration

### Terraform module
APIRE provides a Terraform module for On-Premise deployments — enables:
- Infrastructure-as-Code provisioning
- Versioned, policy-as-code configuration
- CI/CD pipeline integration
- Auditable, reproducible deployments

### Policy import / export
- **Format:** JSON-based
- Policies are portable across environments (dev → staging → production)
- Supports GitOps workflows

---

## API Gateway Mode (Hybrid)

For organizations already using an API management layer, APIRE integrates with:
- **Kong**
- **Apigee**

This is the recommended path for organizations that don't want to change their existing AI traffic routing — APIRE plugs into the gateway and adds the 5-layer defense pipeline.

---

## Playground (in-dashboard testing)

- Interactive API testing without code integration
- Test prompts and responses against your active policies
- See exactly which layer blocked or modified content
- Useful for policy tuning and onboarding

---

## Compliance reporting and analytics

- Real-time dashboards across all 5 layers
- Filterable by detection-classification taxonomy
- Exportable for audit and regulatory submissions
- Cost management dashboard for AI provider routing

---

## Multi-tenancy

Both **APIRE Security Proxy** and **APIRE Secure Chat** support full multi-tenancy with per-tenant policy control.

In Cloud, the tenant model is org-scoped.

In On-Premise, full tenant management with quotas is provided via the Platform Admin Portal (separate from the Customer Portal).

---

## Role model recap (from `deployment-and-integration.md`)

### Cloud
- Platform Admin — system-wide / cross-organizational (Admin Portal only)
- Tenant Admin — org-level full admin
- Tenant User — read-only analytics + Playground
- Reseller — Wholesaler portal for activation codes and credit allocation

### On-Premise (Keycloak-backed)
- Same Tenant Admin / Tenant User model
- Dedicated Platform Admin Portal governing tenants, license, AI appliances, integrations, logging, updates

---

## Future roadmap (from briefings)

APIRE roadmap mentions (do not cite as shipping features yet):
- AI Security Analytics — deeper insights into AI security posture
- Continuous Compliance Analysis — automated monitoring for EU AI Act, GDPR, HIPAA
- Secure APIRE.IO Chat — secure communication with chat attachment protection
- Multi-Platform Native Agents — integration with platforms like MS Teams

---

## Contradictions / things to flag

- The **APIRE Log Appliance** is sometimes described as a product (datasheet) and sometimes as a deployment of the same platform (briefings). Treat it as a **separate dedicated product** per the datasheet.
- **Kong / Apigee integration** is documented for Hybrid deployments — these are the only two API gateways explicitly named.
