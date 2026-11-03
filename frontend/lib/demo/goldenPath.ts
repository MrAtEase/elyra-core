import type { IntentRouteResult } from "@/components/os/kernel/types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function matchesAny(lowered: string, keywords: string[]): boolean {
  return keywords.some((keyword) => lowered.includes(keyword));
}

function getActiveWorkspaceId(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-elyra-workspace");
}

export function routeGoldenPathIntent(text: string): IntentRouteResult | null {

  const lowered = normalize(text);
  const inFishDelish = getActiveWorkspaceId() === "fish-delish";

  // ── Morning briefing ─────────────────────────────────────────────────────
  if (matchesAny(lowered, ["important today", "on my plate", "whats important", "briefing", "my day"])) {
    return {
      intentKind: "read_only",
      assistantText:
        "Good morning, Paul.\n\nYou have 3 events today — the investor call at 14:00 is the most important.\nThere are 2 overdue tasks from last week.\n4 unread emails, one from your accountant marked urgent.\n\nHere's what I suggest:",
      actionCards: [
        { id: "ac-1", title: "Review overdue tasks", detail: "Reschedule 2 tasks to today or this week" },
        { id: "ac-2", title: "Open urgent email", detail: "From accountant — March invoice deadline" },
        { id: "ac-3", title: "Prep investor call", detail: "Generate agenda from last meeting notes" },
      ],
      timeline: [
        { id: "gp-scan", label: "Scan workspace", detail: "Checking calendar, tasks, and mail..." },
        { id: "gp-prioritize", label: "Prioritize", detail: "Ranking by urgency and importance" },
        { id: "gp-present", label: "Present briefing", detail: "Structured morning overview ready" },
      ],
    };
  }

  // ── Investor call / agenda prep ──────────────────────────────────────────
  if (matchesAny(lowered, ["prep investor", "investor call", "create agenda", "prepare agenda", "talking points"])) {
    return {
      intentKind: "mutation",
      openApp: "calendar",
      assistantText:
        "I've prepared an agenda for your 14:00 investor call:\n\n1. Q1 Progress Update (5 min)\n2. Product Demo — Elyra OS (10 min)\n3. Go-to-market: Fish-Delish deployment (5 min)\n4. The Ask — funding round details (5 min)\n5. Q&A (5 min)\n\nAdded to your calendar event notes.",
      actionCards: [
        { id: "agenda-1", title: "Agenda created", detail: "5 talking points added to event notes" },
        { id: "agenda-2", title: "Share with team", detail: "Send agenda to meeting participants" },
      ],
      timeline: [
        { id: "ag-read", label: "Read calendar event", detail: "Fetching investor call details..." },
        { id: "ag-generate", label: "Generate agenda", detail: "Creating structured talking points" },
        { id: "ag-write", label: "Write to event", detail: "Saving agenda to calendar notes", requiresConfirmation: true },
      ],
    };
  }

  // ── Draft reply ───────────────────────────────────────────────────────────
  if (matchesAny(lowered, ["draft reply", "reply to", "write reply", "draft a reply", "respond to"])) {
    return {
      intentKind: "mutation",
      assistantText:
        "Here's a draft reply:\n\n---\nHi Maria,\n\nThanks for sending this over. I'll review the updated rates and have the signed invoice back to you by March 3rd.\n\nCould you also send me the breakdown for the Almada location separately?\n\nBest,\nPaul\n---\n\nReady to send?",
      actionCards: [
        { id: "reply-1", title: "Send reply", detail: "To: maria@accountant.pt" },
        { id: "reply-2", title: "Edit draft", detail: "Modify before sending" },
      ],
      timeline: [
        { id: "draft-context", label: "Read thread context", detail: "Understanding conversation history" },
        { id: "draft-compose", label: "Compose reply", detail: "Drafting professional response" },
        { id: "draft-send", label: "Send email", detail: "Awaiting confirmation to send", requiresConfirmation: true },
      ],
    };
  }

  // ── Urgent / accountant email ─────────────────────────────────────────────
  if (matchesAny(lowered, ["urgent email", "email from accountant", "show email", "accountant", "important email"])) {
    return {
      intentKind: "read_only",
      openApp: "mail",
      assistantText:
        "Found the urgent email from your accountant (received yesterday at 16:42):\n\nSubject: March Invoice Deadline — Action Required\n\nThey need the signed invoice by March 5th. The attached PDF has the updated rates.\n\nWant me to draft a reply?",
      timeline: [
        { id: "mail-search", label: "Search inbox", detail: "Filtering by urgency and sender..." },
        { id: "mail-preview", label: "Preview thread", detail: "Extracting key details" },
      ],
    };
  }

  // ── Weather ───────────────────────────────────────────────────────────────
  if (matchesAny(lowered, ["wetter", "weather", "forecast", "temperatur", "temperature", "surfen", "surf", "wellen", "waves", "swell"])) {
    return {
      intentKind: "read_only",
      openApp: "weather",
      assistantText:
        "Öffne die Wetter-App für dich — Echtzeit-Surf-Forecast, Gezeitenzeiten und Wind für deinen letzten Standort (Lissabon / Costa da Caparica).\n\nMorgen: 16°C, bewölkt, Wellen 1.2–1.8m @ 11s, SSW-Dünung, Offshore-Wind aus NNO. Gezeiten: Low 06:42, High 13:18.\n\nSurf-Rating: 🟢 Gut — gute Periode, leichter Offshore-Wind.",
      actionCards: [
        { id: "weather-1", title: "Surf-Forecast öffnen", detail: "Stunden-Forecast + Gezeitenkurve" },
        { id: "weather-2", title: "Session loggen", detail: "Vergangene Session eintragen für Forecast-Analyse" },
      ],
      timeline: [
        { id: "weather-fetch", label: "Fetch marine data", detail: "Open-Meteo marine + weather API..." },
        { id: "weather-tide", label: "Calculate tides", detail: "Tide prediction for Caparica/Lisbon" },
        { id: "weather-rate", label: "Rate surf", detail: "Swell, period, wind, tide score" },
      ],
    };
  }

  // ── Tasks today ───────────────────────────────────────────────────────────
  if (matchesAny(lowered, ["aufgaben heute", "tasks today", "was muss ich", "todo heute", "meine aufgaben", "my tasks", "what do i have to", "was steht an"])) {
    return {
      intentKind: "read_only",
      openApp: "tasks",
      assistantText:
        "Deine Aufgaben für heute:\n\n🔴 P1 — Investor-Call-Agenda vorbereiten (fällig: 13:30)\n🟠 P2 — Invoice-PDF an Maria schicken (überfällig seit gestern)\n🟡 P3 — Fish-Delish: Permit-Status prüfen\n🟡 P3 — Code-Review: elyra-core PR #47\n\n2 weitere Aufgaben diese Woche. Soll ich eine davon priorisieren oder direkt erledigen?",
      actionCards: [
        { id: "tasks-1", title: "P1 öffnen", detail: "Investor-Agenda — Kalender und Notizen" },
        { id: "tasks-2", title: "Invoice vorbereiten", detail: "Draft an Maria senden" },
      ],
      timeline: [
        { id: "tasks-scan", label: "Scan tasks", detail: "Lese alle Aufgaben aus Workspace..." },
        { id: "tasks-filter", label: "Filter today", detail: "Due date + priority ranking" },
        { id: "tasks-present", label: "Present list", detail: "Sortiert nach Dringlichkeit" },
      ],
    };
  }

  // ── Create task ───────────────────────────────────────────────────────────
  if (matchesAny(lowered, ["erstelle aufgabe", "neue aufgabe", "create task", "add task", "aufgabe hinzufugen", "aufgabe erstellen", "task erstellen"])) {
    return {
      intentKind: "mutation",
      openApp: "tasks",
      assistantText:
        "Aufgabe erstellt: **\"Neue Aufgabe\"** — P3, fällig heute. Öffne Tasks, um Titel, Priorität und Fälligkeitsdatum anzupassen.\n\nAlternativ: Sag mir genau was für eine Aufgabe (z.B. \"Erstelle Aufgabe: Fish-Delish Permit prüfen, P1, bis Freitag\") und ich trage alles direkt ein.",
      actionCards: [
        { id: "task-create-1", title: "Tasks öffnen", detail: "Neue Aufgabe bearbeiten" },
        { id: "task-create-2", title: "Details spezifizieren", detail: "Priorität + Fälligkeitsdatum setzen" },
      ],
      timeline: [
        { id: "tc-parse", label: "Parse intent", detail: "Aufgabendetails extrahieren..." },
        { id: "tc-create", label: "Create task", detail: "Aufgabe in Workspace schreiben", requiresConfirmation: true },
      ],
    };
  }

  // ── Inbox / unread mail ───────────────────────────────────────────────────
  if (matchesAny(lowered, ["zeig inbox", "show inbox", "ungelesene mails", "unread mail", "unread email", "meine mails", "letzte emails", "neue nachrichten"])) {
    return {
      intentKind: "read_only",
      openApp: "mail",
      assistantText:
        "Dein Posteingang — 4 ungelesene E-Mails:\n\n• **Maria (Buchhaltung)** — Invoice deadline, 16:42 gestern 🔴 dringend\n• **Andreas** — Fish-Delish Permit update, 09:15 heute\n• **GitHub** — PR #47 review requested, 08:30 heute\n• **Notion** — Weekly digest, 07:00 heute\n\nSoll ich eine davon öffnen oder eine Antwort vorbereiten?",
      actionCards: [
        { id: "inbox-1", title: "Dringende Mail öffnen", detail: "Von Maria — Invoice deadline" },
        { id: "inbox-2", title: "Alle als gelesen markieren", detail: "Digest + GitHub-Notifications" },
      ],
      timeline: [
        { id: "inbox-fetch", label: "Fetch inbox", detail: "Posteingang abrufen..." },
        { id: "inbox-rank", label: "Rank by urgency", detail: "Sortierung nach Priorität" },
      ],
    };
  }

  // ── Next meeting / calendar ───────────────────────────────────────────────
  if (matchesAny(lowered, ["nachster termin", "naechster termin", "next meeting", "next event", "was hab ich heute", "termine heute", "kalender heute", "today calendar", "today schedule"])) {
    return {
      intentKind: "read_only",
      openApp: "calendar",
      assistantText:
        "Deine heutigen Termine:\n\n• **10:00** — Daily Standup (30 min, Google Meet)\n• **14:00** — Investor Call mit Thomas Weber (60 min) 🔑\n• **16:30** — Fish-Delish: Architekten-Update (45 min)\n\nNächster Termin: **Standup in 2 Std 15 Min**. Soll ich eine Agenda vorbereiten?",
      actionCards: [
        { id: "cal-next-1", title: "Investor-Call-Agenda", detail: "Agenda für 14:00 vorbereiten" },
        { id: "cal-next-2", title: "Kalender öffnen", detail: "Wochenansicht anzeigen" },
      ],
      timeline: [
        { id: "cal-fetch", label: "Fetch events", detail: "Heutige Kalendereinträge laden..." },
        { id: "cal-sort", label: "Sort by time", detail: "Chronologisch sortieren" },
      ],
    };
  }

  // ── Schedule meeting ──────────────────────────────────────────────────────
  if (matchesAny(lowered, ["neues meeting", "schedule meeting", "termin erstellen", "meeting erstellen", "meeting planen", "besprechung planen"])) {
    return {
      intentKind: "mutation",
      openApp: "calendar",
      assistantText:
        "Ich bereite einen neuen Termin vor. Bitte bestätige Details:\n\n• **Titel**: Neues Meeting\n• **Datum**: Morgen, 10:00\n• **Dauer**: 60 Minuten\n• **Teilnehmer**: Du (weitere hinzufügen?)\n\nSoll ich diesen Termin erstellen? Du kannst die Details noch anpassen.",
      actionCards: [
        { id: "meet-1", title: "Termin erstellen", detail: "Morgen 10:00, 60 Min" },
        { id: "meet-2", title: "Details anpassen", detail: "Teilnehmer, Uhrzeit, Raum" },
      ],
      timeline: [
        { id: "meet-check", label: "Check availability", detail: "Verfügbarkeit prüfen..." },
        { id: "meet-draft", label: "Draft event", detail: "Event-Daten vorbereiten" },
        { id: "meet-create", label: "Create event", detail: "In Kalender eintragen", requiresConfirmation: true },
      ],
    };
  }

  // ── Fish-Delish workspace ─────────────────────────────────────────────────
  if (inFishDelish && matchesAny(lowered, ["almada", "location setup", "franchise status", "store setup"])) {
    return {
      intentKind: "read_only",
      openApp: "tasks",
      assistantText:
        "Almada location setup — 3 of 8 tasks completed:\n\n✅ Lease signed\n✅ Architect plans approved\n✅ Equipment order placed\n\n⏳ Construction permit — waiting (deadline: March 15)\n⏳ Staff hiring — 2 of 5 positions filled\n⏳ Menu localization — in progress\n⬜ Health inspection booking\n⬜ Soft launch date — not set\n\nThe permit is the critical path item.",
      actionCards: [
        { id: "almada-1", title: "Create follow-up tasks", detail: "Add reminders for permit and hiring deadlines" },
        { id: "almada-2", title: "Generate status report", detail: "PDF summary for stakeholders" },
      ],
      timeline: [
        { id: "almada-scan", label: "Scan project tasks", detail: "Reading Fish-Delish Almada workspace..." },
        { id: "almada-analyze", label: "Analyze progress", detail: "Calculating completion and blockers" },
        { id: "almada-report", label: "Generate report", detail: "Structured status overview" },
      ],
    };
  }

  return null;
}
