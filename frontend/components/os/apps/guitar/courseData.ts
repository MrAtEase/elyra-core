import { buildTab, type TabNote } from "./guitarData";

/** Beginner course: 12 short lessons from zero to the first song. */

export type Target = TabNote & { label: string };
export type Lesson = {
  id: string;
  title: string;
  minutes: number;
  text: string; // markdown
  visual?: { kind: "fretboard"; notes: TabNote[] } | { kind: "chord"; name: string } | { kind: "tab"; tab: string };
  exercise?:
    | { kind: "notes"; intro: string; targets: Target[] }
    | { kind: "quiz"; question: string; options: string[]; answer: string };
  action?: { label: string; tab: "tuner" | "chords" | "metronome" | "tabs" };
  tip?: string;
};

const t = (string: number, fret: number, label: string): Target => ({ string, fret, label });
const S = ["tiefe E-Saite", "A-Saite", "D-Saite", "G-Saite", "H-Saite", "hohe e-Saite"];
const open = (s: number) => t(s, 0, `${S[s]} leer`);
const fr = (s: number, f: number, finger: number) => t(s, f, `${S[s]}, ${f}. Bund (Finger ${finger})`);

export const LESSONS: Lesson[] = [
  {
    id: "l1", title: "Deine Gitarre kennenlernen", minutes: 5,
    text: `Die Gitarre hat **6 Saiten**. Von der dicksten zur dünnsten heißen sie **E – A – D – G – H – e**.
Merksatz: **E**ine **A**lte **D**ame **G**eht **H**eute **E**inkaufen.

Gezählt wird umgekehrt: Die dünne hohe **e-Saite ist die 1. Saite**, die dicke tiefe **E-Saite die 6. Saite**.

Als Rechtshänder **schlägt die rechte Hand** die Saiten an, die **linke Hand greift** auf dem Griffbrett.
Die Finger der linken Hand haben Nummern: **1** Zeigefinger, **2** Mittelfinger, **3** Ringfinger, **4** kleiner Finger.`,
    visual: { kind: "fretboard", notes: [0, 1, 2, 3, 4, 5].map((s) => ({ string: s, fret: 0 })) },
    exercise: { kind: "quiz", question: "Welche Saite ist die 1. Saite?", options: ["Die dicke tiefe E-Saite", "Die dünne hohe e-Saite", "Die A-Saite"], answer: "Die dünne hohe e-Saite" },
  },
  {
    id: "l2", title: "Gitarre stimmen", minutes: 5,
    text: `Bevor du spielst, wird gestimmt – sonst klingt auch richtig Gegriffenes falsch.

1. Öffne das **Stimmgerät** und erlaube das Mikrofon.
2. Schlag **eine Saite** an und lass sie klingen.
3. Dreh am passenden **Wirbel** am Kopf der Gitarre: Spannen macht den Ton höher, Lockern tiefer.
4. Wenn die Anzeige **grün** wird, ist die Saite gestimmt. Dann die nächste.

Dreh langsam, immer nur ein kleines Stück.`,
    action: { label: "Zum Stimmgerät", tab: "tuner" },
    tip: "Neue Saiten verstimmen sich in den ersten Tagen schnell – einfach jedes Mal kurz nachstimmen.",
  },
  {
    id: "l3", title: "Haltung & Anschlag", minutes: 10,
    text: `**Haltung:** Setz dich aufrecht hin, die Gitarre liegt mit der Taille auf deinem **rechten Oberschenkel**. Der Hals zeigt leicht nach oben.

**Anschlag:** Schlag mit dem **Daumen** oder einem **Plektrum** über dem Schallloch an. Locker aus dem Handgelenk, nicht aus dem Arm.

Jetzt die erste Übung: Spiel jede Saite **leer** (ohne zu greifen), von der dicksten zur dünnsten. Das Mikrofon hört mit.`,
    visual: { kind: "fretboard", notes: [0, 1, 2, 3, 4, 5].map((s) => ({ string: s, fret: 0 })) },
    exercise: { kind: "notes", intro: "Spiel die Saiten nacheinander leer an:", targets: [0, 1, 2, 3, 4, 5].map(open) },
  },
  {
    id: "l4", title: "Bünde & erste gegriffene Töne", minutes: 10,
    text: `Die Metallstäbchen auf dem Hals heißen **Bundstäbchen**. Der Raum dazwischen ist ein **Bund**. Der 1. Bund liegt direkt am Kopf.

So greifst du sauber:
- Drück mit der **Fingerspitze**, **kurz vor** dem Bundstäbchen (nicht genau darauf).
- Der **Daumen** liegt hinten am Hals, etwa hinter dem Mittelfinger.
- Nicht zu fest – nur so viel, dass es nicht schnarrt.

Spiel jetzt auf der **hohen e-Saite**: leer, dann 1. Bund mit Finger 1, dann 3. Bund mit Finger 3.`,
    visual: { kind: "fretboard", notes: [{ string: 5, fret: 0 }, { string: 5, fret: 1 }, { string: 5, fret: 3 }] },
    exercise: { kind: "notes", intro: "Spiel diese drei Töne:", targets: [open(5), fr(5, 1, 1), fr(5, 3, 3)] },
    tip: "Die Fingerkuppen tun anfangs weh. Das ist normal und vergeht nach 1–2 Wochen täglichen Übens.",
  },
  {
    id: "l5", title: "Tabs lesen", minutes: 5,
    text: `**Tabs** zeigen dir genau, wo du greifen musst – ohne Noten.

- Es gibt **6 Linien**, eine pro Saite. **Oben ist die dünne hohe e-Saite**, unten die dicke E-Saite.
- Die **Zahl** ist der Bund. **0** heißt: leer spielen.
- Gelesen wird **von links nach rechts**. Zahlen genau übereinander spielst du gleichzeitig.

Beispiel unten: Erst die e-Saite leer, dann 1. Bund, dann 3. Bund – genau das aus Lektion 4.`,
    visual: { kind: "tab", tab: buildTab([[{ string: 5, fret: 0 }], [{ string: 5, fret: 1 }], [{ string: 5, fret: 3 }]]) },
    exercise: { kind: "quiz", question: "Was bedeutet eine 3 auf der obersten Linie?", options: ["Tiefe E-Saite, 3. Bund", "Hohe e-Saite, 3. Bund", "Dreimal anschlagen"], answer: "Hohe e-Saite, 3. Bund" },
  },
  {
    id: "l6", title: "Erste Melodie: Ode an die Freude", minutes: 10,
    text: `Jetzt spielst du deine erste Melodie! Sie nutzt nur zwei Saiten: die **hohe e-Saite** und die **H-Saite**.

Auf der H-Saite greifst du den **1. Bund mit Finger 1** und den **3. Bund mit Finger 3**.
Langsam ist völlig okay – das Mikrofon wartet auf dich.`,
    visual: {
      kind: "tab",
      tab: buildTab([[{ string: 5, fret: 0 }], [{ string: 5, fret: 0 }], [{ string: 5, fret: 1 }], [{ string: 5, fret: 3 }], [{ string: 5, fret: 3 }], [{ string: 5, fret: 1 }], [{ string: 5, fret: 0 }], [{ string: 4, fret: 3 }], [{ string: 4, fret: 1 }], [{ string: 4, fret: 1 }], [{ string: 4, fret: 3 }], [{ string: 5, fret: 0 }], [{ string: 5, fret: 0 }], [{ string: 4, fret: 3 }], [{ string: 4, fret: 3 }]]),
    },
    exercise: {
      kind: "notes", intro: "Spiel die Melodie Ton für Ton:",
      targets: [open(5), open(5), fr(5, 1, 1), fr(5, 3, 3), fr(5, 3, 3), fr(5, 1, 1), open(5), fr(4, 3, 3), fr(4, 1, 1), fr(4, 1, 1), fr(4, 3, 3), open(5), open(5), fr(4, 3, 3), fr(4, 3, 3)],
    },
    action: { label: "Im Tab-Player mitspielen", tab: "tabs" },
  },
  {
    id: "l7", title: "Akkord-Diagramme lesen", minutes: 5,
    text: `Ein **Akkord** sind mehrere Töne gleichzeitig. Das Diagramm zeigt das Griffbrett **von vorn**, aufrecht gestellt:

- Die **senkrechten Linien** sind die Saiten – **links die dicke E-Saite**, rechts die dünne e-Saite.
- Die **waagerechten Linien** sind die Bundstäbchen, oben der Sattel.
- **Punkte mit Zahl** zeigen, welcher Finger wohin kommt.
- **○** heißt leer mitspielen, **×** heißt diese Saite nicht anschlagen.`,
    visual: { kind: "chord", name: "Em" },
    exercise: { kind: "quiz", question: "Was bedeutet ein × über einer Saite?", options: ["Leer spielen", "Nicht anschlagen", "Mit Finger 1 greifen"], answer: "Nicht anschlagen" },
  },
  {
    id: "l8", title: "Dein erster Akkord: Em", minutes: 10,
    text: `**E-Moll (Em)** ist der leichteste Akkord – nur zwei Finger:
- **Finger 2** auf die **A-Saite, 2. Bund**
- **Finger 3** auf die **D-Saite, 2. Bund**

Dann alle 6 Saiten anschlagen. Damit jede Saite sauber klingt, prüfen wir sie einzeln: Halte den Griff und zupf eine Saite nach der anderen.`,
    visual: { kind: "chord", name: "Em" },
    exercise: { kind: "notes", intro: "Griff halten, Saite für Saite zupfen:", targets: [open(0), fr(1, 2, 2), fr(2, 2, 3), open(3), open(4), open(5)] },
    tip: "Schnarrt eine Saite? Finger näher ans Bundstäbchen und steiler aufsetzen, damit er die Nachbarsaite nicht berührt.",
  },
  {
    id: "l9", title: "Zweiter Akkord: Am", minutes: 10,
    text: `**A-Moll (Am)** – die tiefe E-Saite wird **nicht** gespielt (×):
- **Finger 1** auf die **H-Saite, 1. Bund**
- **Finger 2** auf die **D-Saite, 2. Bund**
- **Finger 3** auf die **G-Saite, 2. Bund**

Schlag von der **A-Saite** abwärts an.`,
    visual: { kind: "chord", name: "Am" },
    exercise: { kind: "notes", intro: "Griff halten, Saite für Saite zupfen (ab A-Saite):", targets: [open(1), fr(2, 2, 2), fr(3, 2, 3), fr(4, 1, 1), open(5)] },
    tip: "Trick: Finger 2 und 3 haben dieselbe Form wie bei Em – nur eine Saite weiter unten. Finger 1 kommt dazu.",
  },
  {
    id: "l10", title: "Wechsel Em ↔ Am im Takt", minutes: 10,
    text: `Jetzt wird es musikalisch: zwischen zwei Akkorden wechseln.

1. Stell das **Metronom auf 60 BPM**.
2. Spiel **Em**: 4 Schläge abwärts, einer pro Klick.
3. Wechsle zu **Am**: wieder 4 Schläge.
4. Immer weiter, 2 Minuten lang.

Klappt es sauber? Dann 70 BPM, später 80.`,
    visual: { kind: "chord", name: "Am" },
    action: { label: "Metronom öffnen", tab: "metronome" },
    tip: "Lieber langsam und sauber als schnell und holprig. Das Tempo kommt von allein.",
  },
  {
    id: "l11", title: "Neue Akkorde: C und G", minutes: 15,
    text: `**C-Dur (C)** – tiefe E-Saite nicht spielen:
- Finger **3**: A-Saite, 3. Bund · Finger **2**: D-Saite, 2. Bund · Finger **1**: H-Saite, 1. Bund

**G-Dur (G)** – alle 6 Saiten:
- Finger **2**: tiefe E-Saite, 3. Bund · Finger **1**: A-Saite, 2. Bund · Finger **3**: hohe e-Saite, 3. Bund

Prüf zuerst C Saite für Saite, danach G im Tab „Akkorde“.`,
    visual: { kind: "chord", name: "C" },
    exercise: { kind: "notes", intro: "C greifen, Saite für Saite zupfen (ab A-Saite):", targets: [fr(1, 3, 3), fr(2, 2, 2), open(3), fr(4, 1, 1), open(5)] },
    action: { label: "Akkorde ansehen", tab: "chords" },
  },
  {
    id: "l12", title: "Dein erstes Lied begleiten: G – Em – C – D", minutes: 15,
    text: `Diese vier Akkorde stecken in **hunderten Liedern**. Lern noch **D**:
- Finger **1**: G-Saite, 2. Bund · Finger **3**: H-Saite, 3. Bund · Finger **2**: hohe e-Saite, 2. Bund (nur ab D-Saite spielen)

**Ablauf:** G – Em – C – D, je 4 Schläge, Metronom auf 60.
**Schlagmuster für später:** ab – ab – auf – auf – ab – auf.

Wenn das läuft, kannst du schon viele bekannte Songs begleiten. Akkorde zu deinen Lieblingssongs findest du z. B. auf Ultimate Guitar – füge sie im Tab „Tabs“ ein.`,
    visual: { kind: "chord", name: "D" },
    exercise: { kind: "notes", intro: "D greifen, Saite für Saite zupfen (ab D-Saite):", targets: [open(2), fr(3, 2, 1), fr(4, 3, 3), fr(5, 2, 2)] },
    action: { label: "Akkordfolge im Tab-Player", tab: "tabs" },
  },
];
