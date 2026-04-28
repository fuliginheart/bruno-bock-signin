"use client";

import { create } from "zustand";

export interface RosterItem {
  subjectType: "employee" | "visitor";
  id: string;
  displayName: string;
  company?: string | null;
  photoPath?: string | null;
  onSite: boolean;
  since: number | null;
}

interface RosterState {
  employees: RosterItem[];
  visitors: RosterItem[];
  ready: boolean;
  setRoster: (employees: RosterItem[], visitors: RosterItem[]) => void;
  applyEvent: (ev: AppliedEvent) => void;
  setOptimistic: (
    subjectType: "employee" | "visitor",
    id: string,
    onSite: boolean,
  ) => void;
}

export interface AppliedEvent {
  action: string;
  subjectType: "employee" | "visitor" | null;
  subjectId: string | null;
  createdAt: number;
  payload: Record<string, unknown>;
}

function lastName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

function sortByLastName(items: RosterItem[]): RosterItem[] {
  return [...items].sort((a, b) =>
    lastName(a.displayName).localeCompare(lastName(b.displayName)),
  );
}

export const useRoster = create<RosterState>((set) => ({
  employees: [],
  visitors: [],
  ready: false,
  setRoster: (employees, visitors) =>
    set({ employees: sortByLastName(employees), visitors, ready: true }),
  setOptimistic: (subjectType, id, onSite) =>
    set((s) => ({
      employees:
        subjectType === "employee"
          ? s.employees.map((e) =>
              e.id === id ? { ...e, onSite, since: Date.now() } : e,
            )
          : s.employees,
      visitors:
        subjectType === "visitor"
          ? s.visitors.map((v) =>
              v.id === id ? { ...v, onSite, since: Date.now() } : v,
            )
          : s.visitors,
    })),
  applyEvent: (ev) =>
    set((s) => {
      if (ev.action !== "sign_in" && ev.action !== "sign_out") return s;
      if (!ev.subjectType || !ev.subjectId) return s;
      const onSite = ev.action === "sign_in";
      if (ev.subjectType === "employee") {
        return {
          ...s,
          employees: sortByLastName(s.employees.map((e) =>
            e.id === ev.subjectId
              ? { ...e, onSite, since: ev.createdAt }
              : e,
          )),
        };
      }
      return {
        ...s,
        visitors: s.visitors.map((v) =>
          v.id === ev.subjectId
            ? { ...v, onSite, since: ev.createdAt }
            : v,
        ),
      };
    }),
}));
