"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CameraCapture from "@/components/CameraCapture";
import SignaturePad from "@/components/SignaturePad";

interface Employee {
  id: string;
  displayName: string;
}

interface VisitorResult {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  reason: string;
  hostEmployeeId: string | null;
  trainingConfirmedAt: string | null;
}

const TRAINING_TEXT = `By signing below I confirm that I have received and understand the visitor safety briefing for the Bruno Bock facility, including emergency procedures, PPE requirements, restricted areas, and the requirement to remain with my host while on site.`;

type Step = 1 | 2 | 3 | 4 | 5;

export default function VisitorWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Training expiry setting (fetched once on mount, ms)
  const [trainingExpiryMs, setTrainingExpiryMs] = useState(
    365 * 24 * 60 * 60 * 1000,
  );

  // Returning visitor search (Step 1 panel)
  const [returningOpen, setReturningOpen] = useState(false);
  const [visitorQuery, setVisitorQuery] = useState("");
  const [visitorResults, setVisitorResults] = useState<VisitorResult[]>([]);
  const [searchingVisitors, setSearchingVisitors] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prior visit state (set when a returning visitor is selected)
  const [priorVisitorId, setPriorVisitorId] = useState<string | null>(null);
  const [priorTrainingConfirmedAt, setPriorTrainingConfirmedAt] = useState<
    string | null
  >(null);

  // Step 1
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [reason, setReason] = useState("");

  // Step 2
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [hostFilter, setHostFilter] = useState("");
  const [hostId, setHostId] = useState<string | null>(null);

  // Step 3
  const [photo, setPhoto] = useState<string | null>(null);

  // Step 4
  const [signature, setSignature] = useState<string | null>(null);
  // ISO string; carried forward from prior visit if training is still fresh
  const [confirmedTrainingAt, setConfirmedTrainingAt] = useState<string | null>(
    null,
  );

  // Fetch training expiry on mount
  useEffect(() => {
    fetch("/api/settings/training-expiry")
      .then((r) => r.json())
      .then((d: { days: number }) => {
        if (d.days > 0) setTrainingExpiryMs(d.days * 24 * 60 * 60 * 1000);
      })
      .catch(() => {});
  }, []);

  // Debounced visitor search
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (visitorQuery.trim().length < 2) {
      setVisitorResults([]);
      return;
    }
    searchDebounce.current = setTimeout(() => {
      setSearchingVisitors(true);
      fetch(`/api/visitors/search?q=${encodeURIComponent(visitorQuery.trim())}`)
        .then((r) => r.json())
        .then((d: VisitorResult[]) => setVisitorResults(d))
        .catch(() => setVisitorResults([]))
        .finally(() => setSearchingVisitors(false));
    }, 300);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [visitorQuery]);

  const selectReturningVisitor = (v: VisitorResult) => {
    setFirstName(v.firstName);
    setLastName(v.lastName);
    setCompany(v.company);
    setReason(v.reason);
    setHostId(v.hostEmployeeId ?? null);
    setPriorVisitorId(v.id);
    setPriorTrainingConfirmedAt(v.trainingConfirmedAt);
    setReturningOpen(false);
    setVisitorQuery("");
    setVisitorResults([]);
  };

  // Is the prior training still within the expiry window?
  const trainingFresh =
    priorTrainingConfirmedAt != null &&
    Date.now() - new Date(priorTrainingConfirmedAt).getTime() <
      trainingExpiryMs;

  // Build dynamic step sequence; Step 4 is skipped when training is fresh
  const steps: Step[] = trainingFresh ? [1, 2, 3, 5] : [1, 2, 3, 4, 5];
  const totalSteps = steps.length;
  const currentStepIndex = steps.indexOf(step);

  const goNext = () => {
    const next = steps[currentStepIndex + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = steps[currentStepIndex - 1];
    if (prev) setStep(prev);
  };

  useEffect(() => {
    if (step === 2 && employees.length === 0) {
      void fetch("/api/employees")
        .then((r) => r.json())
        .then(setEmployees)
        .catch(() => setEmployees([]));
    }
  }, [step, employees.length]);

  // When signature is provided (Step 4 shown), record the training timestamp
  const handleSignatureChange = (dataUrl: string | null) => {
    setSignature(dataUrl);
    if (dataUrl) {
      setConfirmedTrainingAt(new Date().toISOString());
    } else {
      setConfirmedTrainingAt(null);
    }
  };

  const canStep1 =
    firstName.trim() && lastName.trim() && company.trim() && reason.trim();
  const canStep2 = !!hostId;
  const canStep3 = !!photo;
  const canStep4 = !!signature;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const effectiveTrainingAt = trainingFresh
      ? priorTrainingConfirmedAt!
      : confirmedTrainingAt;
    try {
      const res = await fetch("/api/visitors/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          company: company.trim(),
          reason: reason.trim(),
          hostEmployeeId: hostId,
          photoDataUrl: photo,
          signatureDataUrl: signature ?? "",
          trainingConfirmedAt: effectiveTrainingAt ?? undefined,
          // Returning visitor: update existing record instead of creating a new one.
          ...(priorVisitorId ? { existingVisitorId: priorVisitorId } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      router.push("/?registered=1");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredEmployees = employees.filter((e) =>
    e.displayName.toLowerCase().includes(hostFilter.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Visitor Sign-In</h1>
        <a href="/" className="text-neutral-400 hover:text-neutral-200">
          Cancel
        </a>
      </header>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-400">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`h-2 w-12 rounded-full ${i <= currentStepIndex ? "bg-blue-500" : "bg-neutral-700"}`}
          />
        ))}
        <span className="ml-2">
          Step {currentStepIndex + 1} of {totalSteps}
        </span>
      </div>

      {step === 1 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Tell us about your visit</h2>

          {/* Returning visitor search panel */}
          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <button
              type="button"
              onClick={() => setReturningOpen((o) => !o)}
              className="flex w-full items-center justify-between text-left text-sm font-medium text-neutral-300"
            >
              <span>Have you visited before? Search to pre-fill your info</span>
              <span className="text-neutral-500">{returningOpen ? "▲" : "▼"}</span>
            </button>

            {returningOpen ? (
              <div className="mt-3 space-y-2">
                <input
                  value={visitorQuery}
                  onChange={(e) => setVisitorQuery(e.target.value)}
                  placeholder="Name or company…"
                  className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-lg outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
                  autoFocus
                />
                {searchingVisitors ? (
                  <p className="text-sm text-neutral-500">Searching…</p>
                ) : visitorResults.length === 0 && visitorQuery.trim().length >= 2 ? (
                  <p className="text-sm text-neutral-500">No past visits found.</p>
                ) : (
                  <ul className="divide-y divide-neutral-800 rounded-lg ring-1 ring-neutral-800">
                    {visitorResults.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => selectReturningVisitor(v)}
                          className="flex w-full flex-col px-4 py-3 text-left hover:bg-neutral-800"
                        >
                          <span className="font-medium">
                            {v.firstName} {v.lastName}
                          </span>
                          <span className="text-sm text-neutral-400">{v.company}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {priorVisitorId && !returningOpen ? (
              <p className="mt-2 text-sm text-emerald-400">
                ✓ Info pre-filled from your last visit
                {trainingFresh ? " · Safety training is current" : " · Training has expired — you will need to re-sign"}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" value={firstName} onChange={setFirstName} />
            <Field label="Last name" value={lastName} onChange={setLastName} />
            <Field
              label="Company"
              value={company}
              onChange={setCompany}
              className="sm:col-span-2"
            />
            <Field
              label="Reason for visit"
              value={reason}
              onChange={setReason}
              className="sm:col-span-2"
            />
          </div>
          <Nav onNext={goNext} nextDisabled={!canStep1} />
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Who are you here to see?</h2>
          <input
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            placeholder="Search employees…"
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-lg outline-none ring-1 ring-neutral-700"
          />
          <div className="max-h-96 overflow-y-auto rounded-xl ring-1 ring-neutral-800">
            {filteredEmployees.length === 0 ? (
              <p className="p-4 text-neutral-500">No employees match.</p>
            ) : (
              <ul>
                {filteredEmployees.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setHostId(e.id)}
                      className={`flex w-full items-center justify-between border-b border-neutral-800 px-4 py-3 text-left text-lg last:border-b-0 ${hostId === e.id ? "bg-blue-600" : "hover:bg-neutral-800"}`}
                    >
                      <span>{e.displayName}</span>
                      {hostId === e.id ? <span>✓</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Nav onBack={goBack} onNext={goNext} nextDisabled={!canStep2} />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Take your photo</h2>
          {priorVisitorId ? (
            <div className="flex items-center gap-4 rounded-xl bg-neutral-800 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${priorVisitorId}/photo`}
                alt="Last visit photo"
                className="h-20 w-20 rounded-lg object-cover ring-1 ring-neutral-700"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <p className="text-sm text-neutral-400">
                Your last visit photo — please take a new one below.
              </p>
            </div>
          ) : null}
          <CameraCapture onCapture={setPhoto} />
          <Nav onBack={goBack} onNext={goNext} nextDisabled={!canStep3} />
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Acknowledge & sign</h2>
          <div className="rounded-xl bg-neutral-800 p-4 leading-relaxed">
            {TRAINING_TEXT}
          </div>
          <SignaturePad onChange={handleSignatureChange} />
          <Nav onBack={goBack} onNext={goNext} nextDisabled={!canStep4} />
        </section>
      ) : null}

      {step === 5 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Confirm</h2>
          <dl className="grid gap-3 rounded-xl bg-neutral-800 p-4 text-lg">
            <Row k="Name" v={`${firstName} ${lastName}`} />
            <Row k="Company" v={company} />
            <Row k="Reason" v={reason} />
            <Row
              k="Host"
              v={
                employees.find((e) => e.id === hostId)?.displayName ||
                "(unknown)"
              }
            />
            <Row
              k="Training"
              v={
                trainingFresh
                  ? `Current (signed ${new Date(priorTrainingConfirmedAt!).toLocaleDateString()})`
                  : confirmedTrainingAt
                    ? `Signed today (${new Date(confirmedTrainingAt).toLocaleDateString()})`
                    : "Not signed"
              }
            />
          </dl>
          {error ? (
            <div className="rounded-lg bg-red-900/40 p-3 text-red-200">
              {error}
            </div>
          ) : null}
          <Nav
            onBack={goBack}
            onNext={submit}
            nextLabel={submitting ? "Signing in…" : "Sign me in"}
            nextDisabled={submitting}
          />
        </section>
      ) : null}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-sm text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl bg-neutral-800 px-4 py-3 text-lg outline-none ring-1 ring-neutral-700 focus:ring-neutral-500"
      />
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-neutral-400">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Next",
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex justify-between pt-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl bg-neutral-700 px-5 py-3 text-lg"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}
