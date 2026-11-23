/**
 * Lead finder – SAMPLE DATA (prototype).
 * All companies are fictional. Signals mimic what a real enrichment step
 * (Google Places, website check, ads transparency) would return later.
 */
export type LeadStatus = "neu" | "qualifiziert" | "entwurf" | "freigegeben" | "angeschrieben" | "antwort" | "kein_interesse";

export type SampleLead = {
  id: string;
  company: string;
  industry: string;
  city: string;
  region: string;
  contactRole: string;
  employees: number;
  website: string | null;
  websiteMobile: boolean;
  websiteLastUpdate: number | null; // year
  onlineBooking: boolean;
  googleRating: number | null;
  googleReviews: number;
  runsGoogleAds: boolean;
  runsSocialAds: boolean;
  note: string;
};

export const INDUSTRIES = [
  "Zahnarztpraxis",
  "Elektrobetrieb",
  "Dachdecker",
  "Immobilienmakler",
  "Fitnessstudio",
  "Autohaus",
  "Steuerberatung",
  "Physiotherapie",
] as const;

export const SAMPLE_LEADS: SampleLead[] = [
  { id: "L01", company: "Zahnarztpraxis Dr. Lindner (fiktiv)", industry: "Zahnarztpraxis", city: "Herrenberg", region: "Stuttgart", contactRole: "Praxisinhaber", employees: 12, website: "praxis-lindner.example", websiteMobile: false, websiteLastUpdate: 2017, onlineBooking: false, googleRating: 4.8, googleReviews: 214, runsGoogleAds: false, runsSocialAds: false, note: "Sehr gute Bewertungen, Website veraltet, keine Online-Terminbuchung" },
  { id: "L02", company: "Dentalzentrum Schönbuch (fiktiv)", industry: "Zahnarztpraxis", city: "Böblingen", region: "Stuttgart", contactRole: "Praxismanagerin", employees: 28, website: "dz-schoenbuch.example", websiteMobile: true, websiteLastUpdate: 2025, onlineBooking: true, googleRating: 4.6, googleReviews: 389, runsGoogleAds: true, runsSocialAds: true, note: "Bereits digital gut aufgestellt" },
  { id: "L03", company: "Elektro Kaiser GmbH (fiktiv)", industry: "Elektrobetrieb", city: "Sindelfingen", region: "Stuttgart", contactRole: "Geschäftsführer", employees: 18, website: "elektro-kaiser.example", websiteMobile: true, websiteLastUpdate: 2020, onlineBooking: false, googleRating: 4.7, googleReviews: 96, runsGoogleAds: false, runsSocialAds: false, note: "Wächst, sucht laut Website Azubis – keine Werbung aktiv" },
  { id: "L04", company: "Blitz & Strom Service (fiktiv)", industry: "Elektrobetrieb", city: "Leonberg", region: "Stuttgart", contactRole: "Inhaber", employees: 4, website: null, websiteMobile: false, websiteLastUpdate: null, onlineBooking: false, googleRating: 4.2, googleReviews: 11, runsGoogleAds: false, runsSocialAds: false, note: "Kleiner Betrieb ohne Website" },
  { id: "L05", company: "Dachbau Wagner (fiktiv)", industry: "Dachdecker", city: "Nagold", region: "Stuttgart", contactRole: "Geschäftsführerin", employees: 22, website: "dachbau-wagner.example", websiteMobile: false, websiteLastUpdate: 2016, onlineBooking: false, googleRating: 4.9, googleReviews: 141, runsGoogleAds: false, runsSocialAds: false, note: "Top-Bewertungen, Website nicht mobil – Solar-Dächer als Wachstumsthema" },
  { id: "L06", company: "Neckar Immobilien (fiktiv)", industry: "Immobilienmakler", city: "Tübingen", region: "Stuttgart", contactRole: "Inhaber", employees: 9, website: "neckar-immo.example", websiteMobile: true, websiteLastUpdate: 2023, onlineBooking: false, googleRating: 4.4, googleReviews: 58, runsGoogleAds: true, runsSocialAds: false, note: "Google Ads aktiv, kein Social" },
  { id: "L07", company: "Kraftwerk Fitness (fiktiv)", industry: "Fitnessstudio", city: "Stuttgart-Vaihingen", region: "Stuttgart", contactRole: "Studioleitung", employees: 15, website: "kraftwerk-fit.example", websiteMobile: true, websiteLastUpdate: 2024, onlineBooking: true, googleRating: 4.3, googleReviews: 402, runsGoogleAds: false, runsSocialAds: true, note: "Nur Instagram-Ads, keine Suchwerbung" },
  { id: "L08", company: "Autohaus Ammertal (fiktiv)", industry: "Autohaus", city: "Ammerbuch", region: "Stuttgart", contactRole: "Verkaufsleiter", employees: 35, website: "autohaus-ammertal.example", websiteMobile: true, websiteLastUpdate: 2022, onlineBooking: false, googleRating: 4.1, googleReviews: 233, runsGoogleAds: false, runsSocialAds: false, note: "Großer Bestand, keine Online-Werbung sichtbar" },
  { id: "L09", company: "Steuerkanzlei Berger & Ott (fiktiv)", industry: "Steuerberatung", city: "Esslingen", region: "Stuttgart", contactRole: "Partnerin", employees: 14, website: "berger-ott.example", websiteMobile: false, websiteLastUpdate: 2018, onlineBooking: false, googleRating: 4.5, googleReviews: 37, runsGoogleAds: false, runsSocialAds: false, note: "Website veraltet, Mandantengewinnung offline" },
  { id: "L10", company: "Physio Aktiv Gärtringen (fiktiv)", industry: "Physiotherapie", city: "Gärtringen", region: "Stuttgart", contactRole: "Inhaberin", employees: 7, website: "physio-aktiv.example", websiteMobile: true, websiteLastUpdate: 2021, onlineBooking: false, googleRating: 4.9, googleReviews: 88, runsGoogleAds: false, runsSocialAds: false, note: "Sehr beliebt, Termine nur telefonisch" },
  { id: "L11", company: "Zahnärzte am Marktplatz (fiktiv)", industry: "Zahnarztpraxis", city: "München-Pasing", region: "München", contactRole: "Praxisinhaberin", employees: 10, website: "zahn-marktplatz.example", websiteMobile: true, websiteLastUpdate: 2019, onlineBooking: false, googleRating: 4.7, googleReviews: 176, runsGoogleAds: false, runsSocialAds: false, note: "Gute Bewertungen, keine Online-Buchung" },
  { id: "L12", company: "Isar Elektrotechnik (fiktiv)", industry: "Elektrobetrieb", city: "Freising", region: "München", contactRole: "Geschäftsführer", employees: 25, website: "isar-elektro.example", websiteMobile: false, websiteLastUpdate: 2015, onlineBooking: false, googleRating: 4.6, googleReviews: 74, runsGoogleAds: false, runsSocialAds: false, note: "PV- und Wallbox-Installationen, Website von 2015" },
  { id: "L13", company: "Bergblick Immobilien (fiktiv)", industry: "Immobilienmakler", city: "Rosenheim", region: "München", contactRole: "Geschäftsführerin", employees: 6, website: "bergblick-immo.example", websiteMobile: true, websiteLastUpdate: 2025, onlineBooking: false, googleRating: 4.8, googleReviews: 64, runsGoogleAds: true, runsSocialAds: true, note: "Digital aktiv – eher kein Bedarf" },
  { id: "L14", company: "FitWerk 24 (fiktiv)", industry: "Fitnessstudio", city: "München-Giesing", region: "München", contactRole: "Inhaber", employees: 9, website: "fitwerk24.example", websiteMobile: true, websiteLastUpdate: 2022, onlineBooking: true, googleRating: 3.9, googleReviews: 156, runsGoogleAds: false, runsSocialAds: false, note: "Schwächere Bewertungen" },
  { id: "L15", company: "Hansa Dach & Fassade (fiktiv)", industry: "Dachdecker", city: "Hamburg-Bergedorf", region: "Hamburg", contactRole: "Inhaber", employees: 16, website: "hansa-dach.example", websiteMobile: true, websiteLastUpdate: 2020, onlineBooking: false, googleRating: 4.7, googleReviews: 102, runsGoogleAds: false, runsSocialAds: false, note: "Solide, keine Werbung" },
  { id: "L16", company: "Alster Physio (fiktiv)", industry: "Physiotherapie", city: "Hamburg-Eppendorf", region: "Hamburg", contactRole: "Praxisleitung", employees: 11, website: "alster-physio.example", websiteMobile: true, websiteLastUpdate: 2024, onlineBooking: true, googleRating: 4.8, googleReviews: 210, runsGoogleAds: true, runsSocialAds: false, note: "Online gut aufgestellt" },
  { id: "L17", company: "Autozentrum Elbe (fiktiv)", industry: "Autohaus", city: "Hamburg-Harburg", region: "Hamburg", contactRole: "Geschäftsführer", employees: 48, website: "autozentrum-elbe.example", websiteMobile: false, websiteLastUpdate: 2018, onlineBooking: false, googleRating: 4.0, googleReviews: 318, runsGoogleAds: false, runsSocialAds: true, note: "Facebook-Ads, Website nicht mobil" },
  { id: "L18", company: "Kanzlei Nordlicht Steuern (fiktiv)", industry: "Steuerberatung", city: "Hamburg-Altona", region: "Hamburg", contactRole: "Inhaber", employees: 8, website: null, websiteMobile: false, websiteLastUpdate: null, onlineBooking: false, googleRating: 4.6, googleReviews: 22, runsGoogleAds: false, runsSocialAds: false, note: "Keine Website" },
];

export const REGIONS = ["Stuttgart", "München", "Hamburg"] as const;
