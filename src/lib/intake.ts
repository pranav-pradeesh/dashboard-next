// Domain model for the patient intake + booking workflow (Add patient →
// schedule → Pay Now / Pay Later → token lifecycle). This currently lives in
// the browser (see components/intake-store.tsx) as a front-end implementation;
// the same shapes map onto the backend endpoints listed in
// docs/intake-workflow.md when they are built.

export type Patient = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
};

export type PaymentMode = "pay_now" | "pay_later";

export type BookingStatus =
  | "pending_payment" // Pay Now: QR generated, awaiting scan + pay
  | "awaiting_confirmation" // Pay Later: token issued but inactive
  | "confirmed" // paid (Pay Now) or token activated (Pay Later)
  | "cancelled";

export type Token = {
  code: string;
  active: boolean;
};

export type Booking = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  slot: string; // ISO datetime
  paymentMode: PaymentMode;
  status: BookingStatus;
  amountPaise: number;
  token: Token | null;
  createdAt: string;
};

export type WhatsAppMessage = {
  id: string;
  phone: string;
  patientName: string;
  body: string;
  at: string;
};

export type CallLog = {
  id: string;
  phone: string;
  patientName: string;
  purpose: string;
  outcome: string;
  at: string;
};

export type IntakeState = {
  patients: Patient[];
  bookings: Booking[];
  whatsapp: WhatsAppMessage[];
  calls: CallLog[];
};

// ── Helpers ────────────────────────────────────────────────────────────────
export function yymmdd(d = new Date()): string {
  return [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
}

export function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function genToken(): string {
  return `TKN-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
