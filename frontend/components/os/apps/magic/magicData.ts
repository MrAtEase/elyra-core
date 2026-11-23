/**
 * Card magic curriculum. All texts are written in our own words.
 * Book references point to where a technique is taught in depth:
 *  - Erdnase: "The Expert at the Card Table" (1902, public domain)
 *  - Royal Road: Hugard & Braué, "The Royal Road to Card Magic"
 *  - Card College: Roberto Giobbi, "Card College"
 */

export type Book = "Royal Road" | "Card College" | "Erdnase";

export type StackCard = { label?: string; hi?: boolean; jog?: "in" | "out" | "side"; face?: boolean };
export type Diagram =
  | { kind: "stack"; title: string; cards: StackCard[]; breakAfter?: number; caption?: string }
  | { kind: "grip"; grip: "mechanics" | "biddle" | "break" | "dealing"; caption?: string }
  | { kind: "spread"; count: number; hi?: number; fan?: boolean; caption?: string }
  | { kind: "piles"; piles: Array<{ label: string; hi?: boolean; note?: string }>; caption?: string };

export type Move = {
  id: string;
  name: string;
  en?: string;
  category: string;
  level: 1 | 2 | 3 | 4 | 5;
  books: Book[];
  purpose: string;
  steps: string[];
  mistakes: string[];
  drill: string;
  diagrams?: Diagram[];
};

export type Trick = {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  effect: string;
  uses: string[]; // move ids
  setup: string;
  method: string[];
  presentation: string;
  diagrams?: Diagram[];
};

export const CATEGORIES = [
  "Griffe & Grundlagen", "Mischen", "Kontrollen", "Falsches Abheben", "Forcen",
  "Hebungen & Glide", "Palmieren", "Austeilen", "Pass & Farbwechsel", "Fächer & Flourishes",
];

export const LEVEL_LABEL = ["", "Einsteiger", "Grundlagen", "Fortgeschritten", "Experte", "Meister"];

