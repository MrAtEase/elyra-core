/**
 * Spot-based surf forecast.
 *
 * Open-Meteo's wave model has a grid of roughly 9 km, so neighbouring spots
 * (e.g. Supertubos and Baleal) receive the same offshore swell. What makes
 * them different is how each beach faces the swell, how sheltered it is and
 * how the local wind blows relative to the beach. This module models exactly
 * that: per spot and per hour it estimates the breaking wave height and
 * rates the conditions.
 *
 * Directions follow the meteorological convention: the direction a swell or
 * wind is coming FROM, in degrees (0 = N, 90 = E, 180 = S, 270 = W).
 */

export type SurfRating = "epic" | "good" | "fair" | "poor" | "flat";
export type WindRelation = "ablandig" | "schräg ablandig" | "seitlich" | "schräg auflandig" | "auflandig";

export type SurfSpotDef = {
  id: string;
  /** Top-level grouping shown as a chip (country or surf area). */
  area: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  /** Direction the beach faces (towards the sea). Swell from this direction hits it head-on. */
  facing: number;
  /** 0–1.3: how much of the offshore swell actually arrives (headlands, sandbanks, canyons). */
  exposure: number;
  breakType: "Beach" | "Reef" | "Point" | "Jetty";
  level: "Alle" | "Fortgeschrittene" | "Erfahrene" | "Big Wave";
  note: string;
  source: "curated" | "search";
};

export const SURF_REGIONS = ["Costa da Caparica", "Lissabon & Cascais", "Ericeira", "Peniche", "Nazaré", "Norden & Porto", "Algarve"] as const;
export type SurfRegion = (typeof SURF_REGIONS)[number];

const PT = "Portugal";

type Raw = Omit<SurfSpotDef, "area" | "source">;

