"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

export function CopyToast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-foreground shadow-xl"
        >
          <Check className="size-4 text-accent" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
