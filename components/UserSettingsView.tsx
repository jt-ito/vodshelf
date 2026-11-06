"use client";

import React, { useState, useEffect } from "react";
import {
  User,
  Lock,
  Calendar,
  Clock,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  KeyRound,
  Eye,
  EyeOff,
  Bookmark,
  Tv,
  LogOut,
  ExternalLink,
  Play,
  CheckSquare,
  BarChart2,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { useToast } from "./Toast";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useDateFormat, setStoredDateFormat, DateFormatPreference } from "@/lib/date";
import { useWatchSettings, setStoredWatchSettings, WatchSettings } from "@/lib/watch-settings";

interface UserProfileData {
  id: string;
  username: string;
  createdAt: string;
  usernameChangedAt: string | null;
  canChangeUsername: boolean;
  daysRemaining: number;
  nextAvailableDate: string | null;
  cooldownDays: number;
  dateFormat?: string;
  markWatchedOnOpenLink?: boolean;
  markWatchedOnPlay?: boolean;
  markAllWatchedScope?: "loaded" | "all";
  stats: {
    pinnedCount: number;
    watchedCount: number;
  };
}

interface UserSettingsViewProps {
  currentUser: { id: string; username: string };
  onUsernameUpdated: (newUsername: string) => void;
  onBack: () => void;
  onLogout: () => void;
}

