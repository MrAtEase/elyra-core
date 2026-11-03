"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Cloud,
  Droplets,
  Eye,
  Gauge,
  MapPin,
  RefreshCw,
  Search,
  Sunset,
  Thermometer,
  Waves,
  Wind,
} from "lucide-react";

type Location = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  timezone?: string;
};

type SurfSpot = Location & {
  tags: string[];
  orientation?: number;
  breakType?: "beach" | "reef" | "point" | "coastal";
  source: "curated" | "geocoding";
};

type HourlyWeather = {
  time: string;
  hour: number;
  temp: number;
  feelsLike: number;
  weatherCode: number;
  precipitation: number;
  precipProbability: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  humidity: number;
  pressure: number;
  uvIndex: number;
  visibility: number;
  cloudCover: number;
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  swellHeight: number;
  swellPeriod: number;
  swellDirection: number;
};

type DaySummary = {
  date: string;
  label: string;
  maxTemp: number;
  minTemp: number;
  weatherCode: number;
  maxPrecip: number;
  maxWind: number;
  maxWave: number;
  surfRating: SurfRating;
  hours: HourlyWeather[];
};

type SurfRating = "epic" | "good" | "fair" | "poor" | "flat";

type GeoResult = {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

const SURF_SPOTS: SurfSpot[] = [
  { name: "Costa da Caparica (CDS)", region: "Costa da Caparica", country: "Portugal", lat: 38.53, lon: -9.24, tags: ["caparica", "cds", "lisbon", "portugal"], orientation: 270, breakType: "beach", source: "curated" },
  { name: "Fonte da Telha", region: "Costa da Caparica", country: "Portugal", lat: 38.46, lon: -9.21, tags: ["caparica", "telha", "lisbon", "portugal"], orientation: 280, breakType: "beach", source: "curated" },
  { name: "Guincho", region: "Cascais", country: "Portugal", lat: 38.73, lon: -9.47, tags: ["guincho", "cascais", "lisbon", "portugal"], orientation: 290, breakType: "beach", source: "curated" },
  { name: "Ericeira", region: "Ericeira", country: "Portugal", lat: 38.96, lon: -9.42, tags: ["ericeira", "ribeira", "portugal", "wsl"], orientation: 280, breakType: "reef", source: "curated" },
  { name: "Supertubos", region: "Peniche", country: "Portugal", lat: 39.36, lon: -9.38, tags: ["peniche", "supertubos", "portugal", "wsl"], orientation: 270, breakType: "beach", source: "curated" },
  { name: "Baleal", region: "Peniche", country: "Portugal", lat: 39.38, lon: -9.35, tags: ["peniche", "baleal", "portugal"], orientation: 285, breakType: "beach", source: "curated" },
  { name: "Uluwatu", region: "Bali", country: "Indonesia", lat: -8.82, lon: 115.08, tags: ["bali", "uluwatu", "ulu", "indonesia"], orientation: 200, breakType: "reef", source: "curated" },
  { name: "Padang Padang", region: "Bali", country: "Indonesia", lat: -8.81, lon: 115.1, tags: ["bali", "padang", "indonesia"], orientation: 195, breakType: "reef", source: "curated" },
  { name: "Canggu (Echo Beach)", region: "Bali", country: "Indonesia", lat: -8.65, lon: 115.13, tags: ["bali", "canggu", "echo", "indonesia"], orientation: 260, breakType: "beach", source: "curated" },
  { name: "La Graviere", region: "Hossegor", country: "France", lat: 43.67, lon: -1.44, tags: ["hossegor", "graviere", "france", "wsl"], orientation: 270, breakType: "beach", source: "curated" },
  { name: "Mundaka", region: "Basque Country", country: "Spain", lat: 43.41, lon: -2.69, tags: ["mundaka", "spain", "basque"], orientation: 330, breakType: "point", source: "curated" },
  { name: "Pipeline", region: "North Shore Oahu", country: "USA", lat: 21.66, lon: -158.05, tags: ["pipeline", "pipe", "hawaii", "oahu"], orientation: 330, breakType: "reef", source: "curated" },
  { name: "Mavericks", region: "Half Moon Bay", country: "USA", lat: 37.49, lon: -122.5, tags: ["mavericks", "california", "usa"], orientation: 295, breakType: "reef", source: "curated" },
  { name: "Supertubes (J-Bay)", region: "Jeffreys Bay", country: "South Africa", lat: -34.05, lon: 24.93, tags: ["jbay", "jeffreys bay", "south africa"], orientation: 50, breakType: "point", source: "curated" },
  { name: "Taghazout", region: "Agadir", country: "Morocco", lat: 30.55, lon: -9.71, tags: ["taghazout", "morocco", "anchor point"], orientation: 290, breakType: "point", source: "curated" },
];

const DEFAULT_LOCATION: Location = {
  name: "Costa da Caparica",
  region: "Setubal",
  country: "Portugal",
  lat: 38.53,
  lon: -9.24,
  timezone: "Europe/Lisbon",
};

function wmoEmoji(code: number): string {
  if (code === 0) return "☀";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁";
  if (code <= 49) return "🌫";
  if (code <= 57) return "🌨";
  if (code <= 67) return "🌧";
  if (code <= 77) return "❄";
  if (code <= 82) return "🌦";
  if (code <= 84) return "🌧";
  return "⛈";
}

function wmoLabel(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 49) return "Foggy";
  if (code <= 57) return "Light drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 84) return "Snow showers";
  return "Thunderstorm";
}

