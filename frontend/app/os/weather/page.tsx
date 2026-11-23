import { Suspense } from "react";
import WeatherWindow from "@/components/os/apps/weather/WeatherWindow";

export default function OsWeatherPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Weather…</div>}>
      <WeatherWindow />
    </Suspense>
  );
}