export const MOVES: Move[] = [
  {
    id: "mechanics", name: "Mechanikergriff", en: "Mechanic's Grip", category: "Griffe & Grundlagen", level: 1,
    books: ["Erdnase", "Royal Road", "Card College"],
    purpose: "Der Grundgriff der linken Hand – Ausgangsposition für fast alles: Austeilen, Hebungen, Breaks.",
    steps: [
      "Deck in die linke Hand, Bildseite nach unten.",
      "Zeigefinger gekrümmt an die vordere (äußere) Schmalseite.",
      "Mittel-, Ring- und kleiner Finger an die rechte Längsseite.",
      "Daumen locker schräg oben auf dem Deck bzw. an der linken Kante.",
      "Das Deck liegt leicht schräg, die linke hintere Ecke im Handballen.",
    ],
    mistakes: ["Zu fest greifen – die Hand muss locker bleiben.", "Zeigefinger flach auf die Oberseite legen statt an die Vorderkante."],
    drill: "Deck 2 Minuten im Griff halten, dabei 10× die oberste Karte mit dem Daumen leicht nach rechts schieben und zurückziehen.",
    diagrams: [{ kind: "grip", grip: "mechanics", caption: "Draufsicht: Fingerpositionen im Mechanikergriff" }],
  },
  {
    id: "biddle", name: "Biddle-Griff", en: "Biddle Grip", category: "Griffe & Grundlagen", level: 1,
    books: ["Card College"],
    purpose: "Rechte Hand hält das Deck von oben an den Schmalseiten – Basis für Abheben, Hebungen und Kontrollen.",
    steps: [
      "Rechte Hand kommt von oben über das Deck.",
      "Daumen an die hintere (innere) Schmalseite, nahe der rechten Ecke.",
      "Mittel- und Ringfinger an die vordere Schmalseite.",
      "Zeigefinger leicht gekrümmt oben auf dem Deck, kleiner Finger locker daneben.",
    ],
    mistakes: ["Finger verdecken die Vorderseite zu stark – es soll natürlich aussehen.", "Daumen in der Mitte statt an der Ecke."],
    drill: "Deck abwechselnd im Mechanikergriff und Biddle-Griff übernehmen, 20 Wiederholungen ohne Hinsehen.",
    diagrams: [{ kind: "grip", grip: "biddle", caption: "Draufsicht: Daumen hinten, Mittel-/Ringfinger vorn" }],
  },
  {
    id: "break", name: "Kleiner-Finger-Break", en: "Little Finger Break", category: "Griffe & Grundlagen", level: 2,
    books: ["Royal Road", "Card College", "Erdnase"],
    purpose: "Eine unsichtbare Trennung im Deck halten – merkt sich eine Position für Kontrollen und Hebungen.",
    steps: [
      "Deck im Mechanikergriff.",
      "Die Kuppe des kleinen Fingers drückt an der hinteren rechten Ecke leicht zwischen die Karten.",
      "Der Spalt ist nur an der Ecke, kaum sichtbar – vorne liegt das Deck geschlossen.",
      "Die rechte Hand oder der Daumen kann den Spalt beim Abheben oder Hebungen nutzen.",
    ],
    mistakes: ["Spalt zu groß – von der Seite sichtbar.", "Kleiner Finger steht weit heraus."],
    drill: "Mit dem Daumen eine Karte von oben abheben und mit dem kleinen Finger einen Break darunter nehmen. 30× pro Tag, auch beim Fernsehen.",
    diagrams: [{ kind: "stack", title: "Seitenansicht", cards: [{ label: "oberste Karte" }, { label: "" }, { label: "" }, { label: "" }, { label: "" }], breakAfter: 1, caption: "Break unter der obersten Karte, gehalten an der hinteren rechten Ecke" }],
  },
  {
    id: "overhand", name: "Überhandmischen", en: "Overhand Shuffle", category: "Mischen", level: 1,
    books: ["Royal Road", "Card College", "Erdnase"],
    purpose: "Das Alltagsmischen – und Grundlage vieler Kontrollen. Muss völlig natürlich aussehen.",
    steps: [
      "Rechte Hand hält das Deck hochkant, Bildseite zur linken Handfläche.",
      "Linker Daumen zieht kleine Pakete von der Oberseite (der Rückseite) in die linke Hand.",
      "Die rechte Hand bewegt sich gleichmäßig auf und ab, die linke nimmt Paket für Paket auf.",
      "Merke: Die zuerst abgezogenen Karten landen unten im linken Stapel.",
    ],
    mistakes: ["Zu schnell und hektisch.", "Ungleichmäßiger Rhythmus – der verrät später Kontrollen."],
    drill: "1 Minute gleichmäßig mischen. Dann nur Einzelkarten abziehen („Durchlaufen“) – 10 Karten genau einzeln.",
  },
  {
    id: "hindu", name: "Hindu-Mischen", en: "Hindu Shuffle", category: "Mischen", level: 1,
    books: ["Royal Road", "Card College"],
    purpose: "Elegantes Mischen von oben – Basis für Hindu-Force und Hindu-Kontrollen.",
    steps: [
      "Rechte Hand hält das Deck von oben an den Schmalseiten (Daumen hinten, Finger vorne).",
      "Linke Hand umfasst die Oberseite: Daumen links, Finger rechts.",
      "Rechte Hand zieht das Deck nach hinten heraus, die linke behält dabei ein Paket von oben.",
      "Wiederholen, bis die rechte Hand leer ist. Die unterste Karte der rechten Hand bleibt immer dieselbe.",
    ],
    mistakes: ["Linke Finger greifen zu tief.", "Pakete fallen unkontrolliert."],
    drill: "Hindu-Mischen 2 Minuten, danach unterste Karte vorher und nachher vergleichen – sie bleibt gleich.",
  },
  {
    id: "riffle", name: "Tisch-Riffle & Bridge", en: "Riffle Shuffle & Bridge", category: "Mischen", level: 2,
    books: ["Card College", "Erdnase"],
    purpose: "Das echte, gründliche Mischen auf dem Tisch – zeigt, dass gemischt wird.",
    steps: [
      "Deck in zwei Hälften teilen, beide Hälften hochkant an den Innenecken nebeneinander.",
      "Daumen heben die inneren Ecken an und lassen die Karten abwechselnd ineinanderfallen.",
      "Hälften ineinanderschieben – oder als Bridge: Daumen oben, Finger biegen die Karten nach oben, langsam loslassen.",
    ],
    mistakes: ["Karten zu stark knicken.", "Ungleichmäßig loslassen – Pakete statt Einzelkarten."],
    drill: "20 Riffles mit Bridge, dabei auf möglichst gleichmäßiges Ineinanderfallen achten.",
  },
  {
    id: "keycard", name: "Schlüsselkarte", en: "Key Card", category: "Kontrollen", level: 1,
    books: ["Royal Road", "Card College"],
    purpose: "Eine bekannte Karte direkt über der gewählten Karte platzieren – du findest sie danach überall wieder.",
    steps: [
      "Unauffällig die unterste Karte des Decks merken (z. B. beim Zurechtrücken).",
      "Zuschauer legt die gewählte Karte oben auf das Deck.",
      "Deck abheben lassen und komplettieren: Die Schlüsselkarte liegt jetzt direkt auf der gewählten Karte.",
      "Mehrmaliges Abheben ändert daran nichts.",
    ],
    mistakes: ["Auffälliges Hinschauen beim Merken.", "Zuschauer mischt statt nur abzuheben."],
    drill: "Karte merken, Schlüsselkarte nutzen, 3× abheben, Karte im Tischfächer finden. 10 Durchgänge.",
    diagrams: [{ kind: "stack", title: "Nach dem Abheben", cards: [{ label: "" }, { label: "Schlüsselkarte", hi: true, face: true }, { label: "gewählte Karte", hi: true }, { label: "" }, { label: "" }], caption: "Die bekannte Karte liegt direkt über der gewählten" }],
  },
  {
    id: "injog", name: "Injog-Kontrolle beim Überhandmischen", en: "Injog Control", category: "Kontrollen", level: 2,
    books: ["Royal Road", "Card College", "Erdnase"],
    purpose: "Hält die obere Hälfte (oder eine Karte oben) beim scheinbar freien Mischen an ihrem Platz.",
    steps: [
      "Rechte Hand hebt die untere Hälfte ab (Undercut) – die obere Hälfte mit der wichtigen Karte bleibt in der linken Hand.",
      "Die erste Karte der rechten Hälfte wird einzeln auf die linke gezogen und leicht zum Körper hin vorstehen gelassen (Injog).",
      "Den Rest der rechten Hälfte normal darüber mischen.",
      "Deck übernehmen, der rechte Daumen drückt die Injog-Karte leicht hoch – Break darunter.",
      "Bis zum Break abmischen und den Rest oben draufwerfen: Die ursprünglich obere Hälfte liegt wieder oben.",
    ],
    mistakes: ["Injog zu weit herausstehend.", "Rhythmus ändert sich beim Jog – sieht nach Trick aus."],
    drill: "Karte oben merken, Injog-Kontrolle, oberste Karte prüfen. 20×, bis der Rhythmus identisch mit normalem Mischen ist.",
    diagrams: [{ kind: "stack", title: "Nach dem Mischen", cards: [{ label: "gemischte Karten" }, { label: "" }, { label: "Injog-Karte", jog: "in" }, { label: "gewählte Karte", hi: true }, { label: "ursprüngliche obere Hälfte" }], breakAfter: 3, caption: "Break unter der vorstehenden Karte – darunter liegt der kontrollierte Block" }],
  },
  {
    id: "cuttobreak", name: "Bis zum Break abheben", en: "Cut to the Break", category: "Kontrollen", level: 2,
    books: ["Royal Road", "Card College"],
    purpose: "Bringt eine Karte, über der du einen Break hältst, nach oben.",
    steps: [
      "Gewählte Karte wird ins Deck zurückgesteckt, du nimmst einen Break direkt darüber.",
      "Rechte Hand übernimmt das Deck im Biddle-Griff, der Daumen übernimmt den Break.",
      "Alle Karten über dem Break nach unten abheben.",
      "Die gewählte Karte liegt jetzt oben.",
    ],
    mistakes: ["Abheben wirkt hastig.", "Break geht beim Übernehmen verloren."],
    drill: "Break über einer Karte in der Mitte nehmen, abheben, oberste Karte prüfen. 20×.",
  },
  {
    id: "falsecut", name: "Drei-Häufchen-Falschabheben", en: "Table False Cut", category: "Falsches Abheben", level: 1,
    books: ["Card College"],
    purpose: "Sieht aus wie gründliches Abheben auf dem Tisch – die Reihenfolge bleibt komplett erhalten.",
    steps: [
      "Oberes Drittel nach links ablegen (Häufchen A).",
      "Mittleres Drittel in die Mitte ablegen (Häufchen B).",
      "Das untere Drittel bleibt rechts liegen (Häufchen C).",
      "Zusammensetzen: B auf C legen, dann A auf alles. Ursprüngliche Reihenfolge!",
    ],
    mistakes: ["Zu langsam und überlegt – soll beiläufig wirken.", "Reihenfolge beim Zusammensetzen vertauschen."],
    drill: "Obere und untere Karte merken, 10× falsch abheben, prüfen.",
    diagrams: [{ kind: "piles", piles: [{ label: "A", note: "oberes Drittel" }, { label: "B", note: "mittleres" }, { label: "C", note: "unteres" }], caption: "Zusammensetzen: B auf C, dann A obendrauf" }],
  },
  {
    id: "hinduforce", name: "Hindu-Force", en: "Hindu Shuffle Force", category: "Forcen", level: 1,
    books: ["Royal Road", "Card College"],
    purpose: "Der Zuschauer „wählt frei“ – bekommt aber die Karte, die du willst.",
    steps: [
      "Zu forcierende Karte liegt unten im Deck.",
      "Hindu-Mischen, Zuschauer sagt „Stopp“ – wann er will.",
      "Rechte Hand hebt ihr Paket an und zeigt die unterste Karte: Es ist immer die Force-Karte.",
    ],
    mistakes: ["Force-Karte vorher sichtbar.", "Zu schnelles Mischen – Zuschauer soll entspannt Stopp sagen."],
    drill: "Mit einem Freund 10× üben, Force-Karte jedes Mal vorher geheim notieren.",
  },
  {
    id: "crosscut", name: "Kreuz-Abheben-Force", en: "Cross Cut Force", category: "Forcen", level: 1,
    books: ["Card College"],
    purpose: "Einfachste Force auf dem Tisch – der Zuschauer hebt selbst ab.",
    steps: [
      "Force-Karte liegt oben.",
      "Zuschauer hebt ab, du legst die untere Hälfte quer auf die obere.",
      "Ablenken: kurz etwas erzählen (Zeitversatz ist der Schlüssel).",
      "Obere (quer liegende) Hälfte abheben, die oberste Karte der unteren Hälfte nehmen lassen – das ist die ursprünglich oberste Karte.",
    ],
    mistakes: ["Sofort weitermachen – ohne Pause erinnert sich der Zuschauer, wo oben war."],
    drill: "Die Ablenkungsphase üben: 10 Sekunden natürlich reden, bevor du abhebst.",
    diagrams: [{ kind: "piles", piles: [{ label: "untere Hälfte", note: "quer obenauf" }, { label: "Force-Karte", hi: true, note: "oben auf der oberen Hälfte" }], caption: "Die querliegende Hälfte markiert scheinbar die Abhebestelle" }],
  },
  {
    id: "double", name: "Doppelhebung", en: "Double Lift", category: "Hebungen & Glide", level: 2,
    books: ["Royal Road", "Card College"],
    purpose: "Zwei Karten werden als eine gezeigt – Grundlage für unzählige Effekte (z. B. Ambitious Card).",
    steps: [
      "Break unter den obersten zwei Karten nehmen (z. B. Daumen schiebt zwei Karten als Block leicht nach rechts, kleiner Finger nimmt den Break).",
      "Rechte Hand im Biddle-Griff, der Daumen hebt beide Karten am Break als eine an.",
      "Umdrehen und vorzeigen, wieder umdrehen und exakt bündig zurücklegen.",
      "Jetzt die oberste (einzelne) Karte normal abnehmen.",
    ],
    mistakes: ["Karten verrutschen gegeneinander – Kanten müssen bündig sein.", "Zögern vor der Hebung – sie muss aussehen wie bei einer einzelnen Karte."],
    drill: "Vor dem Spiegel: einzelne Karte umdrehen, dann Doppelhebung – sie müssen identisch aussehen. 30×.",
    diagrams: [{ kind: "stack", title: "Seitenansicht", cards: [{ label: "Karte 1" }, { label: "Karte 2 (wird gezeigt)", hi: true }, { label: "" }, { label: "" }], breakAfter: 2, caption: "Break unter zwei Karten – sie werden als eine angehoben" }],
  },
  {
    id: "glide", name: "Glide", en: "Glide", category: "Hebungen & Glide", level: 2,
    books: ["Royal Road", "Card College"],
    purpose: "Die unterste Karte wird gezeigt und scheinbar ausgeteilt – tatsächlich kommt die Karte darüber.",
    steps: [
      "Deck mit Bildseite nach unten von oben in der linken Hand, Finger an der rechten Seite, Daumen links.",
      "Unterste Karte zeigen (Hand drehen), dann zurückdrehen.",
      "Ringfinger zieht die unterste Karte unbemerkt ein Stück nach hinten.",
      "Rechte Finger ziehen „die unterste Karte“ nach vorn heraus – es kommt die Karte darüber.",
    ],
    mistakes: ["Glide-Bewegung sichtbar.", "Unterste Karte wird nicht weit genug zurückgezogen."],
    drill: "Unterste Karte merken, Glide, ausgeteilte Karte prüfen – 30× ohne Hinsehen.",
  },
  {
    id: "toppalm", name: "Top Palm", en: "Top Palm", category: "Palmieren", level: 3,
    books: ["Erdnase", "Royal Road"],
    purpose: "Eine oder mehrere Karten von oben unbemerkt in der rechten Hand verbergen.",
    steps: [
      "Deck im Mechanikergriff, rechte Hand kommt locker von oben, wie zum Ordnen.",
      "Der linke kleine Finger drückt die oberste Karte an der hinteren rechten Ecke nach oben.",
      "Die Karte schwenkt in die rechte Handfläche, die Hand wölbt sich leicht.",
      "Rechte Hand verlässt das Deck natürlich – Finger nicht gespreizt.",
    ],
    mistakes: ["Hand wird steif oder zu flach.", "Blick geht auf die Hand."],
    drill: "Karte palmieren, 30 Sekunden natürlich mit der Hand weitergestikulieren, zurücklegen. Vor dem Spiegel.",
  },
  {
    id: "pushoff", name: "Austeilen & Push-off", en: "Dealing", category: "Austeilen", level: 1,
    books: ["Erdnase", "Card College"],
    purpose: "Sauberes, gleichmäßiges Austeilen – die Referenz, an der jeder Fake-Deal gemessen wird.",
    steps: [
      "Deck im Mechanikergriff.",
      "Der linke Daumen schiebt die oberste Karte leicht nach rechts.",
      "Rechte Hand nimmt sie zwischen Daumen und Fingern und legt sie ab.",
      "Gleichmäßiger Rhythmus – wie ein Croupier.",
    ],
    mistakes: ["Unregelmäßiges Tempo.", "Zu viele Karten werden mit angeschoben."],
    drill: "Ein Deck in 4 Hände austeilen, 5× hintereinander, Tempo gleich halten.",
    diagrams: [{ kind: "grip", grip: "dealing", caption: "Daumen schiebt die oberste Karte nach rechts" }],
  },
  {
    id: "bottomdeal", name: "Bottom Deal", en: "Bottom Deal", category: "Austeilen", level: 5,
    books: ["Erdnase"],
    purpose: "Die unterste Karte wird ausgeteilt, während es wie ein normales Austeilen von oben aussieht.",
    steps: [
      "Deck im Austeilgriff, das Deck liegt tief in den Fingern.",
      "Der Daumen schiebt die oberste Karte leicht an – wie beim normalen Austeilen.",
      "Gleichzeitig greift der rechte Mittelfinger unter das Deck und zieht die unterste Karte heraus.",
      "Der Daumen zieht die oberste Karte zurück, die rechte Hand teilt die untere Karte aus.",
    ],
    mistakes: ["Rhythmus unterscheidet sich vom echten Austeilen.", "Geräusch beim Herausziehen."],
    drill: "Abwechselnd echtes Austeilen und Bottom Deal im gleichen Tempo – vor einer Kamera aufnehmen und vergleichen.",
  },
  {
    id: "seconddeal", name: "Second Deal", en: "Second Deal", category: "Austeilen", level: 5,
    books: ["Erdnase"],
    purpose: "Die zweite Karte wird ausgeteilt, die oberste bleibt liegen.",
    steps: [
      "Der linke Daumen schiebt die obersten zwei Karten leicht versetzt an.",
      "Die rechte Hand greift die zweite Karte am freiliegenden Rand.",
      "Gleichzeitig zieht der linke Daumen die oberste Karte bündig zurück.",
      "Die rechte Hand teilt die zweite Karte aus – mit genau dem Tempo eines normalen Deals.",
    ],
    mistakes: ["Oberste Karte bewegt sich sichtbar.", "Daumenbewegung zu groß."],
    drill: "Oberste Karte markieren (z. B. Joker), 52× Second Deal – der Joker muss oben bleiben.",
  },
  {
    id: "pass", name: "Klassischer Pass", en: "Two-Handed Shift", category: "Pass & Farbwechsel", level: 5,
    books: ["Erdnase", "Royal Road"],
    purpose: "Die beiden Hälften tauschen unsichtbar die Plätze – Karte aus der Mitte nach oben.",
    steps: [
      "Break mit dem kleinen Finger zwischen den Hälften.",
      "Rechte Hand bedeckt das Deck von oben, hält die obere Hälfte an den Schmalseiten.",
      "Linke Finger ziehen die untere Hälfte nach oben, um die obere herum.",
      "Die obere Hälfte geht gleichzeitig nach unten – die Hälften tauschen in einer fließenden Bewegung.",
    ],
    mistakes: ["Geräusch und Ruck – der Pass muss leise sein.", "Ohne Deckung (Bewegung, Ablenkung) ausführen."],
    drill: "Langsam und lautlos 50× pro Tag, Tempo erst steigern, wenn es leise ist.",
  },
  {
    id: "colorchange", name: "Farbwechsel mit Palm", en: "Palm Color Change", category: "Pass & Farbwechsel", level: 4,
    books: ["Erdnase"],
    purpose: "Die oberste sichtbare Karte verwandelt sich durch eine Handbewegung.",
    steps: [
      "Eine Karte ist in der rechten Hand palmiert (Top Palm).",
      "Das Deck wird mit Bildseite zum Publikum gehalten, eine Karte sichtbar vorne.",
      "Die rechte Hand streicht über die Bildseite und lässt dabei die palmierte Karte darauf zurück.",
      "Die Hand gleitet weiter – die neue Karte erscheint.",
    ],
    mistakes: ["Hand stoppt beim Ablegen.", "Palmierte Karte vorher sichtbar."],
    drill: "Wischbewegung 20× ohne Karte üben, dann mit Karte – die Bewegung muss identisch bleiben.",
  },
  {
    id: "spread", name: "Tischausbreiten", en: "Ribbon Spread", category: "Fächer & Flourishes", level: 1,
    books: ["Card College"],
    purpose: "Das Deck gleichmäßig in einer Linie ausbreiten – zum Wählen und für schöne Präsentation.",
    steps: [
      "Deck mit der rechten Hand flach auf den Tisch (am besten auf eine Matte).",
      "Zeigefinger an der linken Längskante, leichter Druck.",
      "Mit gleichmäßiger Bewegung nach rechts ziehen.",
    ],
    mistakes: ["Zu viel Druck – Lücken im Band.", "Auf glatter Fläche üben (rutscht)."],
    drill: "10× ausbreiten, bis der Abstand zwischen den Karten gleichmäßig ist. Dann mit Umdrehen (Turnover).",
    diagrams: [{ kind: "spread", count: 24, caption: "Gleichmäßiges Band" }],
  },
  {
    id: "thumbfan", name: "Daumenfächer", en: "Thumb Fan", category: "Fächer & Flourishes", level: 1,
    books: ["Card College"],
    purpose: "Schöner, runder Fächer mit einer Bewegung des Daumens.",
    steps: [
      "Deck in der linken Hand, untere linke Ecke im Daumenballen.",
      "Rechter Daumen liegt flach oben an der linken Kante.",
      "Rechter Daumen beschreibt einen Halbkreis nach rechts – die Karten fächern sich.",
    ],
    mistakes: ["Daumen drückt zu stark – Klumpen.", "Neues Deck mit glatter Oberfläche ohne Einspielen."],
    drill: "20 Fächer, Ziel: alle Indexe sichtbar, Halbkreis gleichmäßig.",
    diagrams: [{ kind: "spread", count: 20, fan: true, hi: 11, caption: "Gleichmäßiger Halbkreis" }],
  },
  {
    id: "charlier", name: "Charlier-Abheben", en: "Charlier Cut", category: "Fächer & Flourishes", level: 2,
    books: ["Card College"],
    purpose: "Einhändiges Abheben – eleganter Flourish und Fingerkraft-Training.",
    steps: [
      "Deck in den Fingerspitzen der linken Hand, Daumen auf einer Längskante, Finger auf der anderen.",
      "Daumen lässt die untere Hälfte in die Handfläche fallen.",
      "Zeigefinger drückt die untere Hälfte hoch und über die obere hinweg.",
      "Die obere Hälfte fällt in die Hand, die alte untere Hälfte legt sich darauf.",
    ],
    mistakes: ["Deck zu tief in der Hand.", "Mit großen Händen über einem Bett üben ist schlau 😉"],
    drill: "Jeden Tag 3 Minuten – nach einer Woche sitzt er.",
  },
];