const PORTUGAL_RAW: Raw[] = [
  // Costa da Caparica — west/south-west facing beach line; the Cascais peninsula blocks part of the north swell.
  { id: "cova-do-vapor", name: "Cova do Vapor", region: "Costa da Caparica", country: PT, lat: 38.662, lon: -9.262, facing: 265, exposure: 0.75, breakType: "Jetty", level: "Fortgeschrittene", note: "Nördlichster Spot an der Tejo-Mündung, Buhnen; braucht etwas mehr Swell." },
  { id: "sao-joao", name: "São João da Caparica", region: "Costa da Caparica", country: PT, lat: 38.652, lon: -9.248, facing: 260, exposure: 0.85, breakType: "Jetty", level: "Alle", note: "Sandbänke zwischen Buhnen, bei kleinem Swell oft gute Wahl." },
  { id: "cds", name: "CDS / Nova Praia", region: "Costa da Caparica", country: PT, lat: 38.641, lon: -9.238, facing: 255, exposure: 0.85, breakType: "Jetty", level: "Alle", note: "Stadtstrand mit Buhnen, viele Surfschulen." },
  { id: "praia-do-paraiso", name: "Praia do Paraíso / Tarquínio", region: "Costa da Caparica", country: PT, lat: 38.627, lon: -9.229, facing: 252, exposure: 0.9, breakType: "Beach", level: "Alle", note: "Offener Beachbreak südlich der Stadt." },
  { id: "riviera", name: "Praia da Riviera / Mata", region: "Costa da Caparica", country: PT, lat: 38.607, lon: -9.219, facing: 250, exposure: 0.95, breakType: "Beach", level: "Alle", note: "Lange Sandbänke, weniger voll als in der Stadt." },
  { id: "fonte-da-telha", name: "Fonte da Telha", region: "Costa da Caparica", country: PT, lat: 38.573, lon: -9.196, facing: 245, exposure: 1.0, breakType: "Beach", level: "Alle", note: "Exponiertester Teil der Costa, fängt am meisten Swell." },
  // Lisbon & Cascais
  { id: "carcavelos", name: "Carcavelos", region: "Lissabon & Cascais", country: PT, lat: 38.678, lon: -9.335, facing: 200, exposure: 0.55, breakType: "Beach", level: "Alle", note: "Südseitig: läuft erst bei größerem W–NW-Swell, dafür ablandig bei Nordwind (Nortada)." },
  { id: "guincho", name: "Guincho", region: "Lissabon & Cascais", country: PT, lat: 38.731, lon: -9.474, facing: 285, exposure: 1.0, breakType: "Beach", level: "Fortgeschrittene", note: "Fängt jeden Swell, aber oft sehr windig; Strömungen." },
  // Ericeira
  { id: "foz-do-lizandro", name: "Foz do Lizandro", region: "Ericeira", country: PT, lat: 38.942, lon: -9.417, facing: 275, exposure: 0.9, breakType: "Beach", level: "Alle", note: "Beachbreak an der Flussmündung, gut für alle." },
  { id: "ribeira-dilhas", name: "Ribeira d'Ilhas", region: "Ericeira", country: PT, lat: 38.988, lon: -9.420, facing: 290, exposure: 0.95, breakType: "Reef", level: "Fortgeschrittene", note: "Rechte über Riff, WSL-Contest-Spot." },
  { id: "coxos", name: "Coxos", region: "Ericeira", country: PT, lat: 39.003, lon: -9.426, facing: 310, exposure: 1.0, breakType: "Point", level: "Erfahrene", note: "Kraftvoller Rechts-Pointbreak über Fels, nur für Erfahrene." },
  // Peniche — the peninsula means one side is usually offshore.
  { id: "supertubos", name: "Supertubos", region: "Peniche", country: PT, lat: 39.345, lon: -9.364, facing: 235, exposure: 0.85, breakType: "Beach", level: "Fortgeschrittene", note: "Hohle Beachbreak-Tubes, Südseite der Halbinsel; ablandig bei Nord-/Nordostwind." },
  { id: "molhe-leste", name: "Molhe Leste", region: "Peniche", country: PT, lat: 39.350, lon: -9.372, facing: 215, exposure: 0.6, breakType: "Jetty", level: "Fortgeschrittene", note: "An der Hafenmole, geschützt – läuft bei großem Swell." },
  { id: "consolacao", name: "Consolação", region: "Peniche", country: PT, lat: 39.324, lon: -9.360, facing: 250, exposure: 0.85, breakType: "Reef", level: "Fortgeschrittene", note: "Riff- und Beachbreaks südlich von Supertubos." },
  { id: "baleal", name: "Baleal (Cantinho da Baía)", region: "Peniche", country: PT, lat: 39.374, lon: -9.338, facing: 15, exposure: 0.55, breakType: "Beach", level: "Alle", note: "Nordseitige Bucht, geschützt: Plan B bei großem Swell; ablandig bei Südwind." },
  { id: "lagide", name: "Lagide", region: "Peniche", country: PT, lat: 39.379, lon: -9.331, facing: 355, exposure: 0.65, breakType: "Reef", level: "Fortgeschrittene", note: "Riff an der Nordseite des Baleal, ablandig bei Süd-/Südostwind." },
  // Nazaré
  { id: "nazare-norte", name: "Nazaré – Praia do Norte", region: "Nazaré", country: PT, lat: 39.606, lon: -9.085, facing: 290, exposure: 1.3, breakType: "Beach", level: "Big Wave", note: "Der Unterwasser-Canyon verstärkt den Swell massiv. Im Winter Big-Wave-Spot." },
  { id: "nazare-sul", name: "Nazaré – Praia da Vila", region: "Nazaré", country: PT, lat: 39.598, lon: -9.073, facing: 250, exposure: 0.35, breakType: "Beach", level: "Alle", note: "Stadtstrand im Schutz des Kaps, nur bei großem Swell surfbar." },
  // Lisbon area extra
  { id: "praia-grande", name: "Praia Grande (Sintra)", region: "Lissabon & Cascais", country: PT, lat: 38.815, lon: -9.479, facing: 285, exposure: 1.0, breakType: "Beach", level: "Alle", note: "Offener Beachbreak bei Sintra, fängt viel Swell." },
  // North & Porto
  { id: "matosinhos", name: "Matosinhos", region: "Norden & Porto", country: PT, lat: 41.176, lon: -8.692, facing: 250, exposure: 0.65, breakType: "Beach", level: "Alle", note: "Geschützte Bucht nördlich von Porto, Anfängerstrand." },
  { id: "espinho", name: "Espinho", region: "Norden & Porto", country: PT, lat: 41.007, lon: -8.646, facing: 270, exposure: 0.95, breakType: "Jetty", level: "Fortgeschrittene", note: "Rechte an der Buhne." },
  { id: "viana", name: "Praia do Cabedelo (Viana)", region: "Norden & Porto", country: PT, lat: 41.680, lon: -8.840, facing: 260, exposure: 0.95, breakType: "Beach", level: "Alle", note: "" },
  { id: "figueira", name: "Buarcos (Figueira da Foz)", region: "Norden & Porto", country: PT, lat: 40.170, lon: -8.890, facing: 200, exposure: 0.6, breakType: "Point", level: "Fortgeschrittene", note: "Lange Rechte, läuft bei großem NW-Swell." },
  // Algarve: west coast catches the Atlantic swell, the south coast needs SW swell or winter storms.
  { id: "arrifana", name: "Arrifana", region: "Algarve", country: PT, lat: 37.293, lon: -8.866, facing: 280, exposure: 0.8, breakType: "Beach", level: "Alle", note: "Bucht unter Klippen an der Westküste, im Norden eine Rechte über Riff." },
  { id: "amado", name: "Amado", region: "Algarve", country: PT, lat: 37.168, lon: -8.903, facing: 270, exposure: 1.0, breakType: "Beach", level: "Alle", note: "Bekanntester Spot der Westküste, viele Surfschulen." },
  { id: "tonel", name: "Tonel (Sagres)", region: "Algarve", country: PT, lat: 37.004, lon: -8.945, facing: 260, exposure: 1.0, breakType: "Beach", level: "Fortgeschrittene", note: "Westseitig bei Sagres, ablandig bei Ostwind." },
  { id: "beliche", name: "Beliche", region: "Algarve", country: PT, lat: 37.025, lon: -8.965, facing: 180, exposure: 0.6, breakType: "Beach", level: "Alle", note: "Südseitig: Plan B bei Nordwind und großem W-NW-Swell." },
  { id: "zavial", name: "Zavial", region: "Algarve", country: PT, lat: 37.045, lon: -8.876, facing: 190, exposure: 0.75, breakType: "Reef", level: "Fortgeschrittene", note: "Südküste, läuft im Winter bei SW-Swell." },
];