function degToCompass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16] ?? "N";
}

function formatPlace(location: Pick<Location, "name" | "region" | "country">): string {
  return [location.name, location.region, location.country].filter(Boolean).join(", ");
}

function formatDayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  return new Date(date).toLocaleDateString("en", { weekday: "short", day: "numeric" });
}

function formatCalendarLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en", { day: "numeric", month: "short" });
}

function windRelToSwell(windDir: number, swellDir: number): "offshore" | "onshore" | "cross" | "side-off" | "side-on" {
  const diff = Math.abs(((windDir - swellDir + 540) % 360) - 180);
  if (diff > 150) return "offshore";
  if (diff < 30) return "onshore";
  if (diff > 120) return "side-off";
  if (diff < 60) return "side-on";
  return "cross";
}

function rateSurf(hour: HourlyWeather): SurfRating {
  if (hour.waveHeight < 0.3) return "flat";
  const relation = windRelToSwell(hour.windDirection, hour.waveDirection);
  let score = 0;
  if (hour.waveHeight >= 1.8) score += 3;
  else if (hour.waveHeight >= 1.0) score += 2;
  else if (hour.waveHeight >= 0.5) score += 1;
  if (hour.wavePeriod >= 14) score += 3;
  else if (hour.wavePeriod >= 10) score += 2;
  else if (hour.wavePeriod >= 7) score += 1;
  if (relation === "offshore" && hour.windSpeed < 15) score += 3;
  else if (relation === "side-off" && hour.windSpeed < 20) score += 2;
  else if (relation === "cross" && hour.windSpeed < 14) score += 1;
  else if (relation === "onshore" || relation === "side-on") score -= 1;
  if (hour.windSpeed > 30) score -= 2;
  if (score >= 8) return "epic";
  if (score >= 5) return "good";
  if (score >= 3) return "fair";
  return "poor";
}

function ratingColor(rating: SurfRating): string {
  if (rating === "epic") return "#7c3aed";
  if (rating === "good") return "#16a34a";
  if (rating === "fair") return "#ca8a04";
  if (rating === "poor") return "#dc2626";
  return "#64748b";
}

function ratingBadgeStyle(rating: SurfRating): { color: string; background: string; borderColor: string } {
  if (rating === "epic") return { color: "#581c87", background: "#f3e8ff", borderColor: "#d8b4fe" };
  if (rating === "good") return { color: "#14532d", background: "#dcfce7", borderColor: "#86efac" };
  if (rating === "fair") return { color: "#78350f", background: "#fef3c7", borderColor: "#fbbf24" };
  if (rating === "poor") return { color: "#7f1d1d", background: "#fee2e2", borderColor: "#fca5a5" };
  return { color: "#334155", background: "#e2e8f0", borderColor: "#cbd5e1" };
}

function ratingLabel(rating: SurfRating): string {
  if (rating === "epic") return "EPIC";
  if (rating === "good") return "GOOD";
  if (rating === "fair") return "FAIR";
  if (rating === "poor") return "POOR";
  return "FLAT";
}

