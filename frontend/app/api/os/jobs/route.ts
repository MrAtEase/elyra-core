import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/os/jobs?q=marketing&where=Berlin&remote=1&days=14
 *
 * Live job search across public job sources (read-only, no account needed):
 * - Bundesagentur für Arbeit Jobbörse (Germany, incl. home office filter)
 * - Arbeitnow (Europe / remote, jobs straight from applicant tracking systems)
 * - Remotive (remote jobs worldwide)
 * Results are cached per query for 30 minutes to stay polite to the sources.
 */

export type JobPosting = {
  id: string;
  source: "Arbeitsagentur" | "Arbeitnow" | "Remotive";
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  postedAt: string | null;
  salary: string | null;
  tags: string[];
  snippet: string | null;
};

type SourceStatus = { source: JobPosting["source"]; ok: boolean; count: number; error?: string };

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; payload: { jobs: JobPosting[]; sources: SourceStatus[] } }>();
const UA = "Elyra-Core/1.0 (job search; contact via github.com/MrAtEase)";

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 9000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": UA, ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const stripHtml = (html: string | null | undefined, max = 220): string | null => {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text ? (text.length > max ? `${text.slice(0, max).trimEnd()} …` : text) : null;
};

const matches = (q: string, ...fields: Array<string | null | undefined>) => {
  if (!q) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
};

async function searchArbeitsagentur(q: string, where: string, remote: boolean, days: number): Promise<JobPosting[]> {
  const params = new URLSearchParams({ angebotsart: "1", page: "1", size: remote ? "100" : "50", veroeffentlichtseit: String(days), pav: "false" });
  if (q) params.set("was", q);
  if (where) {
    params.set("wo", where);
    params.set("umkreis", "50");
  }
  // The v6 API returns nothing for arbeitszeit=ho; filter on the home office flag of each posting instead.
  type BaJob = {
    refnr?: string;
    referenznummer?: string;
    titel?: string;
    stellenangebotsTitel?: string;
    beruf?: string;
    arbeitgeber?: string;
    arbeitsort?: { ort?: string; region?: string; land?: string };
    arbeitsorte?: Array<{ ort?: string; region?: string; land?: string }>;
    aktuelleVeroeffentlichungsdatum?: string;
    externeUrl?: string;
    // v6 field names
    firma?: string;
    hauptberuf?: string;
    stellenlokationen?: Array<{ adresse?: { ort?: string; region?: string; land?: string } }>;
    homeofficemoeglich?: boolean;
    datumErsteVeroeffentlichung?: string;
  };
  type Response = { stellenangebote?: BaJob[]; ergebnisse?: BaJob[]; ergebnisliste?: BaJob[] };
  // The public API has moved between versions; try the current one first.
  const base = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
  const attempts = [`${base}/pc/v6/jobs`, `${base}/pc/v4/app/jobs`, `${base}/pc/v4/jobs`];
  let data: Response | null = null;
  const failures: string[] = [];
  for (const url of attempts) {
    try {
      data = await fetchJson<Response>(`${url}?${params.toString()}`, {
        headers: { "X-API-Key": "jobboerse-jobsuche", "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4" },
      });
      break;
    } catch (error) {
      failures.push(`${url.split("/pc/")[1]}: ${error instanceof Error ? error.message : "?"}`);
    }
  }
  if (!data) throw new Error(failures.join(" | "));
  const STATES: Record<string, string> = {
    BADEN_WUERTTEMBERG: "Baden-Württemberg", BAYERN: "Bayern", BERLIN: "Berlin", BRANDENBURG: "Brandenburg", BREMEN: "Bremen",
    HAMBURG: "Hamburg", HESSEN: "Hessen", MECKLENBURG_VORPOMMERN: "Mecklenburg-Vorpommern", NIEDERSACHSEN: "Niedersachsen",
    NORDRHEIN_WESTFALEN: "Nordrhein-Westfalen", RHEINLAND_PFALZ: "Rheinland-Pfalz", SAARLAND: "Saarland", SACHSEN: "Sachsen",
    SACHSEN_ANHALT: "Sachsen-Anhalt", SCHLESWIG_HOLSTEIN: "Schleswig-Holstein", THUERINGEN: "Thüringen",
  };
  const titleCase = (v?: string) =>
    v ? STATES[v.toUpperCase()] ?? v.toLowerCase().replace(/_/g, "-").replace(/(^|[\s-])\S/g, (m) => m.toUpperCase()) : v;
  return (data.ergebnisliste ?? data.stellenangebote ?? data.ergebnisse ?? [])
    .map((j) => {
      const place = j.stellenlokationen?.[0]?.adresse ?? j.arbeitsort ?? j.arbeitsorte?.[0];
      return {
        ...j,
        ref: j.referenznummer ?? j.refnr,
        title: j.stellenangebotsTitel ?? j.titel,
        company: j.firma ?? j.arbeitgeber,
        job: j.hauptberuf ?? j.beruf,
        place,
        posted: j.datumErsteVeroeffentlichung ?? j.aktuelleVeroeffentlichungsdatum,
        homeOffice: j.homeofficemoeglich ?? remote,
      };
    })
    .filter((j) => j.ref && j.title)
    .filter((j) => (remote ? j.homeOffice : true))
    .map((j) => ({
      id: `ba-${j.ref}`,
      source: "Arbeitsagentur" as const,
      title: j.title!,
      company: j.company ?? "–",
      location: [j.place?.ort, titleCase(j.place?.region)].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || "Deutschland",
      remote: Boolean(j.homeOffice),
      url: j.externeUrl || `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(j.ref!)}`,
      postedAt: j.posted ?? null,
      salary: null,
      tags: [j.job, j.homeOffice ? "Homeoffice möglich" : null].filter((t): t is string => Boolean(t)),
      snippet: null,
    }));
}

