"use client";

import React, { useState, useEffect } from "react";
import { X, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: { id: string; username: string; dateFormat?: string; [key: string]: any }) => void;
  /** Optional banner explaining why the modal opened (e.g. an expired session) */
  notice?: string | null;
  /** Prefills the username field when the modal opens */
  initialUsername?: string;
}

export default function AuthModal({ isOpen, onClose, onSuccess, notice, initialUsername }: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialUsername) setUsername(initialUsername);
  }, [isOpen, initialUsername]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUser = username.trim();

    // Client-side script and format checks
    if (/[<>]|javascript:|data:text\/html|<script|on\w+=/i.test(cleanUser)) {
      setError("Username contains disallowed script or HTML characters.");
      return;
    }

    if (cleanUser.length < 3) {
      setError("Username must be at least 3 characters long.");
      return;
    }

    if (cleanUser.length > 25) {
      setError("Username cannot exceed 25 characters.");
      return;
    }

    if (/^[0-9]/.test(cleanUser)) {
      setError("Username cannot start with a number.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanUser)) {
      setError("Username must contain only letters, numbers, or underscores.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (/[<>]/.test(password)) {
      setError("Password cannot contain '<' or '>' characters to prevent script injection.");
      return;
    }

    if (/javascript:|vbscript:|data:text\/html/i.test(password)) {
      setError("Password cannot contain script execution prefixes.");
      return;
    }

    setIsLoading(true);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUser, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication request failed");
      }

      onSuccess(data.user);
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="relative w-full max-w-sm bg-[#18181b] rounded-lg border border-[#2d2d34] shadow-2xl overflow-hidden p-6 animate-scale-in">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-[#767682] hover:text-[#efeff1] rounded hover:bg-[#26262c] transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand Icon */}
        <div className="w-9 h-9 rounded-md bg-[#9146ff] flex items-center justify-center text-white mb-3">
          <User className="w-4 h-4" />
        </div>

        {/* Header */}
        <h2 className="text-base font-bold text-[#efeff1] tracking-tight">
          {mode === "login" ? "Sign In" : "Create Account"}
        </h2>
        <p className="text-xs text-[#767682] mt-0.5 mb-4">
          Pin Twitch channels and sync watch progress across devices.
        </p>

        {notice && (
          <div
            role="status"
            className="mb-4 px-3 py-2 rounded-md bg-amber-400/10 border border-amber-400/30 text-xs text-amber-200"
          >
            {notice}
          </div>
        )}

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#0e0e10] rounded-md border border-[#2d2d34] mb-4">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`py-1.5 text-xs font-semibold rounded transition-colors ${
              mode === "login"
                ? "bg-[#26262c] text-[#efeff1]"
                : "text-[#767682] hover:text-[#efeff1]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`py-1.5 text-xs font-semibold rounded transition-colors ${
              mode === "register"
                ? "bg-[#26262c] text-[#efeff1]"
                : "text-[#767682] hover:text-[#efeff1]"
            }`}
          >
            Register
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-2.5 mb-4 rounded bg-[#eb0400]/10 border border-[#eb0400]/30 text-[#ff8080] text-xs">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[#adadb8] mb-1">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-[#767682] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={25}
                placeholder="Choose username (cannot start with a number)"
                className="w-full pl-9 pr-3 py-2 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#adadb8] mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#767682] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="Password (special characters supported)"
                className="w-full pl-9 pr-9 py-2 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#767682] hover:text-[#efeff1] p-1 cursor-pointer"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-[#767682] mt-1">
              Special characters (!@#$%^&* etc.) are supported. &lt; and &gt; are blocked for script safety.
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full py-2 px-4 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-50 text-white font-semibold text-xs rounded-md flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer"
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{mode === "login" ? "Sign In" : "Create Account"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