export default function UserSettingsView({
  currentUser,
  onUsernameUpdated,
  onBack,
  onLogout,
}: UserSettingsViewProps) {
  const { showToast } = useToast();
  const activeDateFormat = useDateFormat();
  const watchSettings = useWatchSettings();
  const {
    profile,
    isLoading,
    statsData,
    isLoadingStats,
    refresh,
    isSavingDateFormat,
    isSavingWatchSettings,
    updateDateFormat: handleUpdateDateFormat,
    updateWatchSettings: handleUpdateWatchSettings,
  } = useUserSettings<UserProfileData>();

  // Username form state
  const [newUsername, setNewUsername] = useState("");
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Watch Stats state

  // Backup & Restore state
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Danger Zone / Account Deletion state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Export User Backup
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/user/export");
      if (!res.ok) {
        showToast("Failed to export backup data", "error");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `twitch_archive_backup_${currentUser.username}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Archive backup downloaded successfully!");
    } catch {
      showToast("Error downloading backup", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Import User Backup
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/user/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Backup restored! (${data.stats?.watchCount || 0} VODs, ${data.stats?.pinnedCount || 0} creators)`);
        refresh();
      } else {
        showToast(data.error || "Failed to restore backup", "error");
      }
    } catch {
      showToast("Invalid JSON backup file", "error");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  // Delete Account
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError("Password is required to delete your account.");
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast("Account deleted successfully. Goodbye!");
        setIsDeleteModalOpen(false);
        onLogout();
      } else {
        setDeleteError(data.error || "Failed to delete account");
      }
    } catch {
      setDeleteError("Network error while deleting account");
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle Username Update
  const handleUpdateUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(null);

    const clean = newUsername.trim();
    const lower = clean.toLowerCase();

    if (lower === currentUser.username.toLowerCase()) {
      setUsernameError("New username must be different from your current username.");
      return;
    }

    if (/[<>]|javascript:|data:text\/html|<script|on\w+=/i.test(clean)) {
      setUsernameError("Username contains illegal script or HTML characters.");
      return;
    }

    if (clean.length < 3) {
      setUsernameError("Username must be at least 3 characters long.");
      return;
    }

    if (clean.length > 25) {
      setUsernameError("Username cannot exceed 25 characters.");
      return;
    }

    if (/^[0-9]/.test(clean)) {
      setUsernameError("Username cannot start with a number.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
      setUsernameError("Username can only contain letters, numbers, and underscores.");
      return;
    }

    setIsUpdatingUsername(true);

    try {
      const res = await fetch("/api/user/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newUsername: clean }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update username");
      }

      setUsernameSuccess(`Username successfully updated to ${data.user.username}!`);
      showToast(`Username changed to ${data.user.username}`);
      setNewUsername("");
      onUsernameUpdated(data.user.username);
      refresh();
    } catch (err: any) {
      setUsernameError(err.message || "Failed to update username");
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  // Handle Password Update
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError("Please enter your current password.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters long.");
      return;
    }

    if (newPassword.length > 128) {
      setPasswordError("New password cannot exceed 128 characters.");
      return;
    }

    if (/[<>]/.test(newPassword)) {
      setPasswordError("Password cannot contain '<' or '>' characters to prevent script execution.");
      return;
    }

    if (/javascript:|vbscript:|data:text\/html/i.test(newPassword)) {
      setPasswordError("Password cannot contain script execution prefixes.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError("New password must be different from your current password.");
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const res = await fetch("/api/user/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update password");
      }

      const successMsg = data.message || "Password updated successfully. Other active sessions have been signed out.";
      setPasswordSuccess(successMsg);
      showToast(successMsg);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordError(err.message || "Failed to update password");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in-up">
      {/* Top Header / Back Button */}
      <div className="flex items-center justify-between pb-4 border-b border-[#2d2d34]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-semibold text-[#adadb8] hover:text-[#efeff1] transition-colors p-1.5 rounded hover:bg-[#18181b] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Browse</span>
        </button>

        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#adadb8] hover:text-[#ff8080] hover:bg-[#26262c] rounded transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* User Identity Profile Banner */}
      <div className="p-6 rounded-lg bg-[#18181b] border border-[#2d2d34] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#9146ff] flex items-center justify-center text-xl font-bold text-white shadow-lg flex-shrink-0">
            {currentUser.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-[#efeff1] tracking-tight">
                {currentUser.username}
              </h1>
            </div>
            <p className="text-xs text-[#767682] mt-0.5 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                Joined {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Recently"}
              </span>
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="px-3.5 py-2 rounded-md bg-[#0e0e10] border border-[#2d2d34] flex-1 sm:flex-initial text-center sm:text-left">
            <div className="text-[11px] text-[#767682] flex items-center gap-1.5 justify-center sm:justify-start">
              <Bookmark className="w-3 h-3 text-[#9146ff]" />
              <span>Pinned</span>
            </div>
            <div className="text-sm font-bold text-[#efeff1] tabular-nums mt-0.5">
              {profile?.stats?.pinnedCount ?? 0}
            </div>
          </div>
          <div className="px-3.5 py-2 rounded-md bg-[#0e0e10] border border-[#2d2d34] flex-1 sm:flex-initial text-center sm:text-left">
            <div className="text-[11px] text-[#767682] flex items-center gap-1.5 justify-center sm:justify-start">
              <Tv className="w-3 h-3 text-[#00f59b]" />
              <span>Watched VODs</span>
            </div>
            <div className="text-sm font-bold text-[#efeff1] tabular-nums mt-0.5">
              {profile?.stats?.watchedCount ?? 0}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-[#767682] bg-[#18181b] rounded-lg border border-[#2d2d34]">
          <Loader2 className="w-6 h-6 animate-spin text-[#9146ff] mx-auto mb-2" />
          <p className="text-xs">Loading account settings…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Change Username */}
          <div className="rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[#2d2d34]">
              <div className="p-1.5 rounded bg-[#9146ff]/15 text-[#bf94ff]">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#efeff1]">Change Username</h2>
                <p className="text-[11px] text-[#767682]">Update your public display handle</p>
              </div>
            </div>

            {/* Cooldown Status Badge */}
            {profile?.canChangeUsername ? (
              <div className="p-3 rounded-md bg-[#00f59b]/10 border border-[#00f59b]/30 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#00f59b] flex-shrink-0 mt-0.5" />
                <div className="text-xs text-[#d1fae5]">
                  <span className="font-semibold">Available to change</span>
                  <p className="text-[11px] text-[#a7f3d0] mt-0.5">
                    You may change your username now. Once changed, there is a 15-day cooldown before you can change it again.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-md bg-[#f5a623]/10 border border-[#f5a623]/30 flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-[#f5a623] flex-shrink-0 mt-0.5" />
                <div className="text-xs text-[#fde68a]">
                  <span className="font-semibold">15-Day Cooldown Active</span>
                  <p className="text-[11px] text-[#fef3c7] mt-0.5">
                    Usernames can only be updated once every 15 days. You can change your username again in{" "}
                    <strong className="text-white">{profile?.daysRemaining} day{profile?.daysRemaining === 1 ? "" : "s"}</strong>
                    {profile?.nextAvailableDate && (
                      <span> (on {new Date(profile.nextAvailableDate).toLocaleDateString()})</span>
                    )}.
                  </p>
                </div>
              </div>
            )}

            {usernameSuccess && (
              <div className="p-2.5 rounded bg-[#00f59b]/10 border border-[#00f59b]/30 text-[#00f59b] text-xs">
                {usernameSuccess}
              </div>
            )}

            {usernameError && (
              <div className="p-2.5 rounded bg-[#eb0400]/10 border border-[#eb0400]/30 text-[#ff8080] text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{usernameError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateUsername} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-[#adadb8] mb-1">New Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  disabled={!profile?.canChangeUsername || isUpdatingUsername}
                  placeholder={profile?.canChangeUsername ? "Enter new username" : "Cooldown in effect"}
                  minLength={3}
                  maxLength={25}
                  required
                  className="w-full px-3 py-2 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff] disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <p className="text-[11px] text-[#767682] mt-1">
                  3–25 characters (letters, numbers, _). Cannot start with a number.
                </p>
              </div>

              <button
                type="submit"
                disabled={!profile?.canChangeUsername || !newUsername.trim() || isUpdatingUsername}
                className="w-full py-2 px-4 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-40 text-white font-semibold text-xs rounded-md flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed"
              >
                {isUpdatingUsername && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Update Username</span>
              </button>
            </form>
          </div>

          {/* Card 2: Change Password */}
          <div className="rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[#2d2d34]">
              <div className="p-1.5 rounded bg-[#9146ff]/15 text-[#bf94ff]">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#efeff1]">Update Password</h2>
                <p className="text-[11px] text-[#767682]">Change your account login credentials</p>
              </div>
            </div>

            {passwordSuccess && (
              <div className="p-2.5 rounded bg-[#00f59b]/10 border border-[#00f59b]/30 text-[#00f59b] text-xs">
                {passwordSuccess}
              </div>
            )}

            {passwordError && (
              <div className="p-2.5 rounded bg-[#eb0400]/10 border border-[#eb0400]/30 text-[#ff8080] text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-[#adadb8] mb-1">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="Enter current password"
                    className="w-full px-3 py-2 pr-9 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#767682] hover:text-[#efeff1] p-1 cursor-pointer"
                    aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                  >
                    {showCurrentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#adadb8] mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    maxLength={128}
                    placeholder="Enter new password"
                    className="w-full px-3 py-2 pr-9 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#767682] hover:text-[#efeff1] p-1 cursor-pointer"
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#adadb8] mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2 bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md text-xs focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
                />
              </div>

              <p className="text-[11px] text-[#767682] pt-0.5">
                Special characters (!@#$%^&* etc.) are supported. &lt; and &gt; are blocked for script safety.
              </p>
              <p className="text-[11px] text-[#adadb8] pt-0.5 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#9146ff]" />
                Changing your password will sign out all other devices and active sessions.
              </p>

              <button
                type="submit"
                disabled={!currentPassword || !newPassword || !confirmPassword || isUpdatingPassword}
                className="w-full py-2 px-4 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-40 text-white font-semibold text-xs rounded-md flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed"
              >
                {isUpdatingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Update Password</span>
              </button>
            </form>
          </div>

          {/* Card 3: Date & Timestamp Display Preferences */}
          <div className="md:col-span-2 rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2d34]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-[#9146ff]/15 text-[#bf94ff]">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#efeff1]">Date & Timestamp Display</h2>
                  <p className="text-[11px] text-[#767682]">
                    Choose whether dates appear as relative time or exact calendar dates across video cards and archives
                  </p>
                </div>
              </div>
              {isSavingDateFormat && (
                <span className="flex items-center gap-1.5 text-[11px] text-[#bf94ff]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Saving…</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Option 1: Relative Time (Default) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleUpdateDateFormat("relative")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleUpdateDateFormat("relative");
                  }
                }}
                className={`p-4 rounded-lg border text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  activeDateFormat === "relative"
                    ? "border-[#9146ff] bg-[#9146ff]/10 text-white shadow-sm ring-1 ring-[#9146ff]/30"
                    : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          activeDateFormat === "relative"
                            ? "border-[#9146ff] bg-[#9146ff]"
                            : "border-[#767682] bg-transparent"
                        }`}
                      >
                        {activeDateFormat === "relative" && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-[#efeff1]">Relative Time (Default)</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-[#26262c] text-[#a1a1aa] border border-[#3f3f46]">
                      Standard
                    </span>
                  </div>
                  <p className="text-[11px] text-[#767682] pl-5.5 leading-relaxed">
                    Displays elapsed time since broadcast (e.g. <strong className="text-[#efeff1]">11h ago</strong>, <strong className="text-[#efeff1]">2d ago</strong>, <strong className="text-[#efeff1]">3mo ago</strong>).
                  </p>
                </div>

                <div className="mt-3.5 pt-2.5 border-t border-[#2d2d34]/60 flex items-center justify-between text-[11px] pl-5.5">
                  <span className="text-[#767682]">Card Preview:</span>
                  <span className="px-2 py-0.5 rounded bg-[#26262c] text-[#00f59b] font-mono text-[10px] font-semibold border border-[#3f3f46]">
                    2d ago
                  </span>
                </div>
              </div>

              {/* Option 2: Exact Calendar Date */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleUpdateDateFormat("exact")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleUpdateDateFormat("exact");
                  }
                }}
                className={`p-4 rounded-lg border text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  activeDateFormat === "exact"
                    ? "border-[#9146ff] bg-[#9146ff]/10 text-white shadow-sm ring-1 ring-[#9146ff]/30"
                    : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          activeDateFormat === "exact"
                            ? "border-[#9146ff] bg-[#9146ff]"
                            : "border-[#767682] bg-transparent"
                        }`}
                      >
                        {activeDateFormat === "exact" && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-[#efeff1]">Exact Calendar Date</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-[#9146ff]/20 text-[#bf94ff] border border-[#9146ff]/40">
                      Precise
                    </span>
                  </div>
                  <p className="text-[11px] text-[#767682] pl-5.5 leading-relaxed">
                    Displays numerical dates for all streams (e.g. <strong className="text-[#efeff1]">9/4/2026</strong>). Best for chronological archiving.
                  </p>
                </div>

                <div className="mt-3.5 pt-2.5 border-t border-[#2d2d34]/60 flex items-center justify-between text-[11px] pl-5.5">
                  <span className="text-[#767682]">Card Preview:</span>
                  <span className="px-2 py-0.5 rounded bg-[#26262c] text-[#bf94ff] font-mono text-[10px] font-semibold border border-[#3f3f46]">
                    9/4/2026
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Watch History & Completion Rules */}
          <div className="md:col-span-2 rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2d34]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-[#00f59b]/15 text-[#00f59b]">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#efeff1]">Watch History & Completion Rules</h2>
                  <p className="text-[11px] text-[#767682]">
                    Configure what triggers a VOD to be marked as watched and customize bulk action scopes
                  </p>
                </div>
              </div>
              {isSavingWatchSettings && (
                <span className="flex items-center gap-1.5 text-[11px] text-[#00f59b]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Saving…</span>
                </span>
              )}
            </div>

            {/* Completion Default Explainer Banner */}
            <div className="p-3 bg-[#0e0e10]/60 border border-[#2d2d34] rounded-lg flex items-start gap-2.5 text-xs text-[#adadb8]">
              <div className="p-1 rounded bg-[#9146ff]/20 text-[#bf94ff] mt-0.5 flex-shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-[#efeff1]">Default Completion Rule</p>
                <p className="text-[11px] text-[#767682] leading-relaxed">
                  By default, videos are only marked as watched when you manually click the checkmark button or watch through to the end of the VOD (95%+ completion). You can enable the automatic triggers below if you prefer.
                </p>
              </div>
            </div>

            {/* Trigger Options Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Trigger 1: Open link in new tab */}
              <label
                className={`p-4 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${
                  watchSettings.markWatchedOnOpenLink
                    ? "border-[#9146ff] bg-[#9146ff]/10 text-white"
                    : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                }`}
              >
                <div className="space-y-1.5 flex-1 pr-2">
                  <div className="flex items-center gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-[#bf94ff]" />
                    <span className="text-xs font-bold text-[#efeff1]">Open Link in New Tab</span>
                  </div>
                  <p className="text-[11px] text-[#767682] leading-relaxed">
                    Automatically mark a video as watched when clicking its title to open on Twitch in a new tab.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={watchSettings.markWatchedOnOpenLink}
                  onChange={(e) => handleUpdateWatchSettings({ markWatchedOnOpenLink: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-[#3f3f46] bg-[#0e0e10] text-[#9146ff] focus:ring-[#9146ff] focus:ring-offset-0 cursor-pointer accent-[#9146ff]"
                />
              </label>

              {/* Trigger 2: Starting playback */}
              <label
                className={`p-4 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${
                  watchSettings.markWatchedOnPlay
                    ? "border-[#9146ff] bg-[#9146ff]/10 text-white"
                    : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                }`}
              >
                <div className="space-y-1.5 flex-1 pr-2">
                  <div className="flex items-center gap-2">
                    <Play className="w-3.5 h-3.5 text-[#00f59b]" />
                    <span className="text-xs font-bold text-[#efeff1]">Starting Playback</span>
                  </div>
                  <p className="text-[11px] text-[#767682] leading-relaxed">
                    Mark a VOD as watched as soon as you start watching, even if you don&apos;t reach the end.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={watchSettings.markWatchedOnPlay}
                  onChange={(e) => handleUpdateWatchSettings({ markWatchedOnPlay: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-[#3f3f46] bg-[#0e0e10] text-[#9146ff] focus:ring-[#9146ff] focus:ring-offset-0 cursor-pointer accent-[#9146ff]"
                />
              </label>
            </div>

            {/* Scope Setting: Mark All as Watched Scope */}
            <div className="pt-2 space-y-2.5">
              <div>
                <h3 className="text-xs font-bold text-[#efeff1] flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-[#00f59b]" />
                  <span>&ldquo;Mark All as Watched&rdquo; Scope</span>
                </h3>
                <p className="text-[11px] text-[#767682]">
                  Select which broadcasts are marked as watched when pressing &ldquo;Mark All as Watched&rdquo; on a creator&apos;s page
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Scope Option 1: Loaded Only */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleUpdateWatchSettings({ markAllWatchedScope: "loaded" })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleUpdateWatchSettings({ markAllWatchedScope: "loaded" });
                    }
                  }}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    watchSettings.markAllWatchedScope === "loaded"
                      ? "border-[#9146ff] bg-[#9146ff]/10 text-white ring-1 ring-[#9146ff]/30"
                      : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          watchSettings.markAllWatchedScope === "loaded"
                            ? "border-[#9146ff] bg-[#9146ff]"
                            : "border-[#767682] bg-transparent"
                        }`}
                      >
                        {watchSettings.markAllWatchedScope === "loaded" && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-[#efeff1]">Loaded Broadcasts Only</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-[#26262c] text-[#a1a1aa] border border-[#3f3f46]">
                      Default
                    </span>
                  </div>
                  <p className="text-[11px] text-[#767682] pl-5.5 leading-relaxed">
                    Only marks the VODs currently visible on screen. Unloaded past broadcasts remain untouched.
                  </p>
                </div>

                {/* Scope Option 2: All Channel VODs */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleUpdateWatchSettings({ markAllWatchedScope: "all" })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleUpdateWatchSettings({ markAllWatchedScope: "all" });
                    }
                  }}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    watchSettings.markAllWatchedScope === "all"
                      ? "border-[#9146ff] bg-[#9146ff]/10 text-white ring-1 ring-[#9146ff]/30"
                      : "border-[#2d2d34] bg-[#0e0e10]/60 text-[#adadb8] hover:border-[#3f3f46] hover:bg-[#18181b]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          watchSettings.markAllWatchedScope === "all"
                            ? "border-[#9146ff] bg-[#9146ff]"
                            : "border-[#767682] bg-transparent"
                        }`}
                      >
                        {watchSettings.markAllWatchedScope === "all" && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-[#efeff1]">All Creator Broadcasts</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-[#9146ff]/20 text-[#bf94ff] border border-[#9146ff]/40">
                      Entire Catalog
                    </span>
                  </div>
                  <p className="text-[11px] text-[#767682] pl-5.5 leading-relaxed">
                    Marks all past broadcasts by that creator as watched, even ones that aren&apos;t loaded yet.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card 5: Watch Statistics Dashboard */}
          <div className="md:col-span-2 rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2d34]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-[#00f59b]/15 text-[#00f59b]">
                  <BarChart2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#efeff1]">Watch Statistics & Activity</h2>
                  <p className="text-[11px] text-[#767682]">
                    Personal viewing analytics and playback milestones calculated from your synced watch history
                  </p>
                </div>
              </div>
              {isLoadingStats && <Loader2 className="w-4 h-4 text-[#00f59b] animate-spin" />}
            </div>

            {/* Metric counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-lg bg-[#0e0e10]/80 border border-[#2d2d34]">
                <div className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#9146ff]" />
                  <span>Time Watched</span>
                </div>
                <div className="text-xl font-bold text-[#efeff1] tabular-nums">
                  {statsData?.totalHours ?? "0.0"} <span className="text-xs font-normal text-gray-400">hrs</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#0e0e10]/80 border border-[#2d2d34]">
                <div className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-[#00f59b]" />
                  <span>Completed</span>
                </div>
                <div className="text-xl font-bold text-[#00f59b] tabular-nums">
                  {statsData?.completedCount ?? 0} <span className="text-xs font-normal text-gray-400">VODs</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#0e0e10]/80 border border-[#2d2d34]">
                <div className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-[#f5a623]" />
                  <span>In Progress</span>
                </div>
                <div className="text-xl font-bold text-[#f5a623] tabular-nums">
                  {statsData?.inProgressCount ?? 0} <span className="text-xs font-normal text-gray-400">VODs</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#0e0e10]/80 border border-[#2d2d34]">
                <div className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-[#bf94ff]" />
                  <span>Pinned Creators</span>
                </div>
                <div className="text-xl font-bold text-[#efeff1] tabular-nums">
                  {statsData?.pinnedCount ?? 0} <span className="text-xs font-normal text-gray-400">channels</span>
                </div>
              </div>
            </div>

            {/* Top Streamers Watched */}
            {statsData?.streamers && statsData.streamers.length > 0 && (
              <div className="pt-2 space-y-2">
                <h3 className="text-xs font-bold text-[#efeff1] uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-[#9146ff]" />
                  <span>Top Streamers Watched</span>
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {statsData.streamers.map((s: any) => {
                    const totalSec = statsData.totalSeconds || 1;
                    const pct = Math.min(100, Math.round((s.secondsWatched / totalSec) * 100));
                    const hrs = (s.secondsWatched / 3600).toFixed(1);

                    return (
                      <div
                        key={s.streamerLogin}
                        className="p-2.5 rounded-lg bg-[#0e0e10]/60 border border-[#2d2d34] flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {s.avatarUrl ? (
                              <img src={s.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-[#9146ff]/20 text-[#bf94ff] flex items-center justify-center text-[10px] font-bold">
                                {s.displayName?.charAt(0) || "S"}
                              </div>
                            )}
                            <span className="font-semibold text-white">{s.displayName}</span>
                            <span className="text-[#767682]">({s.totalVods} VODs)</span>
                          </div>
                          <div className="flex items-center gap-2 tabular-nums">
                            <span className="font-bold text-[#efeff1]">{hrs} hrs</span>
                            <span className="text-[11px] text-[#767682]">({pct}%)</span>
                          </div>
                        </div>
                        <div className="w-full h-1 bg-[#26262c] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#9146ff] to-[#00f59b] rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Card 6: Data Backup & Restore */}
          <div className="rounded-lg bg-[#18181b] border border-[#2d2d34] p-5 sm:p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 pb-2 border-b border-[#2d2d34]">
                <div className="p-1.5 rounded bg-[#9146ff]/15 text-[#9146ff]">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#efeff1]">Data Backup & Restore</h2>
                  <p className="text-[11px] text-[#767682]">
                    Export or restore watch progress, pinned creators, bookmarks, and tags
                  </p>
                </div>
              </div>
              <p className="text-xs text-[#adadb8] leading-relaxed">
                Download a complete JSON snapshot of your account data for safe keeping, or restore previous watch progress on another device.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="w-full py-2.5 px-4 bg-[#26262c] hover:bg-[#32323a] text-white text-xs font-semibold rounded-md border border-[#3f3f46] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-[#9146ff]" />}
                <span>Download Archive Backup (JSON)</span>
              </button>

              <label className="w-full py-2.5 px-4 bg-[#26262c] hover:bg-[#32323a] text-white text-xs font-semibold rounded-md border border-[#3f3f46] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]">
                {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-[#00f59b]" />}
                <span>{isImporting ? "Restoring..." : "Restore From Backup File"}</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImport}
                  disabled={isImporting}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Card 7: Danger Zone / Account Deletion */}
          <div className="rounded-lg bg-[#18181b] border border-red-500/30 p-5 sm:p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 pb-2 border-b border-red-500/20">
                <div className="p-1.5 rounded bg-red-500/15 text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-red-400">Danger Zone</h2>
                  <p className="text-[11px] text-[#767682]">
                    Permanently delete account and all historical data
                  </p>
                </div>
              </div>
              <p className="text-xs text-[#adadb8] leading-relaxed">
                Deleting your account immediately purges all pinned creators, watch history, bookmarks, and custom settings. This action is irreversible.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeletePassword("");
                  setDeleteError(null);
                  setIsDeleteModalOpen(true);
                }}
                className="w-full py-2.5 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 text-xs font-semibold rounded-md border border-red-500/30 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account & Data</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-tab-fade-in">
          <div className="relative w-full max-w-md bg-[#18181b] border border-red-500/40 rounded-2xl shadow-2xl p-6 space-y-4 animate-dropdown">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/30">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Permanently Delete Account?</h3>
                <p className="text-xs text-gray-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              All your pinned streamers, watch status, timestamped bookmarks, and tags will be erased immediately. Please enter your password to confirm.
            </p>

            {deleteError && (
              <div className="p-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Confirm Password</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your current password"
                className="w-full px-3 py-2 bg-[#0e0e10] text-white placeholder-gray-500 border border-[#2d2d34] rounded-md text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-md bg-[#26262c] hover:bg-[#32323a] text-gray-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={!deletePassword || isDeleting}
                className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
