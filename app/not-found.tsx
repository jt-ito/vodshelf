import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#0e0e10] text-[#efeff1] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#9146ff]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-2/3 left-1/3 w-64 h-64 bg-[#772ce8]/10 rounded-full blur-2xl pointer-events-none" />

      <div className="relative z-10 max-w-md w-full text-center flex flex-col items-center">
        {/* Stylized Offline / 404 Signal Badge */}
        <div className="w-24 h-24 rounded-2xl bg-[#1f1f23] border border-[#2f2f35] flex items-center justify-center mb-6 shadow-xl shadow-black/50 relative group">
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#0e0e10] animate-pulse" />
          <svg className="w-12 h-12 text-[#9146ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-2.829-2.829m0 0L3 21m2.829-8.464a5 5 0 010-7.072m0 0l2.829 2.829M12 12h.01" />
          </svg>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#9146ff]/10 border border-[#9146ff]/30 text-[#bf94ff] text-xs font-semibold mb-3 tracking-wider uppercase">
          Signal Lost • Error 404
        </div>

        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-3">
          Broadcast Not Found
        </h1>

        <p className="text-sm text-[#adadb8] mb-8 leading-relaxed max-w-sm">
          The requested page, past stream recording, or channel could not be found or has expired from the edge cache.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[#9146ff] hover:bg-[#772ce8] text-white font-medium text-sm transition-all duration-150 shadow-lg shadow-[#9146ff]/20 active:scale-98"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Return to Discover
          </Link>
        </div>

        <div className="mt-12 text-xs text-[#53535f] border-t border-[#1f1f23] pt-6 w-full flex items-center justify-center gap-4">
          <span>Twitch VOD Archive</span>
          <span>•</span>
          <span>Secure Edge Gateway</span>
        </div>
      </div>
    </main>
  );
}
