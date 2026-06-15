"use client";
import * as React from "react";
import {
  type Booking, type BookingStatus, type CallLog, type IntakeState, type Patient,
  type PaymentMode, type WhatsAppMessage,
  fmtSlot, genToken, rid, yymmdd,
} from "@/lib/intake";
import { useToast } from "@/components/providers";

// Hospital-scoped patient-intake store.
//
// This is the productized version of the /mock flow, wired into the authed app
// and keyed per hospital. It persists to localStorage today; each mutation has
// a clearly marked seam (`// BACKEND:`) where the corresponding API call goes
// once the backend endpoints in docs/intake-workflow.md exist.

type Store = IntakeState & {
  hydrated: boolean;
  previewPatientId: () => string;
  addPatient: (name: string, phone: string) => Patient;
  addBooking: (input: {
    patientId: string;
    slot: string;
    paymentMode: PaymentMode;
    amountPaise: number;
  }) => Booking;
  markPaid: (bookingId: string) => void;
  runConfirmationCall: (bookingId: string) => void;
  changeToken: (bookingId: string) => void;
  cancelBooking: (bookingId: string) => void;
};

const EMPTY: IntakeState = { patients: [], bookings: [], whatsapp: [], calls: [] };
const Ctx = React.createContext<Store | null>(null);

export function useIntake(): Store {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useIntake must be used inside <IntakeProvider>");
  return ctx;
}

