"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

export function CopyToast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[90vw] -translate-x-1/2 items-start gap-2.5 rounded-2xl border border-white/10 bg-surface/70 px-4 py-3 text-sm leading-snug text-foreground shadow-2xl shadow-black/30 backdrop-blur-md sm:w-auto sm:max-w-sm"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
