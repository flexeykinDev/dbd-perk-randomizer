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
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-surface/70 px-4 py-2.5 text-sm text-foreground shadow-2xl shadow-black/30 backdrop-blur-md"
        >
          <Check className="size-4 text-accent" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