export const PORTUGAL_SPOTS: SurfSpotDef[] = PORTUGAL_RAW.map((spot) => ({ ...spot, area: "Portugal", source: "curated" }));

type B = SurfSpotDef["breakType"];
type L = SurfSpotDef["level"];
/** Compact helper for the worldwide list: area, region, country, lat, lon, facing, exposure, break, level, note. */
function w(id: string, name: string, area: string, region: string, country: string, lat: number, lon: number, facing: number, exposure: number, breakType: B, level: L, note = ""): SurfSpotDef {
  return { id, name, area, region, country, lat, lon, facing, exposure, breakType, level, note, source: "curated" };
}

/**
 * Well-known spots worldwide. Facing = direction the break opens to (where the swell has to come from).
 * Values are approximations from the coastline; points and reefs are set by hand.
 */
export const WORLD_SPOTS: SurfSpotDef[] = [
  // Spanien (Festland)
  w("mundaka", "Mundaka", "Spanien", "Baskenland", "Spanien", 43.407, -2.698, 340, 0.7, "Point", "Erfahrene", "Legendäre Linke an der Flussmündung, braucht großen NW-Swell und Ebbe bis Mitte."),
  w("zarautz", "Zarautz", "Spanien", "Baskenland", "Spanien", 43.287, -2.170, 355, 0.9, "Beach", "Alle", "Langer Sandstrand, konstant."),
  w("zurriola", "Zurriola (San Sebastián)", "Spanien", "Baskenland", "Spanien", 43.326, -1.975, 0, 0.85, "Beach", "Alle", "Stadtstrand von San Sebastián."),
  w("somo", "Somo", "Spanien", "Kantabrien", "Spanien", 43.457, -3.737, 15, 0.8, "Beach", "Alle", "Beachbreak gegenüber von Santander."),
  w("rodiles", "Rodiles", "Spanien", "Asturien", "Spanien", 43.533, -5.375, 0, 0.75, "Point", "Erfahrene", "Linke an der Flussmündung."),
  w("salinas", "Salinas", "Spanien", "Asturien", "Spanien", 43.580, -5.960, 340, 0.9, "Beach", "Alle", ""),
  w("razo", "Razo", "Spanien", "Galicien", "Spanien", 43.290, -8.710, 315, 1.0, "Beach", "Alle", "Offener Atlantikstrand, fängt viel Swell."),
  w("el-palmar", "El Palmar", "Spanien", "Andalusien", "Spanien", 36.233, -6.070, 240, 0.85, "Beach", "Alle", "Bester Beachbreak an der Costa de la Luz, läuft vor allem im Winter."),
  // Kanaren
  w("famara", "Famara", "Kanaren", "Lanzarote", "Spanien", 29.115, -13.560, 320, 1.0, "Beach", "Alle", "Langer Strand unter Klippen, Surfschulen."),
  w("la-santa", "El Quemao (La Santa)", "Kanaren", "Lanzarote", "Spanien", 29.118, -13.650, 345, 0.95, "Reef", "Erfahrene", "Schwere Linke über Lavariff."),
  w("el-cotillo", "El Cotillo", "Kanaren", "Fuerteventura", "Spanien", 28.680, -14.010, 280, 1.0, "Beach", "Fortgeschrittene", ""),
  w("lobos-north", "North Shore (Majanicho)", "Kanaren", "Fuerteventura", "Spanien", 28.740, -13.940, 345, 0.95, "Reef", "Fortgeschrittene", "Riffspots an der Nordküste."),
  w("spanish-left", "Spanish Left (Las Américas)", "Kanaren", "Teneriffa", "Spanien", 28.060, -16.735, 230, 0.8, "Reef", "Fortgeschrittene", ""),
  // Frankreich
  w("graviere", "La Gravière", "Frankreich", "Hossegor", "Frankreich", 43.672, -1.444, 280, 1.0, "Beach", "Erfahrene", "Einer der schwersten Beachbreaks Europas."),
  w("estagnots", "Les Estagnots", "Frankreich", "Seignosse", "Frankreich", 43.695, -1.440, 280, 1.0, "Beach", "Alle", ""),
  w("cavaliers", "Les Cavaliers", "Frankreich", "Anglet", "Frankreich", 43.520, -1.530, 290, 0.95, "Beach", "Alle", ""),
  w("biarritz", "Grande Plage", "Frankreich", "Biarritz", "Frankreich", 43.484, -1.558, 300, 0.85, "Beach", "Alle", ""),
  w("lacanau", "Lacanau", "Frankreich", "Gironde", "Frankreich", 45.000, -1.202, 275, 1.0, "Beach", "Alle", ""),
  w("la-torche", "La Torche", "Frankreich", "Bretagne", "Frankreich", 47.837, -4.351, 250, 0.95, "Beach", "Alle", ""),
  // UK & Irland
  w("fistral", "Fistral", "UK & Irland", "Cornwall", "England", 50.418, -5.100, 300, 0.95, "Beach", "Alle", ""),
  w("thurso", "Thurso East", "UK & Irland", "Schottland", "Schottland", 58.597, -3.509, 0, 0.8, "Reef", "Erfahrene", "Rechte über Flachriff an der Nordküste."),
  w("bundoran", "The Peak (Bundoran)", "UK & Irland", "Donegal", "Irland", 54.478, -8.287, 300, 0.9, "Reef", "Fortgeschrittene", ""),
  w("lahinch", "Lahinch", "UK & Irland", "Clare", "Irland", 52.935, -9.350, 280, 0.9, "Beach", "Alle", ""),
  // Nordsee & Skandinavien
  w("sylt", "Westerland", "Nordsee & Skandinavien", "Sylt", "Deutschland", 54.910, 8.300, 270, 0.9, "Beach", "Alle", "Braucht kräftigen West-/Nordwestwind-Swell."),
  w("klitmoller", "Klitmøller (Cold Hawaii)", "Nordsee & Skandinavien", "Thy", "Dänemark", 57.040, 8.480, 320, 0.9, "Reef", "Fortgeschrittene", ""),
  w("unstad", "Unstad", "Nordsee & Skandinavien", "Lofoten", "Norwegen", 68.270, 13.580, 300, 0.9, "Beach", "Fortgeschrittene", "Arktisches Surfen auf den Lofoten."),
  // Marokko
  w("anchor-point", "Anchor Point", "Marokko", "Taghazout", "Marokko", 30.545, -9.720, 255, 0.85, "Point", "Fortgeschrittene", "Lange Rechte, läuft bei NW-Swell im Winter."),
  w("killer-point", "Killer Point", "Marokko", "Taghazout", "Marokko", 30.560, -9.740, 265, 0.9, "Point", "Erfahrene", ""),
  w("imsouane", "Imsouane (The Bay)", "Marokko", "Imsouane", "Marokko", 30.840, -9.825, 200, 0.55, "Point", "Alle", "Sehr lange, sanfte Rechte in der Bucht."),
  w("safi", "Safi", "Marokko", "Safi", "Marokko", 32.330, -9.270, 280, 0.9, "Point", "Erfahrene", ""),
  // Indonesien
  w("uluwatu", "Uluwatu", "Indonesien", "Bali", "Indonesien", -8.815, 115.085, 230, 1.0, "Reef", "Erfahrene", "Linke über Riff, Trockenzeit (Apr–Okt) mit Ostwind ablandig."),
  w("padang-padang", "Padang Padang", "Indonesien", "Bali", "Indonesien", -8.811, 115.103, 220, 0.85, "Reef", "Erfahrene", ""),
  w("bingin", "Bingin", "Indonesien", "Bali", "Indonesien", -8.806, 115.112, 215, 0.85, "Reef", "Fortgeschrittene", ""),
  w("canggu", "Canggu (Echo Beach)", "Indonesien", "Bali", "Indonesien", -8.654, 115.124, 230, 0.9, "Reef", "Fortgeschrittene", ""),
  w("kuta", "Kuta Beach", "Indonesien", "Bali", "Indonesien", -8.720, 115.168, 250, 0.8, "Beach", "Alle", ""),
  w("keramas", "Keramas", "Indonesien", "Bali", "Indonesien", -8.600, 115.330, 165, 0.85, "Reef", "Fortgeschrittene", "Ostküste: läuft in der Regenzeit mit Westwind."),
  w("medewi", "Medewi", "Indonesien", "Bali", "Indonesien", -8.420, 114.800, 200, 0.7, "Point", "Alle", ""),
  w("g-land", "G-Land", "Indonesien", "Java", "Indonesien", -8.730, 114.360, 200, 1.0, "Reef", "Erfahrene", ""),
  w("desert-point", "Desert Point", "Indonesien", "Lombok", "Indonesien", -8.750, 115.830, 240, 0.8, "Reef", "Erfahrene", ""),
  // Asien
  w("arugam-bay", "Arugam Bay", "Asien", "Sri Lanka", "Sri Lanka", 6.840, 81.840, 110, 0.75, "Point", "Alle", "Ostküste: Saison Mai–Okt."),
  w("weligama", "Weligama", "Asien", "Sri Lanka", "Sri Lanka", 5.970, 80.420, 170, 0.6, "Beach", "Alle", "Südküste: Saison Nov–Apr."),
  w("hiriketiya", "Hiriketiya", "Asien", "Sri Lanka", "Sri Lanka", 5.960, 80.700, 160, 0.65, "Reef", "Alle", ""),
  w("cloud-9", "Cloud 9", "Asien", "Siargao", "Philippinen", 9.810, 126.170, 90, 1.0, "Reef", "Erfahrene", ""),
  // Australien & Neuseeland
  w("snapper", "Snapper Rocks", "Australien & NZ", "Gold Coast", "Australien", -28.163, 153.550, 45, 0.85, "Point", "Fortgeschrittene", "Superbank: lange Rechte."),
  w("burleigh", "Burleigh Heads", "Australien & NZ", "Gold Coast", "Australien", -28.090, 153.455, 70, 0.85, "Point", "Fortgeschrittene", ""),
  w("byron-pass", "The Pass (Byron Bay)", "Australien & NZ", "New South Wales", "Australien", -28.638, 153.620, 15, 0.6, "Point", "Alle", ""),
  w("bondi", "Bondi", "Australien & NZ", "Sydney", "Australien", -33.891, 151.278, 100, 0.85, "Beach", "Alle", ""),
  w("manly", "Manly", "Australien & NZ", "Sydney", "Australien", -33.797, 151.288, 100, 0.85, "Beach", "Alle", ""),
  w("bells", "Bells Beach", "Australien & NZ", "Victoria", "Australien", -38.370, 144.282, 165, 1.0, "Reef", "Fortgeschrittene", ""),
  w("margaret-river", "Margaret River (Main Break)", "Australien & NZ", "Western Australia", "Australien", -33.975, 114.985, 260, 1.0, "Reef", "Erfahrene", ""),
  w("raglan", "Manu Bay (Raglan)", "Australien & NZ", "Waikato", "Neuseeland", -37.820, 174.810, 320, 0.85, "Point", "Fortgeschrittene", ""),
  // Pazifik
  w("teahupoo", "Teahupo'o", "Pazifik", "Tahiti", "Französisch-Polynesien", -17.860, -149.260, 200, 1.1, "Reef", "Big Wave", ""),
  w("cloudbreak", "Cloudbreak", "Pazifik", "Fidschi", "Fidschi", -17.880, 177.190, 230, 1.0, "Reef", "Erfahrene", ""),
  // Hawaii
  w("pipeline", "Pipeline", "Hawaii", "Oahu North Shore", "USA", 21.665, -158.053, 320, 1.0, "Reef", "Erfahrene", "Winter (Nov–Feb) mit NW-Swell."),
  w("sunset", "Sunset Beach", "Hawaii", "Oahu North Shore", "USA", 21.677, -158.040, 320, 1.0, "Reef", "Erfahrene", ""),
  w("waimea", "Waimea Bay", "Hawaii", "Oahu North Shore", "USA", 21.641, -158.066, 300, 0.9, "Point", "Big Wave", ""),
  w("waikiki", "Waikiki", "Hawaii", "Oahu South Shore", "USA", 21.275, -157.830, 190, 0.8, "Reef", "Alle", "Südküste: Sommer-Swell."),
  w("honolua", "Honolua Bay", "Hawaii", "Maui", "USA", 21.013, -156.640, 340, 0.8, "Point", "Erfahrene", ""),
  // Kalifornien
  w("mavericks", "Mavericks", "Kalifornien", "Half Moon Bay", "USA", 37.495, -122.500, 290, 1.0, "Reef", "Big Wave", ""),
  w("ocean-beach-sf", "Ocean Beach", "Kalifornien", "San Francisco", "USA", 37.760, -122.511, 270, 1.0, "Beach", "Erfahrene", ""),
  w("steamer-lane", "Steamer Lane", "Kalifornien", "Santa Cruz", "USA", 36.951, -122.026, 180, 0.8, "Point", "Fortgeschrittene", ""),
  w("rincon", "Rincon", "Kalifornien", "Santa Barbara", "USA", 34.374, -119.477, 220, 0.75, "Point", "Fortgeschrittene", ""),
  w("malibu", "Malibu (Surfrider)", "Kalifornien", "Los Angeles", "USA", 34.035, -118.678, 190, 0.7, "Point", "Alle", ""),
  w("huntington", "Huntington Beach", "Kalifornien", "Orange County", "USA", 33.655, -118.003, 215, 0.85, "Beach", "Alle", ""),
  w("trestles", "Lower Trestles", "Kalifornien", "San Clemente", "USA", 33.382, -117.588, 225, 0.85, "Point", "Fortgeschrittene", ""),
  // Mittelamerika & Mexiko
  w("zicatela", "Zicatela (Puerto Escondido)", "Mittelamerika", "Oaxaca", "Mexiko", 15.850, -97.060, 210, 1.1, "Beach", "Erfahrene", "Mexican Pipeline – sehr schwerer Beachbreak."),
  w("sayulita", "Sayulita", "Mittelamerika", "Nayarit", "Mexiko", 20.870, -105.440, 250, 0.75, "Point", "Alle", ""),
  w("tamarindo", "Tamarindo", "Mittelamerika", "Guanacaste", "Costa Rica", 10.300, -85.840, 270, 0.8, "Beach", "Alle", ""),
  w("santa-teresa", "Santa Teresa", "Mittelamerika", "Nicoya", "Costa Rica", 9.640, -85.170, 250, 0.95, "Beach", "Alle", ""),
  w("hermosa-cr", "Playa Hermosa", "Mittelamerika", "Jacó", "Costa Rica", 9.560, -84.580, 220, 1.0, "Beach", "Fortgeschrittene", ""),
  w("pavones", "Pavones", "Mittelamerika", "Golfito", "Costa Rica", 8.400, -83.140, 200, 0.7, "Point", "Fortgeschrittene", ""),
  w("popoyo", "Popoyo", "Mittelamerika", "Rivas", "Nicaragua", 11.460, -86.120, 250, 0.9, "Reef", "Fortgeschrittene", ""),
  w("santa-catalina", "Santa Catalina", "Mittelamerika", "Veraguas", "Panama", 7.630, -81.260, 200, 0.9, "Reef", "Fortgeschrittene", ""),
  w("soup-bowl", "Soup Bowl", "Mittelamerika", "Barbados", "Barbados", 13.220, -59.520, 80, 0.9, "Reef", "Fortgeschrittene", ""),
  // Südamerika
  w("chicama", "Chicama", "Südamerika", "La Libertad", "Peru", -7.700, -79.440, 300, 0.7, "Point", "Fortgeschrittene", "Eine der längsten Linken der Welt."),
  w("punta-hermosa", "Punta Hermosa", "Südamerika", "Lima", "Peru", -12.330, -76.820, 230, 0.9, "Reef", "Fortgeschrittene", ""),
  w("punta-de-lobos", "Punta de Lobos", "Südamerika", "Pichilemu", "Chile", -34.430, -72.050, 260, 1.0, "Point", "Big Wave", ""),
  w("joaquina", "Joaquina", "Südamerika", "Florianópolis", "Brasilien", -27.630, -48.450, 120, 0.9, "Beach", "Alle", ""),
  w("itacare", "Itacaré", "Südamerika", "Bahia", "Brasilien", -14.280, -38.990, 100, 0.8, "Beach", "Alle", ""),
  w("saquarema", "Saquarema (Itaúna)", "Südamerika", "Rio de Janeiro", "Brasilien", -22.930, -42.480, 160, 1.0, "Beach", "Fortgeschrittene", ""),
  // Südafrika
  w("jbay", "Supertubes (J-Bay)", "Südafrika", "Jeffreys Bay", "Südafrika", -34.031, 24.931, 120, 0.85, "Point", "Erfahrene", "Eine der besten Rechten der Welt, Winter (Jun–Aug)."),
  w("muizenberg", "Muizenberg", "Südafrika", "Kapstadt", "Südafrika", -34.108, 18.470, 170, 0.6, "Beach", "Alle", "Sanfte Wellen, ideal zum Lernen."),
  w("durban", "North Beach", "Südafrika", "Durban", "Südafrika", -29.850, 31.040, 100, 0.8, "Beach", "Alle", ""),
];

