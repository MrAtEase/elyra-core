"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, MapPin, Search, Waves, Wind, MoveUp } from "lucide-react";
import {
  ALL_SPOTS,
  RATING_LABEL,
  SURF_AREAS,
  SURF_REGIONS,
  compass,
  fetchForecastForSpot,
  fetchSpotForecasts,
  ratingRank,
  spotFromSearch,
  type SpotForecast,
  type SurfHour,
  type SurfRating,
  type SurfRegion,
  type SurfSpotDef,
} from "@/lib/surf/forecast";

const VIEW_KEY = "elyra.surf.view.v2";
const SEARCH = "Suche";
type View = { area: string; region: SurfRegion };

const RATING_STYLE: Record<SurfRating, { color: string; bg: string; border: string }> = {
  epic: { color: "#c4b5fd", bg: "rgba(139,92,246,0.18)", border: "rgba(139,92,246,0.45)" },
  good: { color: "#86efac", bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.45)" },
  fair: { color: "#fcd34d", bg: "rgba(234,179,8,0.15)", border: "rgba(234,179,8,0.45)" },
  poor: { color: "#fca5a5", bg: "rgba(239,68,68,0.13)", border: "rgba(239,68,68,0.4)" },
  flat: { color: "var(--text-tertiary)", bg: "var(--bg-elevated)", border: "var(--os-border-faint)" },
};

function Badge({ rating }: { rating: SurfRating }) {
  const s = RATING_STYLE[rating];
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
      {RATING_LABEL[rating]}
    </span>
  );
}

const m = (v: number) => `${v.toFixed(1).replace(".", ",")} m`;
const hh = (time: string) => time.slice(11, 16);

