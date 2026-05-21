# APIRE Product Suite and Risk Surfaces

**What this file contains:** The four named products in the APIRE suite (Security Proxy, Secure Chat, Browser Agent, Log Appliance), their exact descriptions and capabilities, and the four named "risk surfaces" the suite covers. Generation about "what APIRE products are there" or "which APIRE product solves problem X" should use these exact names and capability lists.

**Sources:**
- `APIRE AI Security Platform Datasheet_2026.pdf` (visual transcription) — primary source for product suite
- `APIRE - Complete Brand Context Document.docx`
- `PRODUCT-FACTS-EXTRACTED.md`
- `APIRE - Comprehensive Market Research Report.docx`

---

## The product suite — four products

The APIRE product suite extends the same 5-layer protection across every AI surface in an organization.

### 1. APIRE Security Proxy (CORE PRODUCT)

**Role:** The core platform — a fully transparent AI API proxy requiring a single URL change. Routes all AI traffic through the 5-layer defense system.

**Description (exact from datasheet):** The core platform — a fully transparent AI API proxy requiring a single URL change. Routes all AI traffic through the 5-layer defense system. Supports inline real-time protection and out-of-band analytics topologies.

**Key capabilities:**
- Transparent proxy — zero code modifications required
- In-line real-time protection topology
- Out-of-band analytics and SIEM integration mode
- Full multi-tenant support with per-tenant policies
- OpenAI API compatible across all providers

### 2. APIRE Secure Chat

**Role:** A fully secured ChatGPT-style end-user chat interface with built-in monitoring and logging. Enables employees to use AI safely while enforcing all 5 security layers on every message — eliminating Shadow AI risk.

**Description (exact from datasheet):** A fully secured ChatGPT-style end-user chat interface with built-in monitoring and logging. Enables employees to use AI safely while enforcing all 5 security layers on every message — eliminating Shadow AI risk.

**Key capabilities:**
- Secured ChatGPT-style interface for employees
- All 5 APIRE security layers enforced per message
- Real-time monitoring and session logging
- Prevents Shadow AI — sanctioned, secure alternative
- AD/LDAP identity integration and user management

### 3. APIRE Browser Agent

**Role:** Browser-level protection for employees using web-based AI tools directly. Extends APIRE's 5-layer security to any browser AI interface without infrastructure changes.

**Description (exact from datasheet):** Browser-level protection for employees using web-based AI tools directly. Extends APIRE's 5-layer security to any browser AI interface without infrastructure changes. Blocks data leakage and enforces corporate policies at the browser level.

**Key capabilities:**
- Protects ChatGPT, Claude, Gemini, and all browser AI tools
- Intercepts and analyzes prompts before transmission
- Enforces corporate AI usage policies at browser level
- Prevents unauthorized Shadow AI tool usage
- Centrally managed via APIRE Security Dashboard

### 4. APIRE Log Appliance

**Role:** Specially customized appliance for comprehensive AI tracking, logging, and audit trail management.

**Description (exact from datasheet):** Specially customized appliance for comprehensive AI tracking, logging, and audit trail management. Collects all security events and threat detection data for compliance, forensics, and SIEM integration via webhook.

**Key capabilities:**
- Dedicated AI security event collection and storage
- Webhook connector for SIEM and SOC integration
- Detection-based granular logging with full context
- Optional full payload logging for forensic analysis
- Complete audit trail for regulatory compliance

---

## The four risk surfaces APIRE covers

The suite is positioned as covering every AI usage surface in an organization. The datasheet enumerates four explicit risk surfaces with the recommended APIRE solution mapping:

### Risk Surface 1 — AI Chat Interfaces

**Description (exact):** Protect chat data leakage, content abuse, and AI attacks. Prevent unauthorized Shadow AI usage.

**Solution:** Secure Chat + Browser Agent

### Risk Surface 2 — Developer IDE & Coding Agents

**Description (exact):** Block credential and source code leakage through AI-powered IDEs and coding assistants.

**Solution:** Security Proxy + IDE Integration

### Risk Surface 3 — Enterprise Application AI

**Description (exact):** Protect data leakage from enterprise applications using AI APIs and safeguard AI-powered business workflows.

**Solution:** Security Proxy

### Risk Surface 4 — Chatbots, RAG & MCP Agents

**Description (exact):** Secure AI chatbot deployments, RAG pipelines, and MCP agent integrations. Block content abuse and data leakage.

**Solution:** Security Proxy

---

## Real-world use cases (from the AI Security & Privacy Briefing)

The platform's real-world use case framing maps onto the four risk surfaces:

- **AI Chat Protection** — Secure internal and external chat interfaces (e.g., OpenWeb UI) against data leakage, content abuse, and AI attacks.
- **Developer Coding Agent / IDE Protection** — Prevent leakage of source code, credentials, and intellectual property from developer IDEs.
- **Application AI Usage Protection** — Secure enterprise applications that make API calls to AI services.
- **Chatbot Protection** — Protect chatbots connected to internal company data from exposing sensitive information or being manipulated.

---

## How to talk about the suite

- The Security Proxy is the **core**; everything else extends the same 5-layer defense to a different surface.
- The story is **"every AI surface in your organization, from employee chat to developer IDEs to autonomous agents"**.
- The anti-Shadow-AI angle is strongest in Secure Chat (sanctioned alternative) and Browser Agent (browser-level enforcement). The killer stat is **98% of employees use unsanctioned AI applications**.

## Contradictions / things to flag

- Older briefing material sometimes mentions a planned **"Secure APIRE.IO Chat"** with "chat attachment protection" as a future roadmap item — this overlaps with the now-shipping APIRE Secure Chat product. Treat APIRE Secure Chat as the canonical name.
- The Solution Architecture Document (v2.1, Nov 2025) discusses the Security Proxy as the entire platform; the broader suite framing (4 distinct products) is the 2026 datasheet's canonical framing.