export const SURF_AREAS = ["Portugal", ...Array.from(new Set(WORLD_SPOTS.map((spot) => spot.area)))];
export const ALL_SPOTS: SurfSpotDef[] = [...PORTUGAL_SPOTS, ...WORLD_SPOTS];

export type SurfHour = {
  time: string;
  hour: number;
  daylight: boolean;
  /** Estimated breaking wave height at the spot (face height is roughly 1.5–2×). */
  surfHeight: number;
  swellHeight: number;
  swellPeriod: number;
  swellDirection: number;
  secondaryHeight: number;
  secondaryPeriod: number;
  secondaryDirection: number;
  windWaveHeight: number;
  windSpeed: number;
  windGust: number;
  windDirection: number;
  windRelation: WindRelation;
  tide: number | null;
  rating: SurfRating;
  score: number;
};

export type TideTurn = { time: string; kind: "Hoch" | "Niedrig"; level: number };

export type SurfDay = {
  date: string;
  hours: SurfHour[];
  best: SurfHour | null;
  /** Consecutive daylight hours with the best rating of the day, e.g. "08–11 Uhr". */
  bestWindow: string | null;
  rating: SurfRating;
  maxSurf: number;
  tides: TideTurn[];
};

export type SpotForecast = { spot: SurfSpotDef; days: SurfDay[] };

