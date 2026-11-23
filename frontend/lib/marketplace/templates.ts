/**
 * Mini-app templates: Elly builds them with one click from a tested description.
 * They run in the sandbox like every mini-app (no network, no access to Elyra data).
 */

export type MiniAppTemplate = {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  /** Build description handed to Elly. */
  prompt: string;
  /** Sensitive data (health, money): only offered in a personal workspace. */
  personalOnly?: boolean;
  /** Hand-built, tested version (served from /public). Installed as is – Elly only for later changes. */
  prebuilt?: string;
};

export const TEMPLATE_CATEGORIES = [
  "Finanzen",
  "Gesundheit",
  "Zuhause",
  "Reisen",
  "Arbeit",
  "Lernen",
  "Freizeit",
  "Schreiben",
] as const;

const NO_FINANCE_ADVICE = "Zeige unten dezent den Hinweis: „Elly zeigt und analysiert nur – keine Finanzberatung, kein Zugriff aufs Konto.“";
const NO_MEDICAL_ADVICE = "Zeige unten dezent den Hinweis: „Kein Ersatz für ärztlichen Rat.“";

export const TEMPLATES: MiniAppTemplate[] = [
  // ── Finanzen ──
  {
    id: "tpl-haushaltsbuch", name: "Haushaltsbuch", icon: "💶", category: "Finanzen", personalOnly: true,
    prebuilt: "/mini-app-templates/haushaltsbuch.html",
    description: "Finanz-Dashboard: Kontoauszug importieren (Revolut & andere Banken), Kennzahlen, Diagramme, Budgets, Abos & Fixkosten, Sparziele und Spartipps.",
    prompt: `Ein professionelles Finanz-Dashboard („Haushaltsbuch“) mit Kontoauszug-Import – Aufbau wie ein modernes Banking-/SaaS-Dashboard.

Kopfbereich (.e-header): Titel „Haushaltsbuch“, Untertitel mit Zeitraum; rechts Monatsauswahl (.e-select, Monate mit Daten, neueste zuerst) und Knopf „Importieren“ (.e-btn.primary).
Tabs (.e-tabs): Übersicht · Buchungen · Kategorien & Budget · Import.

ÜBERSICHT
- 4 KPI-Kacheln (.e-grid > .e-card .e-kpi): Einnahmen, Ausgaben, Saldo, Sparquote (Saldo/Einnahmen). Jeweils Veränderung zum Vormonat mit elyra.delta (bei Ausgaben {invert:true}) und Sparkline der letzten 6 Monate (elyra.chart.spark).
- Zeile mit zwei Karten (.e-grid-2): links „Ausgaben nach Kategorie“ als Donut (elyra.chart.donut, Mitte = Summe Ausgaben); rechts „Einnahmen vs. Ausgaben“ der letzten 6 Monate als gruppierte Balken (elyra.chart.bars mit series Einnahmen/Ausgaben).
- Zeile mit zwei Karten: links „Saldo-Verlauf“ (kumulierter Kontostand bzw. Saldo pro Tag im Monat, elyra.chart.line mit area:true); rechts „Top-Händler“ als horizontale Balken (elyra.chart.bars horizontal:true, Top 8 nach Ausgaben).
- Karte „Auffälligkeiten“: größte Einzelausgabe, Kategorie mit stärkstem Anstieg zum Vormonat, Anzahl Abos – als .e-list mit .e-badge.

BUCHUNGEN
- Filterzeile: Suche (Text), Kategorie (.e-select), Typ (alle/Einnahmen/Ausgaben).
- Tabelle (.e-table): Datum, Beschreibung, Kategorie (als .e-badge mit .e-dot in elyra.chart.color passend zur Kategorie, per Klick änderbar über ein .e-select), Betrag (class num, .e-pos/.e-neg). Sortierbar per Klick auf Spaltenkopf. Paginierung 50 Zeilen.
- Knopf „Buchung hinzufügen“ öffnet ein Inline-Formular (.e-form).
- Kategorie ändern merkt sich eine Regel (Stichwort aus der Beschreibung → Kategorie) und wendet sie auf gleiche Händler an.

KATEGORIEN & BUDGET
- Pro Kategorie eine Zeile: Farbpunkt, Name, Ausgaben im Monat, Budget (editierbar, .e-input), .e-progress (warn ab 80 %, over über 100 %), Rest.
- Kategorien anlegen/umbenennen. Regeln (Stichwort → Kategorie) als Liste mit Löschen.

IMPORT
- .e-dropzone (Klick öffnet <input type="file" accept=".csv,.txt">, Drag & Drop unterstützt). Datei mit FileReader lesen.
- Eigener CSV-Parser: Trennzeichen , ; oder Tab automatisch erkennen, Anführungszeichen und Zeilenumbrüche in Feldern, Dezimalkomma und -punkt, Datumsformate YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY (mit Uhrzeit).
- Revolut-Format automatisch erkennen (Spalten: Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance; nur State = COMPLETED; Gebühren als eigene Ausgabe). Andere Banken: Vorschau der ersten 5 Zeilen und Spaltenzuordnung (Datum, Beschreibung, Betrag oder Soll/Haben).
- Duplikate überspringen (Datum + Betrag + Beschreibung). Ergebnis-Meldung: „123 importiert, 4 Duplikate übersprungen“.
- Automatische Kategorien per Stichwort (Lebensmittel: continente, pingo doce, lidl, aldi, mercadona, minipreço, auchan; Transport: uber, bolt, cp, metro, carris, galp, repsol, bp, via verde; Wohnen: renda, edp, epal, endesa, meo, nos, vodafone; Essen gehen: restaurante, café, glovo, uber eats, bolt food; Abos: netflix, spotify, apple, google, amazon prime, disney, chatgpt, openai; Gesundheit: farmácia, wells; Shopping: amazon, zara, fnac, worten, ikea; Einkommen: positive Beträge außer Umbuchungen). Unbekannt → „Sonstiges“.
- Optional „Elly fragen“ in der Übersicht: sendet nur Monatssummen je Kategorie (keine Einzelbuchungen, keine Kontonummern) an elyra.ask und zeigt 3 kurze Spartipps in einer Karte.

Leere Zustände: Ohne Daten zeigt die Übersicht eine .e-empty-Karte mit Hinweis und Knopf zum Import sowie Knopf „Beispieldaten laden“ (3 Monate realistische Buchungen in Portugal, als Beispiel markiert, mit „Beispieldaten entfernen“).
Alles mit elyra.set speichern (Buchungen, Regeln, Budgets, Kategorien). ${NO_FINANCE_ADVICE}`,
  },
  // ── Gesundheit ──
  {
    id: "tpl-fitness", name: "Fitness & Gewohnheiten", icon: "🏋️", category: "Gesundheit", personalOnly: true,
    description: "Trainingsplan mit Fortschritt und tägliche Gewohnheiten (Wasser, Schritte, Schlaf) an einem Ort.",
    prompt: `Eine App mit Tabs (Training / Gewohnheiten). Tab „Training“: Ein Trainingsplaner. Trainingstage der Woche mit Übungen (Name, Sätze, Wiederholungen, Gewicht) anlegen. Training starten: Übungen abhaken, tatsächliches Gewicht eintragen. Verlauf pro Übung als kleines Liniendiagramm (SVG). Optional „Elly fragen“: lässt per elyra.ask einen Einsteigerplan für Ziel und Tage pro Woche vorschlagen, den man übernehmen kann. Tab „Gewohnheiten“: Ein Gewohnheiten-Tracker. Gewohnheiten anlegen (Name, Emoji, Ziel pro Tag als Zahl oder Ja/Nein, z. B. Wasser 8 Gläser). Heute-Ansicht mit großen Tippflächen (+1 / abhaken). Wochenraster (7 Tage) je Gewohnheit, aktuelle Serie in Tagen. Alles speichern mit elyra.set. ${NO_MEDICAL_ADVICE}`,
  },
  {
    id: "tpl-gesundheit", name: "Gesundheits-Organizer", icon: "🩺", category: "Gesundheit", personalOnly: true,
    description: "Einnahmeplan mit Vorrat und Arzttermine vorbereiten – Fragen, Beschwerden, Notizen.",
    prompt: `Eine App mit Tabs (Medikamente / Arzttermine). Tab „Medikamente“: Ein Medikamenten-Plan. Einträge mit Name, Dosis (freier Text), Uhrzeiten pro Tag, Vorrat (Stück). Heute-Ansicht: anstehende Einnahmen nach Uhrzeit, abhaken (reduziert Vorrat), verpasste markieren. Hinweis, wenn Vorrat unter 7 Tagen. Verlauf der letzten 14 Tage. Keine Dosierungsempfehlungen geben. Tab „Arzttermine“: Eine App zur Vorbereitung von Arztterminen. Termin anlegen (Arzt/Fachrichtung, Datum). Felder: Beschwerden (seit wann, wie stark 1–10), aktuelle Medikamente, Fragen an den Arzt (Liste, sortierbar). Ansicht „Zettel“: alles kompakt und druckfreundlich. Nach dem Termin: Notizen zu Antworten. Optional „Fragen ergänzen“ per elyra.ask (nur allgemeine Fragen, keine Diagnose). Alles speichern mit elyra.set. ${NO_MEDICAL_ADVICE}`,
  },
  // ── Zuhause ──
  {
    id: "tpl-kueche", name: "Küche & Einkauf", icon: "🍳", category: "Zuhause",
    prebuilt: "/mini-app-templates/kueche.html",
    description: "Wochenplan mit Frühstück, Mittag und Abend, Rezepte von Elly nach deinen Vorlieben (Fisch, Fleisch, vegetarisch, vegan, Hülsenfrüchte) und eine Einkaufsliste nach Supermarkt-Bereichen.",
    prompt: `Eine Küchen-App mit Tabs Wochenplan · Rezepte · Einkaufsliste · Vorlieben. Wochenplan Montag–Sonntag mit Frühstück, Mittag, Abend; „Woche von Elly planen“ per elyra.ask nach Vorlieben (Ernährungsarten, Lieblingsküchen, Kochniveau, Zeit werktags/Wochenende, Unverträglichkeiten). Rezepte mit Zutaten (für die eingestellte Personenzahl umgerechnet) und Schritten, von Elly ausarbeiten lassen. Einkaufsliste automatisch aus dem Plan, nach Supermarkt-Bereichen gruppiert, abhakbar, eigene Einträge. Speichern mit elyra.set.`,
  },
  {
    id: "tpl-putzplan", name: "Putzplan (WG/Familie)", icon: "🧹", category: "Zuhause",
    description: "Aufgaben im Wechsel auf Personen verteilen – jede Woche automatisch rotiert.",
    prompt: `Ein Putzplan für WG oder Familie. Personen und Aufgaben (mit Rhythmus: wöchentlich/alle 2 Wochen) anlegen. Aufgaben werden jede Kalenderwoche reihum verteilt. Wochenansicht mit Abhaken, Vorwoche/Nächste Woche blättern, Übersicht wer wie viel erledigt hat. Speichern mit elyra.set.`,
  },
  {
    id: "tpl-wohnen", name: "Wohnung & Behörden", icon: "🏠", category: "Zuhause",
    description: "Wohnungssuche, Fristen und Dokumente sowie Zählerstände an einem Ort.",
    prompt: `Eine App mit Tabs (Wohnungssuche / Fristen & Dokumente / Zählerstände). Tab „Wohnungssuche“: Ein Wohnungs-/Zimmersuche-Tracker. Angebote mit Titel, Ort, Preis, Link (nur als Text anzeigen), Kontakt, Notizen, Merkmale (Haustiere erlaubt, Garten, möbliert). Status-Spalten (Gemerkt, Angefragt, Besichtigung, Zugesagt, Abgesagt) mit Verschieben per Knopf. Besichtigungstermin mit Datum. Filter nach Merkmalen und Höchstpreis. Tab „Fristen & Dokumente“: Ein Fristen-Tracker. Einträge mit Name, Kategorie (Ausweis, Versicherung, Vertrag, Steuer, Auto, Sonstiges), Ablauf-/Fälligkeitsdatum, Kündigungsfrist in Tagen, Notiz. Sortierte Liste nach Dringlichkeit mit farbigen Hinweisen (überfällig, < 30 Tage, < 90 Tage). Keine Ausweisnummern speichern – das Feld heißt nur „Notiz“. Tab „Zählerstände“: Eine Zählerstand-App. Zähler (Strom kWh, Wasser m³, Gas m³) mit Preis pro Einheit. Ablesungen mit Datum eintragen; Verbrauch zwischen Ablesungen, Kosten, Durchschnitt pro Monat, Balkendiagramm (SVG). Alles speichern mit elyra.set.`,
  },
  {
    id: "tpl-haustier", name: "Haustier-Logbuch", icon: "🐶", category: "Zuhause",
    description: "Tierarzt, Impfungen, Futter und Gassirunden im Blick.",
    prompt: `Eine App mit Tabs (Logbuch / Gassi). Tab „Logbuch“: Ein Haustier-Logbuch. Tiere mit Name, Art, Rasse, Geburtsdatum, Foto als Emoji. Pro Tier: Impfungen/Entwurmung/Zeckenschutz mit nächstem Termin (Hinweis wenn fällig), Tierarztbesuche mit Notizen, Gewichtsverlauf (SVG-Linie), Futter (Marke, Menge pro Tag). Tab „Gassi“: Ein Gassi-Log. Schnell-Eintrag mit Start/Stopp-Timer oder manuell (Dauer, Uhrzeit, wer, Notiz z. B. „Geschäft erledigt“). Heute-Übersicht, Wochenübersicht mit Minuten pro Tag (Balken), Serien. Alles speichern mit elyra.set.`,
  },
  // ── Reisen ──
  {
    id: "tpl-reise", name: "Reiseplaner", icon: "🗺️", category: "Reisen",
    description: "Reiseplan, Budget und Packliste für jede Reise.",
    prompt: `Eine App mit Tabs (Plan / Budget / Packliste). Tab „Plan“: Ein Reiseplaner. Reise mit Ziel und Datum von–bis; pro Tag Stationen (Uhrzeit, Ort, Notiz, erledigt). Umsortieren per Hoch/Runter-Knöpfen. „Vorschläge von Elly“: per elyra.ask einen Tagesplan für Ziel und Interessen holen (als JSON parsen) und übernehmen. Tab „Budget“: Eine Reisekasse. Reise mit Budget und Mitreisenden anlegen. Ausgaben eintragen (Betrag, Währung, Kurs zu € manuell änderbar, Kategorie, wer hat bezahlt, für wen). Übersicht: Summe in €, Rest-Budget, pro Tag, und „Wer schuldet wem“ mit minimalen Ausgleichszahlungen. Tab „Packliste“: Eine Packlisten-App. Reise anlegen (Ziel, Tage, Art: Strand, Surf, Stadt, Business, Wandern). Vorschlagsliste je Art, gruppiert (Kleidung, Hygiene, Technik, Dokumente), Menge bei Kleidung nach Tagen. Abhaken, eigene Einträge, als Vorlage für die nächste Reise speichern. Alles speichern mit elyra.set.`,
  },
  // ── Arbeit ──
  {
    id: "tpl-jobsuche", name: "Karriere-Hub", icon: "💼", category: "Arbeit",
    prebuilt: "/mini-app-templates/jobsuche.html",
    description: "Live-Stellen aus Arbeitsagentur, Arbeitnow und Remotive, Bewerbungs-Board mit Nachfass-Erinnerung, Interview-Training mit Elly und gewichteter Angebotsvergleich.",
    prompt: `Ein Karriere-Hub mit Tabs Live-Jobs · Bewerbungen · Interview-Training · Angebote. Live-Jobs: Suche (Was, Wo, Remote, Zeitraum) über elyra.jobs, Ergebnisse mit Quelle und Datum, „Merken“ legt die Stelle ins Board, „Passt das?“ vergleicht per elyra.ask mit dem eigenen Profil, Links öffnen mit elyra.open. Bewerbungen als Board (Interessant, Beworben, Gespräch, Angebot, Absage) mit Erinnerung nach 10 Tagen. Interview-Training mit 8 Fragen und STAR-Feedback. Angebote mit gewichteten Kriterien. Speichern mit elyra.set.`,
  },
  {
    id: "tpl-projekte", name: "Projekt-Board", icon: "🗂️", category: "Arbeit",
    description: "Kanban-Board mit Wochenbericht auf Knopfdruck.",
    prompt: `Eine App mit Tabs (Board / Wochenbericht). Tab „Board“: Ein Kanban-Board. Mehrere Boards; Spalten frei benennbar (Standard: Offen, In Arbeit, Review, Fertig). Karten mit Titel, Beschreibung, Person, Fälligkeit, Priorität. Karten per Drag & Drop (HTML5) und alternativ per Knopf verschieben. Filter nach Person. Tab „Wochenbericht“: Ein Wochenbericht-Generator. Felder: erledigt, in Arbeit, Probleme, nächste Woche (je Stichpunkte). Knopf „Bericht erstellen“: elyra.ask macht daraus einen kurzen, professionellen Bericht (Ton wählbar: sachlich/locker). Ergebnis kopierbar (Clipboard-API mit Fallback Textauswahl). Frühere Berichte nach Kalenderwoche speichern mit elyra.set. Alles speichern mit elyra.set.`,
  },
  {
    id: "tpl-urlaub", name: "Urlaubsplaner (Team)", icon: "🏖️", category: "Arbeit",
    description: "Wer ist wann weg? Jahresübersicht mit Resturlaub pro Person.",
    prompt: `Ein Team-Urlaubsplaner. Personen mit Urlaubsanspruch. Abwesenheiten (von–bis, Art: Urlaub, krank, Fortbildung). Monatsansicht als Raster (Personen × Tage, Wochenenden gedämpft), Überschneidungen markieren, Resturlaub pro Person. Speichern mit elyra.set.`,
  },
  // ── Lernen ──
  {
    id: "tpl-lernen", name: "Lernplaner", icon: "📚", category: "Lernen",
    description: "Karteikarten, Prüfungsplan und Erklärungen von Elly in einfachen Worten.",
    prompt: `Eine App mit Tabs (Karteikarten / Prüfungsplan / Erklär's mir). Tab „Karteikarten“: Eine Karteikarten-App mit Leitner-System (5 Fächer). Stapel und Karten (Vorderseite/Rückseite). Lernmodus: Karte umdrehen, „gewusst“/„nicht gewusst“ verschiebt das Fach; fällige Karten nach Fach-Intervall (1, 2, 4, 8, 16 Tage). „Karten aus Text“: Text einfügen, elyra.ask erzeugt 10 Karten als JSON. Statistik je Stapel. Tab „Prüfungsplan“: Ein Lernplaner. Prüfung mit Datum, Themen mit geschätztem Aufwand (Stunden), Lerntage pro Woche. Automatischer Plan: Themen auf die Tage bis zur Prüfung verteilen, letzte 2 Tage Wiederholung. Tage abhaken, Plan neu berechnen wenn man zurückliegt. Tab „Erklär's mir“: Eine Erklär-App. Thema eingeben, Elly erklärt per elyra.ask in drei Stufen (wie für ein Kind, Erwachsene, Profis) – Antwort als JSON {einfach, normal, profi} parsen, als Tabs anzeigen. Danach 3 Quizfragen zum Thema (JSON) mit Auflösung. Verlauf der Themen speichern mit elyra.set. Alles speichern mit elyra.set.`,
  },
  // ── Freizeit & Schreiben ──
  {
    id: "tpl-surflog", name: "Surf-Logbuch", icon: "🏄", category: "Freizeit",
    description: "Sessions mit Spot, Wellen, Board und Bewertung – Statistik pro Spot.",
    prompt: `Ein Surf-Logbuch. Session mit Spot (Auswahl aus bisherigen + neu), Datum, Wellenhöhe (m), Periode (s), Wind (Text), Board, Dauer, Bewertung 1–5, Notizen. Liste mit Filter nach Spot, Statistik: Sessions und Durchschnittsbewertung je Spot, beste Bedingungen je Spot. Speichern mit elyra.set.`,
  },
  {
    id: "tpl-sammlungen", name: "Bücher, Filme & Ideen", icon: "🎬", category: "Freizeit",
    description: "Was du lesen und sehen willst – und alle Ideen, die dir einfallen.",
    prompt: `Eine App mit Tabs (Bücher & Filme / Ideen). Tab „Bücher & Filme“: Eine Medienliste für Bücher, Filme und Serien. Einträge mit Typ, Titel, Autor/Regie, Status (Will ich, Läuft, Fertig), Bewertung 1–5, Notiz. Tabs nach Typ, Filter nach Status. „Empfehlung von Elly“: per elyra.ask 5 Vorschläge auf Basis der gut bewerteten Einträge. Tab „Ideen“: Eine Ideen-Sammlung. Schnelleingabe oben (Enter speichert). Ideen mit Tags, Stern-Markierung, Notizen. Suche und Filter nach Tags. „Weiterdenken“: elyra.ask liefert zu einer Idee 3 Ausbau-Vorschläge und 3 kritische Fragen. Alles speichern mit elyra.set.`,
  },
  {
    id: "tpl-tagebuch", name: "Tagebuch", icon: "📔", category: "Schreiben", personalOnly: true,
    description: "Ein Eintrag pro Tag mit Stimmung – Rückblick nach Wochen und Monaten.",
    prompt: `Ein Tagebuch. Ein Eintrag pro Tag (Datum wählbar), Stimmung per 5 Emojis, Text, Tags. Kalenderansicht des Monats mit Stimmungs-Emoji je Tag, Suche im Text. Keine KI-Funktionen (privat). Speichern mit elyra.set.`,
  },
  {
    id: "tpl-buchprojekt", name: "Buchprojekt", icon: "📖", category: "Schreiben",
    description: "Kapitel, Notizen und Figuren für ein Buch – mit Wortzählung und Schreibziel.",
    prompt: `Ein Schreibprojekt-Organizer. Kapitel (Titel, Text, Status: Idee/Entwurf/Überarbeitet), umsortierbar; Figuren und Orte als Notizkarten; Wortzahl je Kapitel und gesamt, Tagesziel in Wörtern mit Fortschritt. Ablenkungsfreier Schreibmodus (nur Textfeld). Speichern mit elyra.set.`,
  },
];

export function templateById(id: string): MiniAppTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