export const TRICKS: Trick[] = [
  {
    id: "keyfind", name: "Gefunden mit der Schlüsselkarte", level: 1,
    effect: "Der Zuschauer wählt eine Karte, legt sie zurück und hebt mehrfach ab. Du findest sie trotzdem.",
    uses: ["keycard", "spread"],
    setup: "Kein Vorbereiten – nur unauffällig die unterste Karte merken.",
    method: [
      "Karte ziehen und merken lassen.",
      "Sie wird oben aufgelegt, der Zuschauer hebt ab (beliebig oft).",
      "Deck mit Bildseite nach oben ausbreiten: Die Karte rechts neben deiner Schlüsselkarte ist die gewählte.",
      "Spannender: Zuschauer buchstabiert seine Karte, du drehst bei jedem Buchstaben eine Karte um und stoppst richtig.",
    ],
    presentation: "Erzähl, dass Karten „Spuren“ hinterlassen – du liest die Fingerabdrücke im Band.",
  },
  {
    id: "21cards", name: "Der 21-Karten-Trick", level: 1,
    effect: "Aus 21 Karten findet der Magier die gedachte Karte – nachdem der Zuschauer nur gezeigt hat, in welcher Reihe sie liegt.",
    uses: [],
    setup: "21 Karten abzählen.",
    method: [
      "Zuschauer merkt sich eine der 21 Karten.",
      "Karten in 3 Spalten zu je 7 austeilen (Reihe für Reihe), Bildseite nach oben.",
      "Zuschauer zeigt die Spalte mit seiner Karte.",
      "Spalten einsammeln – die genannte Spalte kommt in die Mitte.",
      "Das Ganze noch zweimal (insgesamt 3×).",
      "Die gewählte Karte ist jetzt die 11. Karte von oben.",
    ],
    presentation: "Mach daraus ein Gedankenlesen: Bitte den Zuschauer, beim letzten Mal nur zu denken – an seiner Reaktion „siehst“ du die Spalte. Dann buchstabierst du dich zur Karte.",
    diagrams: [{ kind: "piles", piles: [{ label: "Spalte 1" }, { label: "Spalte mit Karte", hi: true, note: "kommt in die Mitte" }, { label: "Spalte 3" }], caption: "Die gezeigte Spalte immer in die Mitte legen" }],
  },
  {
    id: "ambitious", name: "Die aufsteigende Karte", level: 2,
    effect: "Die unterschriebene Karte wird in die Mitte gesteckt – und ist sofort wieder oben.",
    uses: ["double", "injog", "cuttobreak"],
    setup: "Gewählte Karte kontrollierst du auf die 2. Position von oben.",
    method: [
      "Doppelhebung: Die gezeigte Karte ist die gewählte (sie liegt als zweite unter der obersten).",
      "Umdrehen, die oberste Karte (eine fremde Karte) nehmen und deutlich in die Mitte stecken.",
      "Fingerschnippen – oberste Karte umdrehen: die gewählte Karte.",
      "Weitere Phasen: Karte erneut nach oben kontrollieren und mit anderen Methoden steigen lassen.",
    ],
    presentation: "Die Karte ist „ehrgeizig“ – sie will immer ganz nach oben. Lass den Zuschauer die Karte selbst in die Mitte drücken.",
  },
  {
    id: "prediction", name: "Die Vorhersage", level: 1,
    effect: "Bevor der Zuschauer abhebt, liegt eine Vorhersage auf dem Tisch – sie stimmt.",
    uses: ["crosscut"],
    setup: "Oberste Karte unbemerkt merken (z. B. nach dem Mischen kurz sehen).",
    method: [
      "Vorhersage auf einen Zettel schreiben, umgedreht hinlegen.",
      "Kreuz-Abheben-Force durchführen.",
      "Zuschauer nimmt die Karte – Vorhersage umdrehen lassen.",
    ],
    presentation: "Betone die Freiheit: „Du hebst ab, wo du willst – ich fasse das Deck nicht an.“",
  },
  {
    id: "doasido", name: "Tu, was ich tu", level: 1,
    effect: "Zuschauer und Magier wählen in zwei Decks unabhängig eine Karte – es ist dieselbe.",
    uses: ["keycard"],
    setup: "Zwei Decks mit verschiedenen Rückseiten.",
    method: [
      "Jeder mischt sein Deck. Beim Zurückgeben merkst du dir unauffällig die unterste Karte deines Decks.",
      "Decks tauschen – der Zuschauer hält nun das Deck mit deiner Schlüsselkarte unten.",
      "Beide nehmen eine Karte aus der Mitte, merken sie, legen sie oben auf und heben ab.",
      "Decks zurücktauschen. Beide suchen „ihre“ Karte: Du suchst die Schlüsselkarte – die Karte rechts daneben ist die des Zuschauers.",
      "Beide Karten gleichzeitig umdrehen: identisch.",
    ],
    presentation: "„Wir machen alles synchron.“ Spiegel jede Bewegung des Zuschauers – das macht den Effekt lustig und fair.",
  },
  {
    id: "aces", name: "Abgehobene Asse", level: 1,
    effect: "Der Zuschauer teilt das Deck in vier Häufchen – auf jedem liegt am Ende ein Ass.",
    uses: ["falsecut"],
    setup: "Die vier Asse liegen heimlich oben. Optional vorher falsch abheben.",
    method: [
      "Zuschauer teilt das Deck in vier etwa gleiche Häufchen. Merke dir das Häufchen mit den ursprünglich obersten Karten (die Asse).",
      "Bei jedem Häufchen – das Asse-Häufchen kommt zuletzt: 3 Karten von oben nach unten legen, dann je eine Karte auf jedes andere Häufchen austeilen.",
      "Wenn du das Asse-Häufchen als letztes bearbeitest, wandern die drei Fremdkarten nach unten und die Asse werden ausgeteilt.",
      "Oberste Karte jedes Häufchens umdrehen: vier Asse.",
    ],
    presentation: "Lass den Zuschauer alles selbst tun und erzähl, dass er heute „die Hände eines Falschspielers“ hat.",
    diagrams: [{ kind: "piles", piles: [{ label: "1" }, { label: "2" }, { label: "3" }, { label: "4", hi: true, note: "Asse oben – zuletzt" }], caption: "Das Häufchen mit den Assen wird zuletzt bearbeitet" }],
  },
  {
    id: "glidejump", name: "Die springende Karte", level: 2,
    effect: "Eine gezeigte Karte wird auf den Tisch gelegt – und verwandelt sich in eine andere, die vorher woanders war.",
    uses: ["glide"],
    setup: "Kenne die zwei untersten Karten.",
    method: [
      "Unterste Karte zeigen (z. B. Herz-Dame) und benennen.",
      "Mit dem Glide scheinbar diese Karte verdeckt auf den Tisch legen – tatsächlich die Karte darüber.",
      "Herz-Dame liegt noch unten. Zuschauer legt seine Hand auf die Tischkarte.",
      "Magische Geste – Tischkarte umdrehen (andere Karte), unterste Karte zeigen: die Herz-Dame ist „zurückgesprungen“.",
    ],
    presentation: "Kurzer, schneller Gag als Opener – ideal, um Aufmerksamkeit zu bekommen.",
  },
];
