"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, Pencil, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useModal } from "@/lib/use-modal";
import { ROLE_COLOR } from "@/lib/role-color";
import {
  deleteBuild,
  exportVault,
  getVault,
  importVaultFile,
  renameBuild,
  saveBuild,
  type VaultBuild,
  type VaultProblem,
} from "@/lib/vault";
import { saveImage } from "@/lib/save-image";
import type { PerkRole } from "@/lib/types";

const ROW =
  "flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-control";

/** What to tell the player about a file that could not be read. Phrased as
 *  what happened and what to do, never as an error code. */
const PROBLEM_TEXT: Record<VaultProblem, { ru: string; en: string }> = {
  "not-json": {
    ru: "Это не похоже на файл с билдами — он повреждён или это другой файл.",
    en: "That does not look like a builds file — it is damaged, or it is a different file.",
  },
  "not-a-vault": {
    ru: "Этот файл не из этого сайта. Нужен файл, скачанный кнопкой «Выгрузить».",
    en: "That file is not from this site. You need one saved with the Export button.",
  },
  empty: {
    ru: "В файле не осталось ни одного билда — возможно, эти перки уже убрали из игры.",
    en: "There were no builds left in that file — those perks may have been retired from the game.",
  },
};

export function VaultModal({
  open,
  onClose,
  onOpenBuild,
  currentBuild,
}: {
  open: boolean;
  onClose: () => void;
  /** Puts a saved build back on the board. */
  onOpenBuild: (build: VaultBuild) => void;
  /** The build showing right now, or null when there is nothing worth
   *  saving — a pool that came up empty, or loadout-only with no pieces. */
  currentBuild: { role: PerkRole; mode: "perks" | "loadout"; keys: string[] } | null;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open,
    onClose,
    label: t({ ru: "Мои билды", en: "My builds" }),
  });

  const [builds, setBuilds] = useState<VaultBuild[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Read on open rather than on every render: the list only changes through
     this component, so re-reading localStorage each render would be work for
     nothing — and reading it during render would be a storage access on the
     server's pass.

     Gathered into a named function, the same shape lib/use-twitch-settings.ts
     uses for its hydration. react-hooks/set-state-in-effect exists to catch
     cascading renders, and restoring saved state on open is the case the
     cascade is the entire point of. */
  useEffect(() => {
    if (!open) return;
    function restoreSavedBuilds() {
      setBuilds(getVault());
      setNotice(null);
    }
    restoreSavedBuilds();
  }, [open]);

  if (!open) return null;

  function handleSave() {
    if (!currentBuild) return;
    const label = name.trim();
    setBuilds(
      saveBuild({
        name: label || t({ ru: "Без названия", en: "Untitled" }),
        role: currentBuild.role,
        mode: currentBuild.mode,
        keys: currentBuild.keys,
      }),
    );
    setName("");
  }

  async function handleExport() {
    const text = exportVault();
    const stamp = new Date().toISOString().slice(0, 10);
    // saveImage is named for its first caller but is really "hand this file
    // to the person", share sheet on touch and download elsewhere, with the
    // Safari quirks already worked out. Worth renaming one day; worth far
    // less than a second copy of those quirks.
    await saveImage(
      new Blob([text], { type: "application/json" }),
      `dbd-builds-${stamp}.json`,
    );
  }

  async function handleImportFile(file: File) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice(t({ ru: "Не удалось прочитать файл.", en: "Could not read that file." }));
      return;
    }
    const result = importVaultFile(text);
    setBuilds(result.builds);

    if (result.problem) {
      setNotice(t(PROBLEM_TEXT[result.problem]));
      return;
    }
    // Everything that happened, in one sentence: what arrived, what was
    // already here, and what could not be read. Silence about the dropped
    // parts would make a half-imported file look like a whole one.
    const parts = [
      t({ ru: `Добавлено: ${result.added}`, en: `Added ${result.added}` }),
      result.skipped > 0
        ? t({ ru: `уже были: ${result.skipped}`, en: `${result.skipped} already saved` })
        : null,
      result.droppedBuilds > 0
        ? t({ ru: `пропущено: ${result.droppedBuilds}`, en: `${result.droppedBuilds} skipped` })
        : null,
      result.droppedKeys > 0
        ? t({
            ru: `перков не найдено: ${result.droppedKeys}`,
            en: `${result.droppedKeys} perks no longer exist`,
          })
        : null,
    ].filter(Boolean);
    setNotice(`${parts.join(" · ")}.`);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          ref={attachCard}
          {...dialogProps}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="text-base font-bold">{t({ ru: "Мои билды", en: "My builds" })}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t({ ru: "Закрыть", en: "Close" })}
              className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto p-4">
            {/* Saving is the reason the modal is open most of the time, so it
                is first rather than buried under the list. */}
            {currentBuild ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                  maxLength={60}
                  placeholder={t({
                    ru: "Название текущего билда…",
                    en: "Name this build…",
                  })}
                  aria-label={t({ ru: "Название билда", en: "Build name" })}
                  className="flex-1 rounded-full border border-border bg-surface px-3 py-1.5 text-control text-foreground placeholder:text-muted/70 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-full bg-accent px-4 py-1.5 text-control font-semibold text-accent-foreground transition-transform hover:scale-105 active:scale-95"
                >
                  {t({ ru: "Сохранить", en: "Save" })}
                </button>
              </div>
            ) : (
              <p className="text-hint text-muted">
                {t({
                  ru: "Сейчас нечего сохранять — сгенерируйте билд.",
                  en: "Nothing to save yet — generate a build first.",
                })}
              </p>
            )}

            {notice && (
              <p role="status" className="rounded-xl bg-surface px-3 py-2 text-hint text-muted">
                {notice}
              </p>
            )}

            {builds.length === 0 ? (
              <p className="py-8 text-center text-hint text-muted">
                {t({
                  ru: "Пока пусто. Сохранённые билды появятся здесь.",
                  en: "Nothing saved yet. Builds you keep will show up here.",
                })}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {builds.map((build) => (
                  <li key={build.id} className={ROW}>
                    {renaming === build.id ? (
                      <>
                        <input
                          type="text"
                          value={renameText}
                          autoFocus
                          maxLength={60}
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setBuilds(renameBuild(build.id, renameText));
                              setRenaming(null);
                            }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          aria-label={t({ ru: "Новое название", en: "New name" })}
                          className="flex-1 rounded-full border border-border bg-background px-2.5 py-1 text-control focus:ring-2 focus:ring-accent/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setBuilds(renameBuild(build.id, renameText));
                            setRenaming(null);
                          }}
                          aria-label={t({ ru: "Сохранить название", en: "Save name" })}
                          className="flex size-7 items-center justify-center rounded-full text-muted hover:text-foreground"
                        >
                          <Check className="size-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenBuild(build)}
                          className="flex-1 truncate text-left font-medium hover:text-accent"
                        >
                          {build.name}
                          <span
                            className={cn("ml-2 text-meta font-normal", ROLE_COLOR[build.role].text)}
                          >
                            {build.keys.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenaming(build.id);
                            setRenameText(build.name);
                          }}
                          aria-label={t({ ru: "Переименовать", en: "Rename" })}
                          className="flex size-7 items-center justify-center rounded-full text-muted hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setBuilds(deleteBuild(build.id))}
                          aria-label={t({ ru: "Удалить", en: "Delete" })}
                          className="flex size-7 items-center justify-center rounded-full text-muted hover:text-red-400"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={handleExport}
              disabled={builds.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Download className="size-3.5" />
              {t({ ru: "Выгрузить файлом", en: "Export to a file" })}
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Upload className="size-3.5" />
              {t({ ru: "Загрузить из файла", en: "Import from a file" })}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so picking the same file twice still fires a
                // change event — otherwise a second import of a corrected
                // file silently does nothing.
                e.target.value = "";
                if (file) void handleImportFile(file);
              }}
            />
            <p className="w-full text-hint text-muted">
              {t({
                ru: "Загрузка добавляет билды к вашим, ничего не стирая.",
                en: "Importing adds to what you have; nothing is erased.",
              })}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
