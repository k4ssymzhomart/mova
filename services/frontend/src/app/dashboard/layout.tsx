"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Clock, 
  Activity, 
  Play, 
  TrendingUp, 
  LogOut, 
  ChevronRight, 
  Bell, 
  Search, 
  Settings 
} from "lucide-react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const navLinks = [
    { name: "Today", href: "/dashboard", icon: Clock },
    { name: "My Program", href: "/dashboard", icon: Activity }, // Fallback in mock to same base dashboard
    { name: "Train", href: "/dashboard", icon: Play },
    { name: "Progress", href: "/dashboard", icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row p-4 md:p-6 gap-6">
      {/* Sidebar Panel */}
      <aside className="w-full md:w-64 bg-white/90 backdrop-blur-md rounded-3xl p-6 flex flex-col justify-between shadow-sm border border-gray-200/50 md:h-[calc(100vh-48px)] md:sticky md:top-6">
        <div className="space-y-8">
          {/* Logo */}
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-bold tracking-tight text-black flex items-center gap-2">
              <span className="h-6 w-6 bg-black rounded-full flex items-center justify-center text-white text-xs font-serif font-semibold italic">M</span>
              MOVA
            </Link>
            <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-mono text-gray-500 uppercase">
              Sandbox
            </span>
          </div>

          {/* User profile capsule */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="h-10 w-10 bg-black text-white rounded-full flex items-center justify-center font-medium font-serif italic text-sm">
              SC
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900 truncate">Dr. Sarah Chen</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Clinician</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-3 mb-2">
              Core Surfaces
            </div>
            {navLinks.map((link) => {
              const IconComponent = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? "bg-black text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-100 hover:text-black"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <IconComponent className="h-4 w-4" />
                    <span>{link.name}</span>
                  </div>
                  {isActive && <ChevronRight className="h-4 w-4 opacity-60" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-4 pt-6 border-t border-gray-100 mt-6 md:mt-0">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-black hover:bg-gray-50 transition-all"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>
          
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area Container */}
      <main className="flex-1 bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 flex flex-col justify-between overflow-y-auto md:h-[calc(100vh-48px)]">
        <div className="space-y-6">
          {/* Top telemetry bar inside main area */}
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Clinician Console
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Rehabilitation & Gait telemetry monitoring hub.
              </p>
            </div>
            
            {/* Header Actions */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search patient record..."
                  className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-all w-48"
                />
              </div>
              
              <button className="p-2 text-gray-500 hover:text-black hover:bg-gray-50 rounded-xl border border-gray-200 transition-all relative">
                <Bell className="h-4 w-4" />
                <span className="absolute top-1 right-1 h-2 w-2 bg-black rounded-full" />
              </button>
            </div>
          </header>

          <div className="py-2">
            {children}
          </div>
        </div>

        {/* Disclaimer footer inside main area */}
        <footer className="mt-8 pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-gray-400">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>Local telemetry server active · Model v0.1.0 (mocked)</span>
          </div>
          <span>Decision support, not clinical diagnosis.</span>
        </footer>
      </main>
    </div>
  );
}