function dayLabel(date: string, index: number): string {
  if (index === 0) return "Heute";
  if (index === 1) return "Morgen";
  return new Date(`${date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "numeric" });
}

function windText(h: SurfHour): string {
  return `${Math.round(h.windSpeed)} km/h aus ${compass(h.windDirection)} · ${h.windRelation}`;
}

function swellText(h: SurfHour): string {
  return `${m(h.swellHeight)} · ${Math.round(h.swellPeriod)} s aus ${compass(h.swellDirection)}`;
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">{icon}{label}</span>
      <span className="text-sm font-semibold text-[color:var(--text-primary)]">{value}</span>
      {sub ? <span className="text-[11px] leading-snug text-[color:var(--text-secondary)]">{sub}</span> : null}
    </div>
  );
}

type GeoResult = { name: string; latitude: number; longitude: number; country?: string; admin1?: string };

export default function SurfPanel() {
  const [view, setView] = useState<View>({ area: "Portugal", region: "Costa da Caparica" });
  const [dayIndex, setDayIndex] = useState(0);
  const [forecasts, setForecasts] = useState<SpotForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpotForecast | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SurfSpotDef[]>([]);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as View | null;
      if (saved && (saved.area === SEARCH || SURF_AREAS.includes(saved.area)) && (SURF_REGIONS as readonly string[]).includes(saved.region)) setView(saved);
    } catch { /* ignore */ }
    setRestored(true);
  }, []);

  // Load all spots of the selected region at once.
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ }
    setDetail(null);
    if (view.area === SEARCH) { setForecasts([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const spots = view.area === "Portugal"
      ? ALL_SPOTS.filter((s) => s.area === "Portugal" && s.region === view.region)
      : ALL_SPOTS.filter((s) => s.area === view.area);
    fetchSpotForecasts(spots)
      .then((data) => { if (!cancelled) setForecasts(data); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Surfdaten konnten nicht geladen werden"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view.area, view.region, restored]);

  // Worldwide search: curated spots plus geocoding.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    const t = window.setTimeout(async () => {
      const curated = ALL_SPOTS.filter((s) => `${s.name} ${s.region} ${s.country} ${s.area}`.toLowerCase().includes(q));
      let found: SurfSpotDef[] = [];
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`);
        const payload = (await res.json()) as { results?: GeoResult[] };
        found = (payload.results ?? []).map((r) => spotFromSearch({
          name: r.name, lat: r.latitude, lon: r.longitude,
          ...(r.admin1 ? { region: r.admin1 } : {}),
          ...(r.country ? { country: r.country } : {}),
        }));
      } catch { /* geocoding optional */ }
      setResults([...curated, ...found].slice(0, 10));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const openSpot = async (spot: SurfSpotDef) => {
    const cached = forecasts.find((f) => f.spot.id === spot.id);
    if (cached) { setDetail(cached); return; }
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await fetchForecastForSpot(spot));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Surfdaten konnten nicht geladen werden");
    } finally {
      setDetailLoading(false);
    }
  };

  const ranked = useMemo(
    () =>
      [...forecasts].sort((a, b) => {
        const da = a.days[dayIndex], db = b.days[dayIndex];
        if (!da || !db) return 0;
        return ratingRank(da.rating) - ratingRank(db.rating) || (db.best?.score ?? 0) - (da.best?.score ?? 0);
      }),
    [forecasts, dayIndex],
  );
  const dates = forecasts[0]?.days.map((d) => d.date) ?? detail?.days.map((d) => d.date) ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Areas, and for Portugal the regions */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 pb-0.5">
        {[...SURF_AREAS, SEARCH].map((area) => {
          const active = view.area === area;
          return (
            <button
              key={area}
              type="button"
              onClick={() => setView((v) => ({ ...v, area }))}
              className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition"
              style={{
                background: active ? "var(--bg-elevated)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                borderColor: active ? "var(--os-border-soft)" : "var(--os-border-faint)",
              }}
            >
              {area === SEARCH ? <Search size={11} /> : null}
              {area}
            </button>
          );
        })}
      </div>
      {view.area === "Portugal" ? (
        <div className="flex gap-1 overflow-x-auto px-4 pt-1.5">
          {SURF_REGIONS.map((region) => (
            <button
              key={region}
              type="button"
              onClick={() => setView((v) => ({ ...v, region }))}
              className="shrink-0 rounded-md px-2.5 py-1 text-[11px] transition"
              style={{ background: view.region === region ? "var(--bg-elevated)" : "transparent", color: view.region === region ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              {region}
            </button>
          ))}
        </div>
      ) : null}

      {/* Days */}
      {dates.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto px-4 pt-2">
          {dates.map((date, i) => (
            <button
              key={date}
              type="button"
              onClick={() => setDayIndex(i)}
              className="shrink-0 rounded-md px-2.5 py-1 text-[11px] transition"
              style={{ background: dayIndex === i ? "var(--bg-elevated)" : "transparent", color: dayIndex === i ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              {dayLabel(date, i)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error ? <p className="mb-3 rounded-lg border px-3 py-2 text-xs text-rose-300" style={{ borderColor: "rgba(239,68,68,0.4)" }}>{error}</p> : null}

        {detail ? (
          <SpotDetail forecast={detail} dayIndex={Math.min(dayIndex, detail.days.length - 1)} onBack={() => setDetail(null)} />
        ) : view.area === SEARCH ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-soft)" }}>
              <Search size={13} className="text-[color:var(--text-secondary)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jeden Strand oder Küstenort weltweit suchen …"
                className="w-full bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-secondary)]"
              />
              {detailLoading ? <Loader2 size={13} className="animate-spin text-[color:var(--text-secondary)]" /> : null}
            </div>
            {query.trim() === "" ? (
              <p className="text-[11px] leading-snug text-[color:var(--text-secondary)]">
                Für Orte, die nicht in der Liste stehen, ermittelt Elyra die Ausrichtung des Strandes automatisch aus der Küstenlinie.
              </p>
            ) : null}
            {results.map((spot) => (
              <button
                key={spot.id}
                type="button"
                onClick={() => void openSpot(spot)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-[color:var(--bg-surface-hover)]"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}
              >
                <MapPin size={12} className="shrink-0 text-[color:var(--text-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[color:var(--text-primary)]">{spot.name}</span>
                  <span className="block truncate text-[10px] text-[color:var(--text-secondary)]">{[spot.region, spot.country].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[color:var(--text-secondary)]">
            <Loader2 size={14} className="animate-spin" /> Lade Wellen, Wind und Gezeiten …
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">
              Spots {view.area === "Portugal" ? view.region : view.area} · beste zuerst{view.area !== "Portugal" ? " · Ortszeit" : ""}
            </p>
            {ranked.map((f) => {
              const day = f.days[dayIndex];
              const best = day?.best;
              if (!day) return null;
              return (
                <button
                  key={f.spot.id}
                  type="button"
                  onClick={() => setDetail(f)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[color:var(--bg-surface-hover)]"
                  style={{ background: "var(--bg-surface)", border: `1px solid ${RATING_STYLE[day.rating].border}` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">{f.spot.name}</span>
                      <span className="shrink-0 text-[10px] text-[color:var(--text-tertiary)]">
                        {view.area !== "Portugal" ? `${f.spot.region} · ` : ""}{f.spot.breakType} · {f.spot.level}
                      </span>
                    </div>
                    {best ? (
                      <p className="mt-0.5 truncate text-[11px] text-[color:var(--text-secondary)]">
                        {day.bestWindow ?? hh(best.time)} · {windText(best)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{best ? `≈ ${m(best.surfHeight)}` : "—"}</span>
                    <Badge rating={day.rating} />
                  </div>
                </button>
              );
            })}
            {view.area === "Portugal" && forecasts[0]?.days[dayIndex]?.tides.length ? (
              <p className="pt-1 text-[11px] text-[color:var(--text-secondary)]">
                Gezeiten: {forecasts[0].days[dayIndex]!.tides.map((t) => `${t.kind} ${hh(t.time)}`).join(" · ")}
              </p>
            ) : null}
          </div>
        )}

        <p className="mt-4 text-[10px] leading-relaxed text-[color:var(--text-tertiary)]">
          Brandungshöhe ist geschätzt: Swell aus dem Wellenmodell (Open-Meteo, Raster ca. 9 km) × Ausrichtung und Schutz des Spots, dazu Wind relativ zum Strand. Benachbarte Spots
          bekommen denselben Swell – die Unterschiede kommen aus Lage und Wind. Gezeiten aus dem Modell, Abweichungen von einigen Minuten möglich.
        </p>
      </div>
    </div>
  );
}

function SpotDetail({ forecast, dayIndex, onBack }: { forecast: SpotForecast; dayIndex: number; onBack: () => void }) {
  const { spot } = forecast;
  const day = forecast.days[dayIndex];
  const best = day?.best;
  const daylight = day?.hours.filter((h) => h.daylight) ?? [];
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">
        <ArrowLeft size={12} /> Alle Spots
      </button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">{spot.name}</p>
          <p className="text-[11px] text-[color:var(--text-secondary)]">
            {[spot.region, spot.country].filter(Boolean).join(", ")} · {spot.breakType} · {spot.level}
            {spot.facing >= 0 ? ` · Ausrichtung ${compass(spot.facing)}` : ""}
          </p>
          {spot.note ? <p className="mt-1 text-[11px] leading-snug text-[color:var(--text-secondary)]">{spot.note}</p> : null}
        </div>
        {day ? <Badge rating={day.rating} /> : null}
      </div>

      {best && day ? (
        <>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Stat icon={<Waves size={11} />} label="Brandung (geschätzt)" value={`≈ ${m(best.surfHeight)}`} sub={`Beste Zeit: ${day.bestWindow ?? hh(best.time)}`} />
            <Stat
              icon={<Waves size={11} />}
              label="Swell"
              value={swellText(best)}
              {...(best.secondaryHeight >= 0.3 ? { sub: `2. Swell: ${m(best.secondaryHeight)} · ${Math.round(best.secondaryPeriod)} s aus ${compass(best.secondaryDirection)}` } : {})}
            />
            <Stat icon={<Wind size={11} />} label="Wind" value={`${Math.round(best.windSpeed)} km/h aus ${compass(best.windDirection)}`} sub={`${best.windRelation} · Böen ${Math.round(best.windGust)} km/h`} />
            <Stat
              icon={<MoveUp size={11} />}
              label="Gezeiten"
              value={day.tides.length ? day.tides.map((t) => `${t.kind === "Hoch" ? "↑" : "↓"} ${hh(t.time)}`).join("  ") : "—"}
              sub="↑ Hochwasser · ↓ Niedrigwasser"
            />
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">Stündlich (Tageslicht)</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {daylight.map((h) => {
                const s = RATING_STYLE[h.rating];
                return (
                  <div key={h.time} className="flex min-w-[60px] flex-col items-center gap-0.5 rounded-xl p-2" style={{ background: "var(--bg-surface)", border: `1px solid ${s.border}` }}>
                    <span className="text-[10px] text-[color:var(--text-secondary)]">{hh(h.time)}</span>
                    <span className="text-[12px] font-semibold text-[color:var(--text-primary)]">{m(h.surfHeight)}</span>
                    <span className="text-[10px] text-[color:var(--text-secondary)]">{Math.round(h.swellPeriod)} s</span>
                    <span className="text-[10px] text-[color:var(--text-secondary)]" title={h.windRelation}>{Math.round(h.windSpeed)} {compass(h.windDirection)}</span>
                    {h.tide != null ? <span className="text-[9px] text-[color:var(--text-tertiary)]" title="Wasserstand relativ zum Mittel">{`${h.tide >= 0 ? "+" : "−"}${Math.abs(h.tide).toFixed(1).replace(".", ",")} m`}</span> : null}
                    <span className="text-[9px] font-semibold" style={{ color: s.color }}>{RATING_LABEL[h.rating]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[color:var(--text-secondary)]">7 Tage</p>
        <div className="space-y-1">
          {forecast.days.map((d, i) => (
            <div key={d.date} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: i === dayIndex ? "var(--bg-elevated)" : "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
              <span className="w-16 shrink-0 text-[11px] text-[color:var(--text-secondary)]">{dayLabel(d.date, i)}</span>
              <span className="w-16 shrink-0 text-[11px] font-semibold text-[color:var(--text-primary)]">{d.best ? `≈ ${m(d.best.surfHeight)}` : "—"}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[color:var(--text-secondary)]">{d.best ? `${d.bestWindow ?? hh(d.best.time)} · ${windText(d.best)}` : ""}</span>
              <Badge rating={d.rating} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
