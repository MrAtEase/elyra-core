"use client";

import { useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export default function MVP_Dashboard() {
  const [mode, setMode] = useState<"personal" | "business">("personal");

  // Dynamic Theme Styling
  const theme = {
    personal: {
      bg: "bg-indigo-950",
      accent: "text-purple-400",
      orbGlow: "shadow-[0_0_150px_40px_rgba(168,85,247,0.5)]",
      orbColor: "bg-purple-600",
      title: "Personal Life",
      subtitle: "Chaos sorted. Family synced.",
      agents: [
        { name: "Family Calendar", status: "Active", task: "Syncing kids' dentist appointments" },
        { name: "Email Inbox", status: "Sleeping", task: "Sorted 14 bills and newsletters" }
      ]
    },
    business: {
      bg: "bg-slate-900",
      accent: "text-emerald-400",
      orbGlow: "shadow-[0_0_150px_40px_rgba(16,185,129,0.5)]",
      orbColor: "bg-emerald-500",
      title: "Company Backend (Meier Electric)",
      subtitle: "Full-automated SME operations.",
      agents: [
        { name: "Client Support AI", status: "Active", task: "Drafted 3 repair estimates" },
        { name: "Invoicing", status: "Processing", task: "Sending invoice to Fish-Delish" }
      ]
    }
  };

  const current = theme[mode];

  return (
    <div className={`min-h-screen ${current.bg} text-white transition-colors duration-700 ${inter.className} flex flex-col items-center justify-center p-6 relative overflow-hidden`}>
      
      {/* Top Switcher */}
      <div className="absolute top-10 flex gap-4 bg-black/40 p-2 rounded-full backdrop-blur-md border border-white/10 z-50">
        <button 
          onClick={() => setMode("personal")}
          className={`px-6 py-2 rounded-full transition-all ${mode === "personal" ? "bg-purple-600 text-white font-bold" : "text-gray-400 hover:text-white"}`}
        >
          Personal
        </button>
        <button 
          onClick={() => setMode("business")}
          className={`px-6 py-2 rounded-full transition-all ${mode === "business" ? "bg-emerald-600 text-white font-bold" : "text-gray-400 hover:text-white"}`}
        >
          Business
        </button>
      </div>

      {/* The AI ORB */}
      <div className="relative mb-16 mt-20">
        <div className={`w-48 h-48 rounded-full ${current.orbColor} ${current.orbGlow} animate-pulse transition-all duration-1000 flex items-center justify-center`}>
          <div className="w-32 h-32 rounded-full bg-black/20 animate-spin-slow"></div>
        </div>
      </div>

      {/* Main Content */}
      <div className="text-center z-10 max-w-2xl w-full">
        <h1 className={`text-5xl font-extrabold mb-4 tracking-tight transition-colors duration-500`}>
          {current.title}
        </h1>
        <p className="text-xl text-gray-300 mb-12">
          {current.subtitle}
        </p>

        {/* Active Agents Widget */}
        <div className="grid gap-4 md:grid-cols-2">
          {current.agents.map((agent, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-sm text-left hover:bg-white/10 transition-colors cursor-default">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-lg">{agent.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${agent.status === 'Active' ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>
                  {agent.status}
                </span>
              </div>
              <p className="text-sm text-gray-400">{agent.task}</p>
            </div>
          ))}
        </div>
      </div>
      
      {/* Bottom Action / Pitch */}
      <div className="absolute bottom-10 z-50">
         <button className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:scale-105 transition-transform shadow-lg">
           Marketplace: Add Workflows
         </button>
      </div>

    </div>
  );
}