async function searchArbeitnow(q: string, where: string, remote: boolean): Promise<JobPosting[]> {
  type Response = {
    data?: Array<{
      slug?: string;
      company_name?: string;
      title?: string;
      description?: string;
      remote?: boolean;
      url?: string;
      tags?: string[];
      location?: string;
      created_at?: number;
    }>;
  };
  const pages = await Promise.all(
    [1, 2, 3].map((page) => fetchJson<Response>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`).catch(() => ({ data: [] }))),
  );
  return pages
    .flatMap((p) => p.data ?? [])
    .filter((j) => j.slug && j.title && j.url)
    .filter((j) => (remote ? j.remote : true))
    .filter((j) => matches(where, j.location, j.remote ? "remote" : ""))
    .filter((j) => matches(q, j.title, j.company_name, (j.tags ?? []).join(" "), stripHtml(j.description, 600)))
    .map((j) => ({
      id: `an-${j.slug}`,
      source: "Arbeitnow" as const,
      title: j.title!,
      company: j.company_name ?? "–",
      location: j.remote ? `Remote${j.location ? ` · ${j.location}` : ""}` : j.location ?? "–",
      remote: Boolean(j.remote),
      url: j.url!,
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
      salary: null,
      tags: (j.tags ?? []).slice(0, 4),
      snippet: stripHtml(j.description),
    }));
}

async function searchRemotive(q: string, where: string): Promise<JobPosting[]> {
  type Response = {
    jobs?: Array<{
      id?: number;
      url?: string;
      title?: string;
      company_name?: string;
      tags?: string[];
      publication_date?: string;
      candidate_required_location?: string;
      salary?: string;
      description?: string;
      category?: string;
    }>;
  };
  const params = new URLSearchParams({ limit: "100" });
  if (q) params.set("search", q);
  const data = await fetchJson<Response>(`https://remotive.com/api/remote-jobs?${params.toString()}`);
  return (data.jobs ?? [])
    .filter((j) => j.id && j.title && j.url)
    .filter((j) => matches(where, j.candidate_required_location, "remote worldwide anywhere"))
    // Remotive's own search is fuzzy: keep jobs where at least one search word is in the title
    // and all words appear somewhere in the posting.
    .filter((j) => !q || q.toLowerCase().split(/\s+/).filter(Boolean).some((w) => (j.title ?? "").toLowerCase().includes(w)))
    .filter((j) => matches(q, j.title, (j.tags ?? []).join(" "), j.category, stripHtml(j.description, 4000)))
    .map((j) => ({
      id: `rm-${j.id}`,
      source: "Remotive" as const,
      title: j.title!,
      company: j.company_name ?? "–",
      location: `Remote · ${j.candidate_required_location || "weltweit"}`,
      remote: true,
      url: j.url!,
      postedAt: j.publication_date ?? null,
      salary: j.salary?.trim() || null,
      tags: (j.tags ?? []).slice(0, 4),
      snippet: stripHtml(j.description),
    }));
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const where = (params.get("where") ?? "").trim().slice(0, 60);
  const remote = params.get("remote") === "1";
  const days = Math.min(60, Math.max(1, Number(params.get("days")) || 14));
  const key = JSON.stringify([q.toLowerCase(), where.toLowerCase(), remote, days]);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...cached.payload });
  }

  const tasks: Array<[JobPosting["source"], Promise<JobPosting[]>]> = [
    ["Arbeitsagentur", searchArbeitsagentur(q, where, remote, days)],
    ["Arbeitnow", searchArbeitnow(q, where, remote)],
    ["Remotive", searchRemotive(q, where)],
  ];
  const settled = await Promise.allSettled(tasks.map(([, task]) => task));
  const sources: SourceStatus[] = [];
  const jobs: JobPosting[] = [];
  settled.forEach((result, index) => {
    const source = tasks[index]![0];
    if (result.status === "fulfilled") {
      sources.push({ source, ok: true, count: result.value.length });
      jobs.push(...result.value);
    } else {
      sources.push({ source, ok: false, count: 0, error: result.reason instanceof Error ? result.reason.message.slice(0, 120) : "Fehler" });
    }
  });

  const seen = new Set<string>();
  const unique = jobs.filter((job) => {
    const k = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0));

  const payload = { jobs: unique.slice(0, 120), sources };
  cache.set(key, { at: Date.now(), payload });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