async function fetchWeatherData(location: Location): Promise<DaySummary[]> {
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=temperature_2m,apparent_temperature,weather_code,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,surface_pressure,uv_index,visibility,cloud_cover` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
    `&timezone=auto&forecast_days=7`;

  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction` +
    `&timezone=auto&forecast_days=7`;

  const [weatherResponse, marineResponse] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);
  if (!weatherResponse.ok) throw new Error(`Weather API ${weatherResponse.status}`);

  const [weatherData, marineData] = await Promise.all([
    weatherResponse.json() as Promise<Record<string, unknown>>,
    marineResponse.ok ? (marineResponse.json() as Promise<Record<string, unknown>>) : Promise.resolve(null),
  ]);

  const hourly = weatherData.hourly as Record<string, number[] | string[]>;
  const daily = weatherData.daily as Record<string, Array<number | string>>;
  const marineHourly = marineData ? ((marineData as Record<string, unknown>).hourly as Record<string, number[]>) : null;
  const times = Array.isArray(hourly.time) ? (hourly.time as string[]) : [];

  const allHours: HourlyWeather[] = times.map((time, index) => {
    const stamp = new Date(time);
    return {
      time,
      hour: stamp.getHours(),
      temp: Number(hourly.temperature_2m?.[index] ?? 0),
      feelsLike: Number(hourly.apparent_temperature?.[index] ?? 0),
      weatherCode: Number(hourly.weather_code?.[index] ?? 0),
      precipitation: Number(hourly.precipitation?.[index] ?? 0),
      precipProbability: Number(hourly.precipitation_probability?.[index] ?? 0),
      windSpeed: Number(hourly.wind_speed_10m?.[index] ?? 0),
      windDirection: Number(hourly.wind_direction_10m?.[index] ?? 0),
      windGust: Number(hourly.wind_gusts_10m?.[index] ?? 0),
      humidity: Number(hourly.relative_humidity_2m?.[index] ?? 0),
      pressure: Number(hourly.surface_pressure?.[index] ?? 1013),
      uvIndex: Number(hourly.uv_index?.[index] ?? 0),
      visibility: Number(hourly.visibility?.[index] ?? 10000),
      cloudCover: Number(hourly.cloud_cover?.[index] ?? 0),
      waveHeight: Number(marineHourly?.wave_height?.[index] ?? 0),
      wavePeriod: Number(marineHourly?.wave_period?.[index] ?? 0),
      waveDirection: Number(marineHourly?.wave_direction?.[index] ?? 0),
      swellHeight: Number(marineHourly?.swell_wave_height?.[index] ?? 0),
      swellPeriod: Number(marineHourly?.swell_wave_period?.[index] ?? 0),
      swellDirection: Number(marineHourly?.swell_wave_direction?.[index] ?? 0),
    };
  });

  const dailyTimes = Array.isArray(daily.time) ? (daily.time as string[]) : [];
  return dailyTimes.map((date, dayIndex) => {
    const hours = allHours.slice(dayIndex * 24, dayIndex * 24 + 24);
    const bestHour = hours.reduce<HourlyWeather | null>((best, hour) => {
      if (!best) return hour;
      const order: SurfRating[] = ["epic", "good", "fair", "poor", "flat"];
      return order.indexOf(rateSurf(hour)) < order.indexOf(rateSurf(best)) ? hour : best;
    }, null);
    const peakHour = hours.find((hour) => hour.hour >= 10 && hour.hour <= 16) ?? hours[12] ?? hours[0];

    return {
      date,
      label: new Date(date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }),
      maxTemp: Number(daily.temperature_2m_max?.[dayIndex] ?? 0),
      minTemp: Number(daily.temperature_2m_min?.[dayIndex] ?? 0),
      weatherCode: peakHour?.weatherCode ?? 0,
      maxPrecip: Number(daily.precipitation_sum?.[dayIndex] ?? 0),
      maxWind: Number(daily.wind_speed_10m_max?.[dayIndex] ?? 0),
      maxWave: Math.max(0, ...hours.map((hour) => hour.waveHeight)),
      surfRating: bestHour ? rateSurf(bestHour) : "flat",
      hours,
    } satisfies DaySummary;
  });
}

