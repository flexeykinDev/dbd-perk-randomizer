"use client";

import { Check, ChevronDown, Copy, MessageCircle, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { CopyFeedback } from "@/lib/use-copy-feedback";
import type { TwitchConnectionState, TwitchPermission } from "@/lib/twitch-chat";
import type { TwitchSettings } from "@/lib/use-twitch-settings";

const STATE_LABEL: Record<TwitchConnectionState, { ru: string; en: string }> = {
  disconnected: { ru: "Отключено", en: "Disconnected" },
  connecting: { ru: "Подключение…", en: "Connecting…" },
  connected: { ru: "Подключено", en: "Connected" },
  error: { ru: "Ошибка подключения", en: "Connection error" },
};

/** Semantic colours (amber = working on it, green = fine, red = broken)
 *  rather than the site accent — these say something about state, not
 *  about brand. Shared vocabulary with the publish-status dot. */
const STATE_DOT: Record<TwitchConnectionState, string> = {
  disconnected: "bg-muted",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  error: "bg-red-500",
};

const PERMISSION_LABEL: Record<TwitchPermission, { ru: string; en: string }> = {
  everyone: { ru: "Все в чате", en: "Everyone in chat" },
  subs_vips: { ru: "Только подписчики/VIP", en: "Subs/VIPs only" },
  mods: { ru: "Только модераторы", en: "Moderators only" },
};

/** Reads the channel's public chat anonymously and maps commands onto the
 *  board. Everything here is settings the board owns — this renders them. */
export function ObsTwitchPanel({
  twitch,
  copy,
  /** The ready-made command for whatever is on screen right now, or null
   *  when the current build has no shareable IDs. */
  pasteCommandForBuild,
  onOpenConstructor,
}: {
  twitch: TwitchSettings;
  copy: CopyFeedback;
  pasteCommandForBuild: string | null;
  onOpenConstructor: () => void;
}) {
  const t = useT();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <MessageCircle className="size-3.5 text-muted" />
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t({ ru: "Управление из чата Twitch", en: "Control from Twitch chat" })}
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted">
        {t({
          ru: "Читает публичный чат канала анонимно (без входа в Twitch).",
          en: "Reads the channel's public chat anonymously (no Twitch login).",
        })}
      </p>

      <div className="flex items-center gap-2">
        <span className="text-muted" aria-hidden>
          #
        </span>
        <input
          type="text"
          value={twitch.channel}
          onChange={(e) => twitch.setChannel(e.target.value)}
          placeholder={t({ ru: "имя_канала", en: "channel_name" })}
          aria-label={t({ ru: "Имя канала Twitch", en: "Twitch channel name" })}
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
          <input
            type="checkbox"
            checked={twitch.enabled}
            disabled={!twitch.channel.trim()}
            onChange={(e) => twitch.setEnabled(e.target.checked)}
            className="size-4 accent-accent disabled:opacity-40"
          />
          {t({ ru: "Вкл", en: "On" })}
        </label>
      </div>
      {twitch.enabled && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <span className={cn("size-1.5 rounded-full", STATE_DOT[twitch.state])} />
          {t(STATE_LABEL[twitch.state])}
        </p>
      )}

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        aria-expanded={advancedOpen}
        className="mt-3 flex w-full items-center justify-between text-[11px] font-medium text-muted transition-colors hover:text-foreground"
      >
        {t({ ru: "Команды и права доступа", en: "Commands & permissions" })}
        <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
      </button>

      {advancedOpen && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted">
              {t({ ru: "Реролл — команда", en: "Reroll — command" })}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={twitch.rerollCommand}
                onChange={(e) => twitch.setRerollCommand(e.target.value)}
                placeholder="!reroll"
                aria-label={t({ ru: "Команда реролла", en: "Reroll command" })}
                className="w-24 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
              />
              <PermissionSelect
                value={twitch.rerollPermission}
                onChange={twitch.setRerollPermission}
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={twitch.cooldownSec}
                  onChange={(e) => twitch.setCooldownSec(Number(e.target.value))}
                  aria-label={t({ ru: "Кулдаун реролла, секунд", en: "Reroll cooldown, seconds" })}
                  className="w-14 rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                />
                <span className="text-[11px] text-muted">
                  {t({ ru: "сек. кулдаун", en: "sec cooldown" })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <input
                type="checkbox"
                checked={twitch.pasteEnabled}
                onChange={(e) => twitch.setPasteEnabled(e.target.checked)}
                className="size-3.5 accent-accent"
              />
              {t({
                ru: "Команда «вставить билд по коду» (для саб/VIP)",
                en: '"Paste a build by code" command (for subs/VIPs)',
              })}
            </label>
            {twitch.pasteEnabled && (
              <>
                <div className="flex flex-wrap items-center gap-1.5 pl-5">
                  <input
                    type="text"
                    value={twitch.pasteCommand}
                    onChange={(e) => twitch.setPasteCommand(e.target.value)}
                    placeholder="!paste"
                    aria-label={t({ ru: "Команда вставки билда", en: "Paste-build command" })}
                    className="w-24 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                  />
                  <PermissionSelect
                    value={twitch.pastePermission}
                    onChange={twitch.setPastePermission}
                  />
                </div>
                <p className="pl-5 text-[11px] text-muted">
                  {t({
                    ru: 'Пример: "!paste 42,105,12,8" — числа берутся из ссылки Поделиться на сайте.',
                    en: 'Example: "!paste 42,105,12,8" — the numbers come from the site\'s Share link.',
                  })}
                </p>
                {pasteCommandForBuild && (
                  <div className="pl-5">
                    <p className="mb-1 text-[11px] font-medium text-muted">
                      {t({
                        ru: "Готовая команда для билда на экране сейчас:",
                        en: "Ready command for the build on screen right now:",
                      })}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <code className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
                        {pasteCommandForBuild}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copy.copy(
                            "paste-current",
                            pasteCommandForBuild,
                            t({ ru: "Команда скопирована", en: "Command copied" }),
                          )
                        }
                        aria-label={t({ ru: "Скопировать команду", en: "Copy command" })}
                        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                      >
                        {copy.isCopied("paste-current") ? (
                          <Check className="size-3 text-accent" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onOpenConstructor}
                  className="flex items-center gap-1.5 pl-5 text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                >
                  <Wrench className="size-3" />
                  {t({
                    ru: "Собрать билд вручную — вкладка «Конструктор»",
                    en: "Build one from scratch — see the “Constructor” tab",
                  })}
                </button>
              </>
            )}
          </div>

          <p className="text-[11px] text-muted">
            {t({
              ru: "Twitch не даёт напрямую узнать «донатер» из чата — саб/VIP статус ближе всего к этому и виден в самом чате.",
              en: 'Twitch\'s chat itself has no notion of "donator" — sub/VIP status is the closest thing visible directly in chat.',
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function PermissionSelect({
  value,
  onChange,
}: {
  value: TwitchPermission;
  onChange: (value: TwitchPermission) => void;
}) {
  const t = useT();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TwitchPermission)}
      aria-label={t({ ru: "Кому разрешена команда", en: "Who may use this command" })}
      className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
    >
      {(["everyone", "subs_vips", "mods"] as const).map((option) => (
        <option key={option} value={option}>
          {t(PERMISSION_LABEL[option])}
        </option>
      ))}
    </select>
  );
}