const RATING_ORDER: SurfRating[] = ["epic", "good", "fair", "poor", "flat"];
export const ratingRank = (rating: SurfRating) => RATING_ORDER.indexOf(rating);

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Share of a swell from `direction` that reaches a beach facing `facing`. */
function swellExposure(direction: number, facing: number): number {
  const diff = angleDiff(direction, facing);
  if (diff <= 25) return 1;
  if (diff >= 110) return 0.05;
  // Swell bends (refracts) around, so the falloff is gentle at first.
  return Math.max(0.05, Math.cos(((diff - 25) / 85) * (Math.PI / 2)));
}

/** Longer-period swell carries more energy and shoals up more on arrival. */
function periodFactor(period: number): number {
  if (!period) return 0.8;
  return Math.min(1.35, Math.max(0.65, 0.65 + (period - 6) * 0.06));
}

export function windRelation(windDirection: number, facing: number): WindRelation {
  // Offshore wind blows from land to sea, i.e. from the opposite of where the beach faces.
  const diff = angleDiff(windDirection, (facing + 180) % 360);
  if (diff <= 45) return "ablandig";
  if (diff <= 80) return "schräg ablandig";
  if (diff <= 110) return "seitlich";
  if (diff <= 145) return "schräg auflandig";
  return "auflandig";
}

