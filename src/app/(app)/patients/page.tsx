"use client";
import * as React from "react";
import {
  UserPlus, CalendarPlus, Phone, MessageCircle, Printer, CheckCircle2,
  Ticket, RefreshCw, XCircle, QrCode,
} from "lucide-react";
import {
  PageHeader, Button, Input, Field, Badge, Card, CardBody, CardHeader, EmptyState,
} from "@/components/ui";
import { Modal } from "@/components/modal";
import { StatCard } from "@/components/stat-card";
import { RequireHospital } from "@/components/require-hospital";
import { CalendarPicker, FakeQR } from "@/components/calendar-picker";
import { IntakeProvider, useIntake, type Booking, type BookingStatus } from "@/components/intake-store";
import { paiseToRupees, fmtDateTime } from "@/lib/utils";

function statusBadge(s: BookingStatus) {
  const map: Record<BookingStatus, { tone: "green" | "red" | "yellow" | "gray"; label: string }> = {
    confirmed: { tone: "green", label: "confirmed" },
    pending_payment: { tone: "yellow", label: "awaiting payment" },
    awaiting_confirmation: { tone: "yellow", label: "awaiting AI confirm" },
    cancelled: { tone: "red", label: "cancelled" },
  };
  const v = map[s];
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDateTime(iso);
}

// ── Add patient ─────────────────────────────────────────────────────────────
function AddPatientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addPatient, previewPatientId } = useIntake();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const previewId = open ? previewPatientId() : "";

  const close = () => {
    setName("");
    setPhone("");
    onClose();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    addPatient(name.trim(), phone.trim());
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Add new patient">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Patient name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anita Sharma" autoFocus />
        </Field>
        <Field label="Phone number (WhatsApp)">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Patient ID (auto-generated)">
          <Input value={previewId} readOnly className="bg-gray-50 font-mono text-gray-500" />
        </Field>
        <p className="text-xs text-gray-500">
          Adding a patient queues an AI outbound welcome call and a WhatsApp message with the ID.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || !phone.trim()}>Add patient</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Schedule ────────────────────────────────────────────────────────────────
function ScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patients, addBooking } = useIntake();
  const [patientId, setPatientId] = React.useState("");
  const [slot, setSlot] = React.useState<string | null>(null);
  const [rupees, setRupees] = React.useState("500");
  const [mode, setMode] = React.useState<"pay_now" | "pay_later">("pay_now");
  const [created, setCreated] = React.useState<Booking | null>(null);

  const close = () => {
    setPatientId("");
    setSlot(null);
    setRupees("500");
    setMode("pay_now");
    setCreated(null);
    onClose();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId || !slot) return;
    setCreated(addBooking({ patientId, slot, paymentMode: mode, amountPaise: Math.round((Number(rupees) || 0) * 100) }));
  };

  return (
    <Modal open={open} onClose={close} title="Schedule appointment" wide>
      {created ? (
        <ResultStep booking={created} onClose={close} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient">
              <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="" disabled>Select patient…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.id}</option>
                ))}
              </select>
              {patients.length === 0 && <p className="mt-1 text-xs text-amber-600">Add a patient first.</p>}
            </Field>
            <Field label="Consultation fee (₹)">
              <Input type="number" min={0} value={rupees} onChange={(e) => setRupees(e.target.value)} />
            </Field>
          </div>

          <div>
            <p className="label">Next appointment</p>
            <CalendarPicker value={slot} onChange={setSlot} />
            {slot && <p className="mt-2 text-xs text-gray-600">Selected: <strong>{fmtDateTime(slot)}</strong></p>}
          </div>

          <div>
            <p className="label">Payment</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <PayOption
                active={mode === "pay_now"} onClick={() => setMode("pay_now")}
                icon={<QrCode className="h-5 w-5" />} title="Pay now"
                desc="Generate a QR slip for the receptionist. Patient scans & pays — booking confirmed instantly."
              />
              <PayOption
                active={mode === "pay_later"} onClick={() => setMode("pay_later")}
                icon={<Ticket className="h-5 w-5" />} title="Pay at appointment"
                desc="Issue a temporary token over WhatsApp. AI confirms ~1 week before; token activates on confirmation."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!patientId || !slot}>Create booking</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PayOption({
  active, onClick, icon, title, desc,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition ${
        active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-200" : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-gray-900">{icon} {title}</span>
      <span className="text-xs text-gray-600">{desc}</span>
    </button>
  );
}

function ResultStep({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { markPaid, bookings } = useIntake();
  const live = bookings.find((b) => b.id === booking.id) ?? booking;

  if (live.paymentMode === "pay_now") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Payment slip prepared for the receptionist. Print it, the patient scans the QR and pays,
          then the booking confirms instantly.
        </p>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 p-5 sm:flex-row sm:items-start">
          <FakeQR seed={live.id} />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-gray-900">Arteq Care · Payment slip</p>
            <dl className="mt-2 space-y-1 text-gray-600">
              <Row k="Patient" v={`${live.patientName} (${live.patientId})`} />
              <Row k="Appointment" v={fmtDateTime(live.slot)} />
              <Row k="Amount" v={paiseToRupees(live.amountPaise)} />
              <Row k="Reference" v={live.id} />
            </dl>
            <Badge tone={live.status === "confirmed" ? "green" : "yellow"} className="mt-3">
              {live.status === "confirmed" ? "Paid · confirmed" : "Awaiting scan & pay"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print slip
          </Button>
          {live.status !== "confirmed" ? (
            <Button onClick={() => markPaid(live.id)}>
              <CheckCircle2 className="h-4 w-4" /> Patient scanned &amp; paid
            </Button>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
        <Ticket className="h-5 w-5 shrink-0" /> Temporary token issued and sent on WhatsApp.
      </div>
      <div className="rounded-xl border border-gray-200 p-4 text-sm">
        <dl className="space-y-1 text-gray-600">
          <Row k="Patient" v={`${live.patientName} (${live.patientId})`} />
          <Row k="Appointment" v={fmtDateTime(live.slot)} />
          <Row k="Token" v={live.token?.code ?? "—"} />
          <Row k="Token status" v={live.token?.active ? "active" : "inactive (awaiting AI confirmation)"} />
        </dl>
      </div>
      <ul className="space-y-1.5 text-xs text-gray-500">
        <li>• The token stays <strong>inactive</strong> until the patient confirms.</li>
        <li>• ~1 week before, the AI agent calls, references the token, and asks to confirm.</li>
        <li>• On confirmation the token becomes <strong>active</strong>.</li>
      </ul>
      <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{k}</dt>
      <dd className="text-right font-medium text-gray-900">{v}</dd>
    </div>
  );
}

// ── Page body ───────────────────────────────────────────────────────────────
function PatientsInner() {
  const { patients, bookings, whatsapp, calls, hydrated, runConfirmationCall, changeToken, cancelBooking } = useIntake();
  const [addOpen, setAddOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  const activeTokens = bookings.filter((b) => b.token?.active).length;
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;

  if (!hydrated) return null;

  return (
    <div>
      <PageHeader
        title="Patients & Intake"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add patient
            </Button>
            <Button onClick={() => setScheduleOpen(true)} disabled={patients.length === 0}>
              <CalendarPlus className="h-4 w-4" /> Schedule
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <StatCard label="Patients" value={String(patients.length)} />
        <StatCard label="Bookings" value={String(bookings.length)} />
        <StatCard label="Confirmed" value={String(confirmed)} />
        <StatCard label="Active tokens" value={String(activeTokens)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Patients */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="font-medium text-gray-900">Patients</span>
            <Badge>{patients.length}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            {patients.length === 0 ? (
              <EmptyState title="No patients yet" hint="Click “Add patient” to begin." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {patients.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.phone}</p>
                    </div>
                    <span className="font-mono text-xs text-gray-500">{p.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Bookings */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="font-medium text-gray-900">Bookings &amp; tokens</span>
            <Badge>{bookings.length}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            {bookings.length === 0 ? (
              <EmptyState title="No bookings yet" hint="Schedule an appointment for a patient." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {bookings.map((b) => (
                  <li key={b.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900">{b.patientName}</p>
                        <p className="text-xs text-gray-500">{fmtDateTime(b.slot)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {statusBadge(b.status)}
                        {b.token && (
                          <span className="font-mono text-[11px] text-gray-500">
                            {b.token.code} {b.token.active ? "·active" : "·inactive"}
                          </span>
                        )}
                      </div>
                    </div>
                    {b.status !== "cancelled" && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {b.paymentMode === "pay_later" && b.status === "awaiting_confirmation" && (
                          <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => runConfirmationCall(b.id)}>
                            <Phone className="h-3.5 w-3.5" /> Run AI confirmation call
                          </Button>
                        )}
                        {b.token && (
                          <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => changeToken(b.id)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Change token
                          </Button>
                        )}
                        <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => cancelBooking(b.id)}>
                          <XCircle className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* AI call log */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium text-gray-900">
              <Phone className="h-4 w-4 text-gray-500" /> AI agent call log
            </span>
            <Badge>{calls.length}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            {calls.length === 0 ? (
              <EmptyState title="No calls yet" hint="Calls fire on patient add and confirmation." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {calls.map((c) => (
                  <li key={c.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">{c.patientName}</p>
                      <span className="text-xs text-gray-400">{timeAgo(c.at)}</span>
                    </div>
                    <p className="text-xs text-gray-500">{c.phone} · {c.purpose}</p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-gray-600">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                      {c.outcome}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* WhatsApp feed */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium text-gray-900">
              <MessageCircle className="h-4 w-4 text-gray-500" /> WhatsApp messages
            </span>
            <Badge>{whatsapp.length}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            {whatsapp.length === 0 ? (
              <EmptyState title="No messages yet" hint="Tokens & confirmations are sent here." />
            ) : (
              <ul className="space-y-2 p-3">
                {whatsapp.map((m) => (
                  <li key={m.id} className="rounded-lg bg-green-50 p-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">{m.patientName}</span>
                      <span className="text-[11px] text-gray-400">{timeAgo(m.at)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-700">{m.body}</p>
                    <p className="mt-1 text-[10px] text-gray-400">{m.phone}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <AddPatientModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} />
    </div>
  );
}

export default function PatientsPage() {
  return (
    <RequireHospital>
      {(hospitalId) => (
        <IntakeProvider hospitalId={hospitalId}>
          <PatientsInner />
        </IntakeProvider>
      )}
    </RequireHospital>
  );
}
