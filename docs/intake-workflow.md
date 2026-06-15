# Patient Intake & Booking workflow

This documents the patient-intake feature now available in the authenticated app
at **`/patients`** ("Patients & Intake" in the sidebar). It mirrors the `/mock`
preview but is hospital-scoped and wired into the real app shell.

> **Implementation status:** the workflow currently runs as **front-end state**
> persisted in `localStorage` (per hospital, key `arteq_intake_<hospitalId>`).
> Every mutation in `src/components/intake-store.tsx` has a `// BACKEND:` seam
> marking where the API call belongs once the endpoints below exist. The AI
> calls, WhatsApp messages, and payment QR are simulated.

## The flow

1. **Add patient** — name + phone; the Patient ID is **auto-generated**
   (`P-YYMMDD-NNN`, sequential per day). Adding a patient queues an **AI outbound
   welcome call** and a **WhatsApp** welcome message containing the ID.
2. **Schedule** — pick the patient, choose the next appointment on the
   **calendar + time-slot picker**, set the consultation fee, and pick a payment
   path (below).
3. **Tokens & feeds** — the page shows live **Bookings & tokens**, the **AI call
   log**, and the **WhatsApp feed**.

## Pay Now vs Pay Later — the logic

The payment path chosen at scheduling time decides **how and when a booking
becomes `confirmed`**, and whether a **token** is involved.

### Path A — Pay Now (pay at booking, at reception)

Use when the patient is physically at reception and can pay immediately.

```
schedule (pay_now)
  → booking.status = "pending_payment"   (no token)
  → a payment slip with a QR is generated for the receptionist
  → receptionist prints it; patient scans the QR and pays
  → "Patient scanned & paid"
  → booking.status = "confirmed"
  → WhatsApp: "Payment received ✅ … confirmed"
```

- **No token** is issued — payment *is* the confirmation. Money up front, so the
  slot is locked in as soon as it's paid.
- The booking is only `confirmed` **after** payment; until then it sits in
  `pending_payment`.

### Path B — Pay Later (pay at the time of the appointment)

Use when the patient books ahead and will pay on the day of the visit. Because
no money changes hands now, the slot is held with a **token** that must be
**confirmed** so we don't hold slots for no-shows.

```
schedule (pay_later)
  → booking.status = "awaiting_confirmation"
  → token issued, token.active = FALSE        (provisional hold)
  → WhatsApp: token code + "AI will call ~1 week before to confirm"

  ~1 week before the appointment:
  → AI agent calls, references the token, asks the patient to confirm
  → patient confirms
  → token.active = TRUE
  → booking.status = "confirmed"
  → WhatsApp: "Token … is now ACTIVE ✅, pay at the clinic"
```

- **Why a token?** It's a lightweight reference the patient and the AI agent both
  quote. It stays **inactive** until confirmed, which is what distinguishes a
  *provisional hold* from a *committed* booking.
- **Activation = commitment.** An inactive token means "reserved but unconfirmed";
  an active token means "patient confirmed they're coming and will pay on arrival."
- **Token change** — if a token is reissued (e.g. slot/queue reshuffle), the
  patient automatically gets a WhatsApp: *"Your token has been changed."* The
  active/inactive state is preserved across the change.

### Summary

| | Pay Now | Pay Later |
|---|---|---|
| When paid | At reception, now | At the appointment |
| Token | None | Issued, starts **inactive** |
| Confirmed when | Payment received | AI confirmation call succeeds |
| Initial status | `pending_payment` | `awaiting_confirmation` |
| Risk managed | — | No-shows (via confirm step) |

## Backend endpoints required to persist this server-side

The front-end shapes map onto these (see `src/lib/intake.ts` for the types):

- `POST /hospitals/{hid}/patients` → create patient, **server-generated ID**;
  triggers AI welcome call + WhatsApp welcome.
- `GET /hospitals/{hid}/patients`
- `POST /hospitals/{hid}/appointments` `{ patient_id, slot_time, payment_mode, amount_paise }`
  → create booking. For `pay_later`, issue an inactive token + send WhatsApp.
- `POST /hospitals/{hid}/appointments/{id}/payment` (or a payment webhook) →
  on success set status `confirmed` + WhatsApp receipt (Pay Now).
- `POST /hospitals/{hid}/appointments/{id}/confirm` → activate token + set
  `confirmed` (called by the scheduled pre-appointment AI job).
- `POST /hospitals/{hid}/appointments/{id}/token/regenerate` → reissue token +
  WhatsApp "token changed".
- Integrations: **outbound AI calling** (welcome + 1-week-prior confirmation),
  **WhatsApp** messaging, and **payment/QR** generation.