function rateHour(h: Omit<SurfHour, "rating" | "score">): { rating: SurfRating; score: number } {
  if (h.surfHeight < 0.35) return { rating: "flat", score: 0 };
  let score = 0;
  // Size
  if (h.surfHeight >= 3.5) score += 2; // big, only for experienced surfers
  else if (h.surfHeight >= 1.2) score += 3;
  else if (h.surfHeight >= 0.7) score += 2;
  else score += 1;
  // Period / quality of swell
  const period = h.swellPeriod || 0;
  if (period >= 13) score += 3;
  else if (period >= 10) score += 2;
  else if (period >= 8) score += 1;
  // Wind
  const w = h.windSpeed;
  if (w < 8) score += 2;
  else if (h.windRelation === "ablandig" && w < 28) score += 3;
  else if (h.windRelation === "schräg ablandig" && w < 25) score += 2;
  else if (h.windRelation === "seitlich" && w < 15) score += 1;
  else if ((h.windRelation === "auflandig" || h.windRelation === "schräg auflandig") && w >= 15) score -= 2;
  else if (h.windRelation === "auflandig" || h.windRelation === "schräg auflandig") score -= 1;
  if (w >= 35) score -= 2;
  // Choppy when wind sea dominates the swell
  if (h.windWaveHeight > h.swellHeight) score -= 1;

  if (score >= 8) return { rating: "epic", score };
  if (score >= 6) return { rating: "good", score };
  if (score >= 4) return { rating: "fair", score };
  return { rating: "poor", score };
}

