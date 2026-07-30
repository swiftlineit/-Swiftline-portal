"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FiBell, FiCheck } from "react-icons/fi";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type PortalNotification
} from "@/lib/notifications";

function relativeTime(value: string) {
  const minutes = Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 60_000), 0);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await listNotifications();
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
      setError("");
    } catch {
      setError("Notifications could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  async function openNotification(notification: PortalNotification) {
    if (!notification.readAt) {
      await markNotificationRead(notification.id);
      setUnreadCount((count) => Math.max(count - 1, 0));
      setNotifications((items) => items.map((item) => item.id === notification.id
        ? { ...item, readAt: new Date().toISOString() }
        : item));
    }
    setOpen(false);
    router.push(notification.href);
  }

  async function readAll() {
    await markAllNotificationsRead();
    const readAt = new Date().toISOString();
    setUnreadCount(0);
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || readAt })));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center border rounded-4xl  border-slate-300 bg-white text-slate-700 hover:border-blue-800 hover:text-blue-900"
      >
        <FiBell className="h-4 w-4" />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center  rounded-full justify-center bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-90 max-w-[calc(100vw-2rem)] border border-slate-200 bg-white shadow-xl">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
            <p className="text-sm font-semibold text-slate-950">Notifications</p>
            {unreadCount ? (
              <button type="button" onClick={() => void readAll()} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-900">
                <FiCheck /> Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-90 overflow-y-auto">
            {error ? <p className="p-4 text-sm text-red-700">{error}</p> : null}
            {!error && !notifications.length ? <p className="p-6 text-center text-sm text-slate-500">No notifications yet.</p> : null}
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => void openNotification(notification)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 ${notification.readAt ? "bg-white" : "bg-blue-50"}`}
              >
                <span className="block text-sm font-semibold text-slate-950">{notification.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">{notification.message}</span>
                <span className="mt-1 block text-[11px] font-medium text-slate-400">{relativeTime(notification.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