export function IntakeProvider({
  hospitalId,
  children,
}: {
  hospitalId: string;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const storageKey = `arteq_intake_${hospitalId}`;
  const [state, setState] = React.useState<IntakeState>(EMPTY);
  const [hydrated, setHydrated] = React.useState(false);

  // Load this hospital's intake data. Re-runs when the hospital changes.
  React.useEffect(() => {
    setHydrated(false);
    try {
      const raw = window.localStorage.getItem(storageKey);
      setState(raw ? (JSON.parse(raw) as IntakeState) : EMPTY);
    } catch {
      setState(EMPTY);
    }
    setHydrated(true);
  }, [storageKey]);

  const persist = React.useCallback(
    (next: IntakeState) => {
      setState(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
    },
    [storageKey]
  );

  const withWhatsApp = (s: IntakeState, phone: string, patientName: string, body: string): IntakeState => ({
    ...s,
    whatsapp: [{ id: rid("wa"), phone, patientName, body, at: new Date().toISOString() }, ...s.whatsapp],
  });

  const withCall = (
    s: IntakeState, phone: string, patientName: string, purpose: string, outcome: string
  ): IntakeState => ({
    ...s,
    calls: [{ id: rid("call"), phone, patientName, purpose, outcome, at: new Date().toISOString() }, ...s.calls],
  });

  const previewPatientId = React.useCallback((): string => {
    const today = state.patients.filter((p) => p.id.includes(yymmdd())).length;
    return `P-${yymmdd()}-${String(today + 1).padStart(3, "0")}`;
  }, [state.patients]);

  const addPatient = React.useCallback(
    (name: string, phone: string): Patient => {
      const patient: Patient = {
        id: previewPatientId(), name, phone, createdAt: new Date().toISOString(),
      };
      // BACKEND: POST /hospitals/{hid}/patients -> { id, ... } (server-generated id)
      let next: IntakeState = { ...state, patients: [patient, ...state.patients] };
      // BACKEND: enqueue AI outbound welcome call + WhatsApp welcome message.
      next = withCall(next, phone, name, "Welcome / onboarding",
        "AI agent placed outbound welcome call · introduced clinic");
      next = withWhatsApp(next, phone, name,
        `Hi ${name}, welcome to Arteq Care 🏥. Your patient ID is ${patient.id}. Save this message — we'll use it for your appointments.`);
      persist(next);
      toast(`Patient ${patient.id} added · AI call + WhatsApp queued`);
      return patient;
    },
    [state, previewPatientId, persist, toast]
  );

  const addBooking = React.useCallback(
    (input: { patientId: string; slot: string; paymentMode: PaymentMode; amountPaise: number }): Booking => {
      const patient = state.patients.find((p) => p.id === input.patientId);
      if (!patient) throw new Error("Patient not found");

      const booking: Booking = {
        id: rid("appt"),
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        slot: input.slot,
        paymentMode: input.paymentMode,
        amountPaise: input.amountPaise,
        status: input.paymentMode === "pay_now" ? "pending_payment" : "awaiting_confirmation",
        token: input.paymentMode === "pay_later" ? { code: genToken(), active: false } : null,
        createdAt: new Date().toISOString(),
      };

      // BACKEND: POST /hospitals/{hid}/appointments { patient_id, slot_time, payment_mode, amount }
      let next: IntakeState = { ...state, bookings: [booking, ...state.bookings] };
      if (booking.paymentMode === "pay_later" && booking.token) {
        // BACKEND: issue inactive token + send WhatsApp.
        next = withWhatsApp(next, patient.phone, patient.name,
          `Your appointment is reserved for ${fmtSlot(input.slot)}. Provisional token: ${booking.token.code} (inactive). Our AI assistant will call you ~1 week before to confirm.`);
        toast(`Token ${booking.token.code} issued · sent on WhatsApp`);
      } else {
        toast("Payment slip ready for the receptionist");
      }
      persist(next);
      return booking;
    },
    [state, persist, toast]
  );

  const markPaid = React.useCallback(
    (bookingId: string) => {
      const b = state.bookings.find((x) => x.id === bookingId);
      if (!b) return;
      // BACKEND: payment webhook confirms -> PUT appointment status=confirmed.
      let next: IntakeState = {
        ...state,
        bookings: state.bookings.map((x) =>
          x.id === bookingId ? { ...x, status: "confirmed" as BookingStatus } : x),
      };
      next = withWhatsApp(next, b.patientPhone, b.patientName,
        `Payment received ✅. Your appointment on ${fmtSlot(b.slot)} is confirmed. See you soon!`);
      persist(next);
      toast("Payment confirmed");
    },
    [state, persist, toast]
  );

  const runConfirmationCall = React.useCallback(
    (bookingId: string) => {
      const b = state.bookings.find((x) => x.id === bookingId);
      if (!b || !b.token) return;
      // BACKEND: scheduled AI call ~1 week before -> on confirm, activate token.
      let next: IntakeState = {
        ...state,
        bookings: state.bookings.map((x) =>
          x.id === bookingId
            ? { ...x, status: "confirmed" as BookingStatus, token: { ...x.token!, active: true } }
            : x),
      };
      next = withCall(next, b.patientPhone, b.patientName,
        "Appointment confirmation (1 week prior)",
        `AI referenced token ${b.token.code} · patient confirmed · token activated`);
      next = withWhatsApp(next, b.patientPhone, b.patientName,
        `Thanks for confirming! Token ${b.token.code} is now ACTIVE ✅. Pay at the clinic on the day of your appointment.`);
      persist(next);
      toast(`Token ${b.token.code} activated`);
    },
    [state, persist, toast]
  );

  const changeToken = React.useCallback(
    (bookingId: string) => {
      const b = state.bookings.find((x) => x.id === bookingId);
      if (!b || !b.token) return;
      const newCode = genToken();
      // BACKEND: reissue token -> notify patient of the change.
      let next: IntakeState = {
        ...state,
        bookings: state.bookings.map((x) =>
          x.id === bookingId ? { ...x, token: { code: newCode, active: x.token!.active } } : x),
      };
      next = withWhatsApp(next, b.patientPhone, b.patientName,
        `Your token has been changed. Old: ${b.token.code} → New: ${newCode}. Please use the new token for your visit.`);
      persist(next);
      toast("Token changed · patient notified");
    },
    [state, persist, toast]
  );

  const cancelBooking = React.useCallback(
    (bookingId: string) => {
      const b = state.bookings.find((x) => x.id === bookingId);
      if (!b) return;
      let next: IntakeState = {
        ...state,
        bookings: state.bookings.map((x) =>
          x.id === bookingId ? { ...x, status: "cancelled" as BookingStatus } : x),
      };
      next = withWhatsApp(next, b.patientPhone, b.patientName,
        `Your appointment on ${fmtSlot(b.slot)} has been cancelled. Reply to reschedule.`);
      persist(next);
      toast("Booking cancelled");
    },
    [state, persist, toast]
  );

  const value: Store = {
    ...state,
    hydrated,
    previewPatientId,
    addPatient,
    addBooking,
    markPaid,
    runConfirmationCall,
    changeToken,
    cancelBooking,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type { Booking, BookingStatus, CallLog, Patient, WhatsAppMessage };
