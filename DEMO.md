# AI Revenue Recovery Agent — Demo Guide

## Quick Start

```bash
# 1. Add your Razorpay test-mode keys to .env.local
#    Get them: dashboard.razorpay.com → Account & Settings → API Keys (Test Mode toggle ON)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

# 2. Start the server
npm run dev

# 3. Open http://localhost:3000
```

The app works WITHOUT real Razorpay keys — Razorpay calls fall back to simulated refs.
Add real keys for actual payment links to appear in the Razorpay test dashboard.

---

## Demo Flow (4–6 min)

### Step 1 — Seed events (30 sec)
- Go to **Dashboard** (`/`)
- Click **"Seed Events"** → 556 events loaded (6 demo + 550 synthetic)
- See the stat strip update

### Step 2 — Normal path (90 sec)
- Go to **Events** (`/events`)
- Find `demo_001` (Arjun Sharma, insufficient_funds, ₹4,200)
- Click **"Recover"** → watch the pipeline run live:
  - Diagnosis: `insufficient_funds`
  - Intervention: `payday_retry` (primary) + `emi_offer` (secondary)
  - Guardrail: PASSED — bound_checked shows attempt count + window check
  - Outcome: `recovered` or `pending` (honest — calibrated to ground truth)
- Then recover `demo_002` (Priya Patel, expired_card) → shows UPI fallback link
- Then recover `demo_003` (Rohit Gupta, gateway_timeout) → shows silent retry path

### Step 3 — Break-it moment (90 sec)
- Go to **Guardrails** (`/guardrails`)
- Say out loud: "Let's try to break it"
- Click each break-it button in sequence:
  1. **"out of window"** → CONTACT_WINDOW_BLOCKED — 21:00 is outside 08:00–19:00
  2. **"attempt cap"** → ATTEMPT_CAP_EXCEEDED — 6th attempt hard-stopped
  3. **"discount cap"** → DISCOUNT_CAP_EXCEEDED — 20% > 5% policy cap
  4. **"dispute flag"** → DISPUTE_KILL_SWITCH — all contact stopped, RBI §454Z
- Every refusal appears instantly in the **Audit Log**

### Step 4 — Audit trail (45 sec)
- Go to **Audit** (`/audit`)
- Show the full table — every action logged unconditionally:
  - Machine `reason_code` (DISPUTE_KILL_SWITCH, ATTEMPT_CAP_EXCEEDED, etc.)
  - Plain-English description pair
  - `bound_checked` field — the guardrail state at time of action
  - Outcome column — recovered / blocked / escalated / pending
- Filter by "blocked" to show only guardrail stops

### Step 5 — The number (30 sec)
- Go back to **Dashboard**
- Click **"Run Batch Measurement"**
- Show the chart: **22% baseline → ~54% orchestrated**
- Say: "This is recovered-over-attempted — the honest denominator.
  Disputes and human handoffs excluded. Calibrated to Recurflux 2026,
  RetentionLens 2026, Slicker 2025."

### Step 6 — Close (15 sec)
- "Every recovery action is explainable — one signal, one reason code, one audit entry.
  Bounded by real RBI regulations. And we just tried to break it — it refused, every time."

---

## Key Demo Events

| Event | Customer | Signal | Shows |
|-------|----------|--------|-------|
| `demo_001` | Arjun Sharma | insufficient_funds | Payday retry + EMI offer |
| `demo_002` | Priya Patel | expired_card | UPI fallback link |
| `demo_003` | Rohit Gupta | gateway_timeout | Silent retry path |
| `demo_004` | Infosys Ltd | 55 days overdue | Human handoff threshold |
| `demo_005` | Sneha Iyer | dispute_flag=true | Kill-switch (try Recover — blocked) |
| `demo_006` | TCS Payments | 28 days overdue | Normal B2B flow |

---

## Guardrail Regulatory Basis

| Rule | Constraint | Source |
|------|-----------|--------|
| Contact window | 08:00–19:00 only | RBI §32.1O (Aug 6 2026, eff. Jan 1 2027) |
| Attempt cap | 5 per event | TRAI TCCCPR + fair-practice spirit *(no RBI numerical cap — say this if asked)* |
| Dispute kill-switch | Instant halt | RBI §454Z — post-complaint contact = harsh practice |
| Human handoff | Agent recommends only past day 46 | RBI §32.1D — graded escalation matrix |
| Full logging | Every attempt logged | RBI 2026 — mandatory recording, 6-month retention |

---

## If Razorpay Keys Are Not Configured

The app runs in **simulated mode** — all Razorpay calls return fake refs like `sim_link_demo_001_...`.
The guardrail, audit, and measurement logic all work fully without keys.
Add real `rzp_test_...` keys to `.env.local` and restart to get real payment links in the Razorpay dashboard.

---

## Backup Plan (if demo fails)

- The **Audit Log** (`/audit`) shows all past actions — have it pre-loaded
- The **Guardrails** page shows the RBI regulatory citations even without live actions
- The measurement numbers are re-computed each time — "Run Batch Measurement" always works