async function fetchLocationSuggestions(query: string): Promise<Location[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=8&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Location search failed (${response.status})`);
  const payload = (await response.json()) as { results?: GeoResult[] };
  return (payload.results ?? []).map((result) => ({
    name: result.name,
    lat: result.latitude,
    lon: result.longitude,
    ...(typeof result.country === "string" ? { country: result.country } : {}),
    ...(typeof result.admin1 === "string" ? { region: result.admin1 } : {}),
    ...(typeof result.timezone === "string" ? { timezone: result.timezone } : {}),
  }));
}

function searchCuratedSurfSpots(query: string): SurfSpot[] {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];
  return SURF_SPOTS.filter((spot) => {
    const haystack = [spot.name, spot.region, spot.country, ...spot.tags].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

async function fetchSurfSuggestions(query: string): Promise<SurfSpot[]> {
  const [curated, geocoded] = await Promise.all([
    Promise.resolve(searchCuratedSurfSpots(query)),
    fetchLocationSuggestions(query).catch(() => []),
  ]);

  const deduped = new Map<string, SurfSpot>();
  for (const spot of curated) {
    deduped.set(`${spot.name}:${spot.lat}:${spot.lon}`, spot);
  }
  for (const location of geocoded) {
    const key = `${location.name}:${location.lat}:${location.lon}`;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      ...location,
      tags: [location.name.toLowerCase(), location.region?.toLowerCase() ?? "", location.country?.toLowerCase() ?? ""].filter(Boolean),
      breakType: "coastal",
      source: "geocoding",
    });
  }
  return Array.from(deduped.values()).slice(0, 12);
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
      <div className="flex items-center gap-1.5 text-[color:var(--text-secondary)]">
        <span className="h-3.5 w-3.5">{icon}</span>
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-semibold text-[color:var(--text-primary)]">{value}</div>
      {sub ? <div className="text-[10px] text-[color:var(--text-tertiary)]">{sub}</div> : null}
    </div>
  );
}

function WindCompass({ dir, speed }: { dir: number; speed: number }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">Wind</div>
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full" style={{ border: "1px solid var(--os-border-soft)" }} />
        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-[color:var(--text-secondary)]">
          <span className="absolute top-1">N</span>
          <span className="absolute bottom-1">S</span>
          <span className="absolute left-1">W</span>
          <span className="absolute right-1">E</span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `rotate(${dir}deg)` }}>
          <div className="h-5 w-0.5 -translate-y-1 rounded-full" style={{ background: "var(--os-accent)" }} />
          <div className="absolute -top-1 h-0 w-0" style={{ borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: "8px solid var(--os-accent)", transform: "translateX(-50%)", left: "50%" }} />
        </div>
      </div>
      <div className="text-sm font-semibold text-[color:var(--text-primary)]">{degToCompass(dir)} {speed.toFixed(0)} km/h</div>
    </div>
  );
}

function PressureGauge({ pressure }: { pressure: number }) {
  const pct = Math.max(0, Math.min(100, ((pressure - 960) / 80) * 100));
  const label = pressure < 1000 ? "Low" : pressure > 1020 ? "High" : "Normal";
  return (
    <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
      <div className="flex items-center gap-1.5 text-[color:var(--text-secondary)]">
        <Gauge size={12} />
        <span className="text-[10px] uppercase tracking-wide">Pressure</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--os-border-faint)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--os-accent)" }} />
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="font-semibold text-[color:var(--text-primary)]">{pressure.toFixed(0)} hPa</span>
        <span className="text-[color:var(--text-secondary)]">{label}</span>
      </div>
    </div>
  );
}

function SurfRatingBadge({ rating }: { rating: SurfRating }) {
  const style = ratingBadgeStyle(rating);
  return (
    <span className="rounded border px-1.5 py-0.5 text-[10px] font-bold" style={{ color: style.color, background: style.background, borderColor: style.borderColor }}>
      {ratingLabel(rating)}
    </span>
  );
}

function SearchResultsList({
  results,
  emptyLabel,
  onSelect,
}: {
  results: Location[];
  emptyLabel: string;
  onSelect: (location: Location) => void;
}) {
  if (results.length === 0) {
    return <p className="px-3 py-3 text-xs text-[color:var(--text-secondary)]">{emptyLabel}</p>;
  }
  return (
    <div className="max-h-64 overflow-y-auto">
      {results.map((result) => (
        <button
          key={`${result.name}:${result.lat}:${result.lon}`}
          type="button"
          onClick={() => onSelect(result)}
          className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-[color:var(--bg-surface-hover)]"
        >
          <span className="text-xs font-medium text-[color:var(--text-primary)]">{result.name}</span>
          <span className="text-[10px] text-[color:var(--text-secondary)]">{[result.region, result.country].filter(Boolean).join(", ")}</span>
        </button>
      ))}
    </div>
  );
}

export default function WeatherWindow() {
  const [tab, setTab] = useState<"weather" | "surf">("weather");
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);

  const [weatherQuery, setWeatherQuery] = useState("");
  const [weatherResults, setWeatherResults] = useState<Location[]>([]);
  const [weatherSearchBusy, setWeatherSearchBusy] = useState(false);

  const [surfQuery, setSurfQuery] = useState("");
  const [surfResults, setSurfResults] = useState<SurfSpot[]>([]);
  const [surfSearchBusy, setSurfSearchBusy] = useState(false);
  const [selectedSurfSpot, setSelectedSurfSpot] = useState<SurfSpot | null>(null);
  const [spotDays, setSpotDays] = useState<DaySummary[]>([]);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);

  const fetchCount = useRef(0);

  const fetchData = useCallback(async (nextLocation: Location) => {
    const requestId = ++fetchCount.current;
    setLoading(true);
    setError(null);
    try {
      const forecast = await fetchWeatherData(nextLocation);
      if (requestId !== fetchCount.current) return;
      setDays(forecast);
      setSelectedDay(0);
    } catch (cause) {
      if (requestId !== fetchCount.current) return;
      setError(cause instanceof Error ? cause.message : "Failed to load weather");
    } finally {
      if (requestId === fetchCount.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(location);
  }, [fetchData, location]);

  useEffect(() => {
    const trimmed = weatherQuery.trim();
    if (!trimmed) {
      setWeatherResults([]);
      setWeatherSearchBusy(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setWeatherSearchBusy(true);
      void fetchLocationSuggestions(trimmed)
        .then((results) => setWeatherResults(results))
        .catch(() => setWeatherResults([]))
        .finally(() => setWeatherSearchBusy(false));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [weatherQuery]);

  useEffect(() => {
    const trimmed = surfQuery.trim();
    if (!trimmed) {
      setSurfResults([]);
      setSurfSearchBusy(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setSurfSearchBusy(true);
      void fetchSurfSuggestions(trimmed)
        .then((results) => setSurfResults(results))
        .catch(() => setSurfResults([]))
        .finally(() => setSurfSearchBusy(false));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [surfQuery]);

  useEffect(() => {
    if (!selectedSurfSpot) return;
    let cancelled = false;
    setSpotLoading(true);
    setSpotError(null);
    void fetchWeatherData(selectedSurfSpot)
      .then((forecast) => {
        if (cancelled) return;
        setSpotDays(forecast);
      })
      .catch((cause) => {
        if (cancelled) return;
        setSpotDays([]);
        setSpotError(cause instanceof Error ? cause.message : "Failed to load surf forecast");
      })
      .finally(() => {
        if (!cancelled) setSpotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSurfSpot]);

  const today = days[selectedDay];
  const now = today?.hours.find((hour) => hour.hour === new Date().getHours()) ?? today?.hours[12];
  const surfForecastDays = selectedSurfSpot ? spotDays : days;
  const surfToday = surfForecastDays[0];
  const surfNow = surfToday?.hours.find((hour) => hour.hour === new Date().getHours()) ?? surfToday?.hours[12];
  const surfLocation = selectedSurfSpot ?? location;

  const featuredSpots = useMemo(() => SURF_SPOTS.slice(0, 8), []);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-canvas)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--os-border-faint)" }}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="text-[color:var(--text-secondary)]" />
              <span className="truncate text-sm font-medium text-[color:var(--text-primary)]">{formatPlace(location)}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-[color:var(--text-secondary)]">Worldwide weather search and marine-backed surf forecast</p>
          </div>
          <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
            <button type="button" onClick={() => setTab("weather")} className="rounded-md px-3 py-1 text-xs font-medium transition" style={{ background: tab === "weather" ? "var(--bg-elevated)" : "transparent", color: tab === "weather" ? "var(--text-primary)" : "var(--text-secondary)" }}>
              <span className="flex items-center gap-1.5"><Cloud size={11} /> Weather</span>
            </button>
            <button type="button" onClick={() => setTab("surf")} className="rounded-md px-3 py-1 text-xs font-medium transition" style={{ background: tab === "surf" ? "var(--bg-elevated)" : "transparent", color: tab === "surf" ? "var(--text-primary)" : "var(--text-secondary)" }}>
              <span className="flex items-center gap-1.5"><Waves size={11} /> Surf</span>
            </button>
          </div>
        </div>
        <button type="button" onClick={() => void fetchData(location)} disabled={loading} className="rounded-lg p-1.5 text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]" style={{ background: "var(--bg-surface)" }}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="border-b px-4 py-3" style={{ borderColor: "var(--os-border-faint)" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-soft)" }}>
            <Search size={14} className="text-[color:var(--text-secondary)]" />
            <input
              type="text"
              value={weatherQuery}
              onChange={(event) => setWeatherQuery(event.target.value)}
              placeholder="Search any city, town, or region worldwide…"
              className="w-full bg-transparent text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-secondary)] outline-none"
            />
            {weatherSearchBusy ? <RefreshCw size={13} className="animate-spin text-[color:var(--text-secondary)]" /> : null}
          </div>
          {weatherQuery.trim() ? (
            <div className="rounded-xl border px-2.5 py-1.5 text-[11px] text-[color:var(--text-secondary)]" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}>
              Search chooses the weather location instantly.
            </div>
          ) : null}
        </div>
        {weatherQuery.trim() ? (
          <div className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}>
            <SearchResultsList
              results={weatherResults}
              emptyLabel={weatherSearchBusy ? "Searching locations…" : "No places found. Try city, region, or country."}
              onSelect={(nextLocation) => {
                setLocation(nextLocation);
                setWeatherQuery("");
                setWeatherResults([]);
              }}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[color:var(--text-secondary)]">
          <div>
            <p>{error}</p>
            <button type="button" onClick={() => void fetchData(location)} className="mt-2 text-[color:var(--os-accent)] underline">Retry</button>
          </div>
        </div>
      ) : loading && days.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[color:var(--text-secondary)]">
          <RefreshCw size={14} className="animate-spin" />
          <span>Loading weather…</span>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {tab === "weather" ? (
            <WeatherTab days={days} selectedDay={selectedDay} onSelectDay={setSelectedDay} now={now} />
          ) : (
            <SurfTab
              query={surfQuery}
              onQueryChange={setSurfQuery}
              searchBusy={surfSearchBusy}
              results={surfResults}
              featuredSpots={featuredSpots}
              selectedSpot={selectedSurfSpot}
              onSelectSpot={(spot) => {
                setSelectedSurfSpot(spot);
                setSurfQuery("");
                setSurfResults([]);
              }}
              forecastDays={surfForecastDays}
              loading={spotLoading}
              error={spotError}
              location={surfLocation}
              now={surfNow}
            />
          )}
        </div>
      )}
    </div>
  );
}

function WeatherTab({
  days,
  selectedDay,
  onSelectDay,
  now,
}: {
  days: DaySummary[];
  selectedDay: number;
  onSelectDay: (index: number) => void;
  now: HourlyWeather | undefined;
}) {
  const today = days[selectedDay];
  if (!today || !now) return null;

  const chartHours = today.hours.filter((_, index) => index % 2 === 0);
  const maxPrecipProb = Math.max(10, ...chartHours.map((hour) => hour.precipProbability));
  const tempRange = today.maxTemp - today.minTemp || 1;

  return (
    <div className="flex flex-1 flex-col gap-0 overflow-y-auto">
      <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-3" style={{ borderBottom: "1px solid var(--os-border-faint)", background: "var(--bg-canvas)" }}>
        {days.map((day, index) => {
          const isActive = selectedDay === index;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDay(index)}
              className="flex min-w-[106px] flex-col items-center gap-1 rounded-2xl px-3 py-2.5 text-center transition"
              style={{
                background: isActive ? "var(--bg-elevated)" : "var(--bg-surface)",
                border: `1px solid ${isActive ? "var(--os-accent)" : "var(--os-border-faint)"}`,
                boxShadow: isActive ? "0 10px 20px rgba(15, 23, 42, 0.12)" : "none",
              }}
            >
              <div className="leading-tight">
                <span
                  className="block text-xs font-semibold"
                  style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {formatDayLabel(day.date, index)}
                </span>
                <span
                  className="block text-[11px]"
                  style={{ color: isActive ? "var(--text-secondary)" : "var(--text-tertiary)" }}
                >
                  {formatCalendarLabel(day.date)}
                </span>
              </div>
              <span className="text-2xl leading-none">{wmoEmoji(day.weatherCode)}</span>
              <span
                className="text-xs font-semibold"
                style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {day.maxTemp.toFixed(0)}° / {day.minTemp.toFixed(0)}°
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-6xl font-thin text-[color:var(--text-primary)]">{now.temp.toFixed(0)}°</span>
              <span className="mb-2 text-4xl">{wmoEmoji(now.weatherCode)}</span>
            </div>
            <p className="mt-0.5 text-sm text-[color:var(--text-secondary)]">{wmoLabel(now.weatherCode)} · Feels like {now.feelsLike.toFixed(0)}°</p>
          </div>
          <div className="text-right text-xs text-[color:var(--text-secondary)]">
            <p>{today.label}</p>
            <p className="mt-1">H: {today.maxTemp.toFixed(0)}° L: {today.minTemp.toFixed(0)}°</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
        <StatCard icon={<Droplets size={12} />} label="Humidity" value={`${now.humidity.toFixed(0)}%`} sub="Relative" />
        <StatCard icon={<Eye size={12} />} label="Visibility" value={now.visibility >= 10000 ? ">10 km" : `${(now.visibility / 1000).toFixed(1)} km`} />
        <StatCard icon={<Thermometer size={12} />} label="Feels Like" value={`${now.feelsLike.toFixed(0)}°C`} sub={now.feelsLike < now.temp ? "Wind chill" : "Heat index"} />
        <StatCard icon={<Sunset size={12} />} label="UV Index" value={now.uvIndex.toFixed(1)} sub={now.uvIndex < 3 ? "Low" : now.uvIndex < 6 ? "Moderate" : now.uvIndex < 8 ? "High" : "Very High"} />
        <StatCard icon={<Cloud size={12} />} label="Cloud Cover" value={`${now.cloudCover.toFixed(0)}%`} />
        <StatCard icon={<Droplets size={12} />} label="Precip. Prob." value={`${now.precipProbability.toFixed(0)}%`} sub={`${now.precipitation.toFixed(1)} mm`} />
        <WindCompass dir={now.windDirection} speed={now.windSpeed} />
        <PressureGauge pressure={now.pressure} />
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
          <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">24h — Temperature & Precipitation</p>
          <div className="flex items-end gap-0.5 overflow-x-auto pb-1">
            {chartHours.map((hour) => {
              const tempPct = tempRange > 0 ? ((hour.temp - today.minTemp) / tempRange) * 70 + 15 : 50;
              const rainPct = (hour.precipProbability / maxPrecipProb) * 100;
              return (
                <div key={hour.time} className="flex flex-col items-center gap-0.5" style={{ minWidth: 26 }}>
                  <span className="text-[9px] text-[color:var(--text-primary)]">{hour.temp.toFixed(0)}°</span>
                  <div className="relative flex h-16 items-end gap-0.5">
                    <div className="w-2 rounded-t-sm" style={{ height: `${tempPct}%`, background: "rgba(251,191,36,0.65)" }} />
                    {rainPct > 5 ? <div className="w-1.5 rounded-t-sm" style={{ height: `${rainPct}%`, background: "rgba(56,189,248,0.6)" }} /> : null}
                  </div>
                  <span className="text-[8px] text-[color:var(--text-tertiary)]">{String(hour.hour).padStart(2, "0")}h</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">Hourly</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {today.hours.map((hour) => (
            <div key={hour.time} className="flex min-w-[56px] flex-col items-center gap-1 rounded-xl p-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
              <span className="text-[9px] text-[color:var(--text-secondary)]">{String(hour.hour).padStart(2, "0")}:00</span>
              <span className="text-base">{wmoEmoji(hour.weatherCode)}</span>
              <span className="text-[11px] font-semibold text-[color:var(--text-primary)]">{hour.temp.toFixed(0)}°</span>
              <span className="text-[9px] text-[color:var(--text-secondary)]"><Wind size={8} className="inline" /> {hour.windSpeed.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SurfTab({
  query,
  onQueryChange,
  searchBusy,
  results,
  featuredSpots,
  selectedSpot,
  onSelectSpot,
  forecastDays,
  loading,
  error,
  location,
  now,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchBusy: boolean;
  results: SurfSpot[];
  featuredSpots: SurfSpot[];
  selectedSpot: SurfSpot | null;
  onSelectSpot: (spot: SurfSpot) => void;
  forecastDays: DaySummary[];
  loading: boolean;
  error: string | null;
  location: Location;
  now: HourlyWeather | undefined;
}) {
  const today = forecastDays[0];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-72 flex-col overflow-hidden" style={{ borderRight: "1px solid var(--os-border-faint)" }}>
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-soft)" }}>
            <Search size={12} className="text-[color:var(--text-secondary)]" />
            <input
              type="text"
              placeholder="Search any surf spot, beach, or coastal city worldwide…"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="w-full bg-transparent text-xs text-[color:var(--text-primary)] placeholder-[color:var(--text-secondary)] outline-none"
            />
            {searchBusy ? <RefreshCw size={12} className="animate-spin text-[color:var(--text-secondary)]" /> : null}
          </div>
          <p className="mt-2 text-[10px] text-[color:var(--text-secondary)]">Surf uses marine forecast where available. Curated spots stay available, but you can now search worldwide.</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {query.trim() ? (
            results.length > 0 ? (
              results.map((spot) => (
                <button
                  key={`${spot.name}:${spot.lat}:${spot.lon}`}
                  type="button"
                  onClick={() => onSelectSpot(spot)}
                  className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-[color:var(--bg-surface-hover)]"
                  style={{ background: selectedSpot?.name === spot.name && selectedSpot.lat === spot.lat ? "var(--bg-elevated)" : undefined }}
                >
                  <span className="text-xs font-medium text-[color:var(--text-primary)]">{spot.name}</span>
                  <span className="text-[10px] text-[color:var(--text-secondary)]">{[spot.region, spot.country, spot.breakType].filter(Boolean).join(" · ")}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-xs text-[color:var(--text-secondary)]">{searchBusy ? "Searching surf spots…" : "No worldwide surf matches found for this query yet."}</p>
            )
          ) : (
            <>
              <p className="px-3 pb-1 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">Featured surf spots</p>
              {featuredSpots.map((spot) => (
                <button
                  key={`${spot.name}:${spot.lat}:${spot.lon}`}
                  type="button"
                  onClick={() => onSelectSpot(spot)}
                  className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-[color:var(--bg-surface-hover)]"
                  style={{ background: selectedSpot?.name === spot.name && selectedSpot.lat === spot.lat ? "var(--bg-elevated)" : undefined }}
                >
                  <span className="text-xs font-medium text-[color:var(--text-primary)]">{spot.name}</span>
                  <span className="text-[10px] text-[color:var(--text-secondary)]">{[spot.region, spot.country, spot.breakType].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[color:var(--text-secondary)]">
            <RefreshCw size={13} className="animate-spin" />
            <span>Loading surf data…</span>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[color:var(--text-secondary)]">{error}</div>
        ) : !today || !now ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[color:var(--text-secondary)]">Search and select any surf spot or coastal city to see the forecast.</div>
        ) : (
          <>
            <div className="px-4 pb-2 pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-[color:var(--text-primary)]">{formatPlace(location)}</h2>
                  <p className="text-[11px] text-[color:var(--text-secondary)]">{selectedSpot ? `${selectedSpot.breakType ?? "coastal"} · ${selectedSpot.source === "curated" ? "curated spot" : "global geocoding result"}` : "Using current weather location"}</p>
                </div>
                <SurfRatingBadge rating={today.surfRating} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
              <StatCard icon={<Waves size={12} />} label="Wave Height" value={`${now.waveHeight.toFixed(1)}m`} sub={`${now.wavePeriod.toFixed(0)}s · ${degToCompass(now.waveDirection)}`} />
              <StatCard icon={<ArrowUp size={12} />} label="Swell" value={`${now.swellHeight.toFixed(1)}m`} sub={`${now.swellPeriod.toFixed(0)}s @ ${degToCompass(now.swellDirection)}`} />
              <StatCard icon={<Wind size={12} />} label="Wind" value={`${now.windSpeed.toFixed(0)} km/h`} sub={`${degToCompass(now.windDirection)} · gust ${now.windGust.toFixed(0)}`} />
              <StatCard icon={<Thermometer size={12} />} label="Water Adjacent Temp" value={`${now.temp.toFixed(0)}°C`} sub={wmoLabel(now.weatherCode)} />
            </div>

            <div className="px-4 pb-3">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">7-Day Surf Forecast</p>
              <div className="flex flex-col gap-1.5">
                {forecastDays.map((day, index) => {
                  const peak = day.hours.find((hour) => hour.hour >= 7 && hour.hour <= 17) ?? day.hours[12];
                  const rating = peak ? rateSurf(peak) : "flat";
                  return (
                    <div key={day.date} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
                      <span className="w-24 text-xs text-[color:var(--text-primary)]">{formatDayLabel(day.date, index)}</span>
                      <div className="flex items-center gap-1.5 text-right">
                        <span className="text-[11px] font-semibold text-[color:var(--text-primary)]">{day.maxWave.toFixed(1)}m</span>
                        {peak ? <span className="text-[10px] text-[color:var(--text-secondary)]">{peak.wavePeriod.toFixed(0)}s · {degToCompass(peak.windDirection)} {peak.windSpeed.toFixed(0)}km/h</span> : null}
                      </div>
                      <SurfRatingBadge rating={rating} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-4 pb-4">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">Today — Hourly Surf Window</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {today.hours.filter((hour) => hour.hour >= 6 && hour.hour <= 20).map((hour) => {
                  const rating = rateSurf(hour);
                  return (
                    <div key={hour.time} className="flex min-w-[64px] flex-col items-center gap-1 rounded-xl p-2" style={{ background: "var(--bg-surface)", border: `1px solid ${ratingColor(rating)}40` }}>
                      <span className="text-[9px] text-[color:var(--text-secondary)]">{String(hour.hour).padStart(2, "0")}:00</span>
                      <span className="text-[11px] font-bold text-[color:var(--text-primary)]">{hour.waveHeight > 0 ? `${hour.waveHeight.toFixed(1)}m` : "—"}</span>
                      <span className="rounded border px-1 py-0.5 text-[9px] font-semibold" style={ratingBadgeStyle(rating)}>{ratingLabel(rating)}</span>
                      <span className="text-[8px] text-[color:var(--text-tertiary)]"><Wind size={7} className="inline" /> {hour.windSpeed.toFixed(0)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
