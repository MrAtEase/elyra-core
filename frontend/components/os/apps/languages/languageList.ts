/** Languages for the trainer: German display name + BCP-47 code for speech output. */
export const LANGUAGES: Array<{ name: string; code: string }> = [
  { name: "Englisch", code: "en-US" }, { name: "Portugiesisch (Portugal)", code: "pt-PT" }, { name: "Portugiesisch (Brasilien)", code: "pt-BR" },
  { name: "Spanisch", code: "es-ES" }, { name: "Französisch", code: "fr-FR" }, { name: "Italienisch", code: "it-IT" },
  { name: "Niederländisch", code: "nl-NL" }, { name: "Kroatisch", code: "hr-HR" }, { name: "Bosnisch", code: "bs-BA" },
  { name: "Serbisch", code: "sr-RS" }, { name: "Slowenisch", code: "sl-SI" }, { name: "Polnisch", code: "pl-PL" },
  { name: "Tschechisch", code: "cs-CZ" }, { name: "Slowakisch", code: "sk-SK" }, { name: "Ungarisch", code: "hu-HU" },
  { name: "Rumänisch", code: "ro-RO" }, { name: "Bulgarisch", code: "bg-BG" }, { name: "Griechisch", code: "el-GR" },
  { name: "Türkisch", code: "tr-TR" }, { name: "Russisch", code: "ru-RU" }, { name: "Ukrainisch", code: "uk-UA" },
  { name: "Schwedisch", code: "sv-SE" }, { name: "Norwegisch", code: "nb-NO" }, { name: "Dänisch", code: "da-DK" },
  { name: "Finnisch", code: "fi-FI" }, { name: "Estnisch", code: "et-EE" }, { name: "Lettisch", code: "lv-LV" },
  { name: "Litauisch", code: "lt-LT" }, { name: "Albanisch", code: "sq-AL" }, { name: "Mazedonisch", code: "mk-MK" },
  { name: "Isländisch", code: "is-IS" }, { name: "Irisch", code: "ga-IE" }, { name: "Katalanisch", code: "ca-ES" },
  { name: "Baskisch", code: "eu-ES" }, { name: "Galicisch", code: "gl-ES" }, { name: "Arabisch", code: "ar-SA" },
  { name: "Hebräisch", code: "he-IL" }, { name: "Persisch", code: "fa-IR" }, { name: "Hindi", code: "hi-IN" },
  { name: "Bengalisch", code: "bn-IN" }, { name: "Urdu", code: "ur-PK" }, { name: "Punjabi", code: "pa-IN" },
  { name: "Tamil", code: "ta-IN" }, { name: "Telugu", code: "te-IN" }, { name: "Marathi", code: "mr-IN" },
  { name: "Chinesisch (Mandarin)", code: "zh-CN" }, { name: "Kantonesisch", code: "zh-HK" }, { name: "Japanisch", code: "ja-JP" },
  { name: "Koreanisch", code: "ko-KR" }, { name: "Thai", code: "th-TH" }, { name: "Vietnamesisch", code: "vi-VN" },
  { name: "Indonesisch", code: "id-ID" }, { name: "Malaiisch", code: "ms-MY" }, { name: "Tagalog", code: "fil-PH" },
  { name: "Swahili", code: "sw-KE" }, { name: "Afrikaans", code: "af-ZA" }, { name: "Amharisch", code: "am-ET" },
  { name: "Georgisch", code: "ka-GE" }, { name: "Armenisch", code: "hy-AM" }, { name: "Kasachisch", code: "kk-KZ" },
  { name: "Esperanto", code: "eo" }, { name: "Latein", code: "la" },
];

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

export const TOPICS = [
  "Begrüßung & Vorstellen", "Restaurant & Café", "Einkaufen", "Reisen & Wegbeschreibung", "Zahlen & Uhrzeit",
  "Familie & Freunde", "Wohnung & Vermieter", "Arzt & Apotheke", "Arbeit & Bewerbung", "Freizeit & Hobbys",
  "Behörden", "Telefon & Kundenservice",
];