function num(arr: unknown, i: number): number {
  const v = Array.isArray(arr) ? arr[i] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(arr: unknown, i: number): number | null {
  const v = Array.isArray(arr) ? arr[i] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function findTideTurns(hours: SurfHour[]): TideTurn[] {
  const turns: TideTurn[] = [];
  for (let i = 1; i < hours.length - 1; i++) {
    const prev = hours[i - 1]?.tide, cur = hours[i]?.tide, next = hours[i + 1]?.tide;
    if (prev == null || cur == null || next == null) continue;
    if (cur > prev && cur >= next) turns.push({ time: hours[i]!.time, kind: "Hoch", level: cur });
    else if (cur < prev && cur <= next) turns.push({ time: hours[i]!.time, kind: "Niedrig", level: cur });
  }
  return turns;
}

function bestWindow(hours: SurfHour[], rating: SurfRating): string | null {
  let bestStart = -1, bestLen = 0, start = -1;
  hours.forEach((h, i) => {
    if (h.daylight && h.rating === rating) {
      if (start < 0) start = i;
      const len = i - start + 1;
      if (len > bestLen) { bestLen = len; bestStart = start; }
    } else start = -1;
  });
  if (bestStart < 0) return null;
  const from = hours[bestStart]!.hour;
  const to = hours[bestStart + bestLen - 1]!.hour + 1;
  return `${String(from).padStart(2, "0")}–${String(to).padStart(2, "0")} Uhr`;
}

type ApiBlock = { hourly?: Record<string, unknown>; daily?: Record<string, unknown> };

function asList(payload: unknown): ApiBlock[] {
  return Array.isArray(payload) ? (payload as ApiBlock[]) : [payload as ApiBlock];
}

/** Loads weather + marine data for all spots in two requests and builds the spot forecasts. */
export async function fetchSpotForecasts(spots: SurfSpotDef[], forecastDays = 7): Promise<SpotForecast[]> {
  if (spots.length === 0) return [];
  const lats = spots.map((s) => s.lat.toFixed(3)).join(",");
  const lons = spots.map((s) => s.lon.toFixed(3)).join(",");
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=sunrise,sunset` +
    `&timezone=auto&forecast_days=${forecastDays}`;
  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}` +
    `&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,` +
    `secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction,` +
    `wind_wave_height,sea_level_height_msl&cell_selection=sea&timezone=auto&forecast_days=${forecastDays}`;

  const [wRes, mRes] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);
  if (!wRes.ok) throw new Error(`Wetterdaten nicht verfügbar (${wRes.status})`);
  if (!mRes.ok) throw new Error(`Wellendaten nicht verfügbar (${mRes.status})`);
  const weather = asList(await wRes.json());
  const marine = asList(await mRes.json());

  return spots.map((spot, index) => {
    const w = weather[index]?.hourly ?? {};
    const daily = weather[index]?.daily ?? {};
    const m = marine[index]?.hourly ?? {};
    const times = (Array.isArray(w.time) ? w.time : []) as string[];
    const sunrise = (Array.isArray(daily.sunrise) ? daily.sunrise : []) as string[];
    const sunset = (Array.isArray(daily.sunset) ? daily.sunset : []) as string[];

    const hours: SurfHour[] = times.map((time, i) => {
      const dayIdx = Math.floor(i / 24);
      const daylight = Boolean(sunrise[dayIdx] && sunset[dayIdx] && time >= sunrise[dayIdx]!.slice(0, 13) && time <= sunset[dayIdx]!);
      const swellHeight = num(m.swell_wave_height, i) || num(m.wave_height, i);
      const swellPeriod = num(m.swell_wave_period, i);
      const swellDirection = num(m.swell_wave_direction, i);
      const secondaryHeight = num(m.secondary_swell_wave_height, i);
      const secondaryPeriod = num(m.secondary_swell_wave_period, i);
      const secondaryDirection = num(m.secondary_swell_wave_direction, i);
      const windWaveHeight = num(m.wind_wave_height, i);
      const primary = swellHeight * swellExposure(swellDirection, spot.facing) * periodFactor(swellPeriod);
      const secondary = secondaryHeight * swellExposure(secondaryDirection, spot.facing) * periodFactor(secondaryPeriod);
      const surfHeight = Math.sqrt(primary ** 2 + secondary ** 2) * spot.exposure;
      const windDirection = num(w.wind_direction_10m, i);
      const base = {
        time,
        hour: Number(time.slice(11, 13)),
        daylight,
        surfHeight,
        swellHeight,
        swellPeriod,
        swellDirection,
        secondaryHeight,
        secondaryPeriod,
        secondaryDirection,
        windWaveHeight,
        windSpeed: num(w.wind_speed_10m, i),
        windGust: num(w.wind_gusts_10m, i),
        windDirection,
        windRelation: windRelation(windDirection, spot.facing),
        tide: numOrNull(m.sea_level_height_msl, i),
      };
      return { ...base, ...rateHour(base) };
    });

    const days: SurfDay[] = [];
    for (let d = 0; d * 24 < hours.length; d++) {
      const dayHours = hours.slice(d * 24, d * 24 + 24);
      const light = dayHours.filter((h) => h.daylight);
      const pool = light.length > 0 ? light : dayHours;
      const best = pool.reduce<SurfHour | null>((acc, h) => (!acc || h.score > acc.score || (h.score === acc.score && h.surfHeight > acc.surfHeight) ? h : acc), null);
      const rating = best?.rating ?? "flat";
      days.push({
        date: dayHours[0]?.time.slice(0, 10) ?? "",
        hours: dayHours,
        best,
        bestWindow: best ? bestWindow(dayHours, rating) : null,
        rating,
        maxSurf: Math.max(0, ...pool.map((h) => h.surfHeight)),
        tides: findTideTurns(hours.slice(Math.max(0, d * 24 - 1), d * 24 + 25)).filter((t) => t.time.startsWith(dayHours[0]?.time.slice(0, 10) ?? "")),
      });
    }
    return { spot, days };
  });
}

/** Spot for a place found via worldwide search: orientation unknown, so assume the dominant swell hits it. */
export function spotFromSearch(place: { name: string; lat: number; lon: number; region?: string; country?: string }): SurfSpotDef {
  return {
    id: `search-${place.lat.toFixed(3)}-${place.lon.toFixed(3)}`,
    area: "Suche",
    name: place.name,
    region: place.region ?? "",
    country: place.country ?? "",
    lat: place.lat,
    lon: place.lon,
    facing: -1,
    exposure: 0.85,
    breakType: "Beach",
    level: "Alle",
    note: "",
    source: "search",
  };
}

/**
 * Works out which way a coast faces: samples the terrain height on a ring around the
 * point (Open-Meteo elevation, ~90 m DEM) and averages the directions that are sea.
 * Returns null on open water, inland, or when sea surrounds the point (islands, spits).
 */
export async function detectFacing(lat: number, lon: number): Promise<number | null> {
  const samples = 24;
  for (const radiusKm of [1, 2.5]) {
    const lats: string[] = [], lons: string[] = [];
    for (let i = 0; i < samples; i++) {
      const a = ((i * 360) / samples) * (Math.PI / 180);
      lats.push((lat + (radiusKm / 111) * Math.cos(a)).toFixed(4));
      lons.push((lon + (radiusKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a)).toFixed(4));
    }
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`);
    if (!res.ok) return null;
    const { elevation } = (await res.json()) as { elevation?: number[] };
    if (!elevation) return null;
    let x = 0, y = 0, sea = 0;
    elevation.forEach((h, i) => {
      if (h <= 0) {
        const a = ((i * 360) / samples) * (Math.PI / 180);
        x += Math.sin(a); y += Math.cos(a); sea++;
      }
    });
    // A clear coastline has sea on roughly a quarter to three quarters of the ring.
    if (sea >= samples * 0.2 && sea <= samples * 0.8 && Math.hypot(x, y) > sea * 0.3) {
      return Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360);
    }
  }
  return null;
}

/** For search results the facing is unknown: detect it from the coastline, else use the prevailing swell. */
export async function fetchForecastForSpot(spot: SurfSpotDef): Promise<SpotForecast> {
  if (spot.facing >= 0) return (await fetchSpotForecasts([spot]))[0]!;
  const detected = await detectFacing(spot.lat, spot.lon).catch(() => null);
  if (detected != null) {
    const forecast = (await fetchSpotForecasts([{ ...spot, facing: detected, note: `Ausrichtung automatisch aus der Küstenlinie ermittelt (${compass(detected)}).` }]))[0]!;
    return forecast;
  }
  const probe = (await fetchSpotForecasts([{ ...spot, facing: 270 }], 1))[0];
  const dirs = probe?.days[0]?.hours.map((h) => h.swellDirection).filter((d) => d > 0) ?? [];
  const facing = dirs.length > 0 ? (dirs.reduce((a, b) => a + b, 0) / dirs.length) : 270;
  return (await fetchSpotForecasts([{ ...spot, facing, note: "Küstenlinie nicht eindeutig – Ausrichtung aus der vorherrschenden Swellrichtung geschätzt, daher grober." }]))[0]!;
}

export const RATING_LABEL: Record<SurfRating, string> = {
  epic: "Top",
  good: "Gut",
  fair: "Okay",
  poor: "Schwach",
  flat: "Flach",
};

export function compass(deg: number): string {
  const dirs = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? "N";
}
