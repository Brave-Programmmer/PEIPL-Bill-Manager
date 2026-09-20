import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Bot, Sparkles, Loader2, ShieldCheck } from "lucide-react";
import { useDisplayName } from "../utils/userProfile";

interface MitraLoadingOverlayProps {
  visible: boolean;
  message: string;
  detail?: string;
}

/**
 * Friendly, slightly frank messages for Mitra.
 * One is selected whenever a new loading session starts.
 */
const frankMessages = [
  "Give me a sec… I've got this. 😌",
  "Almost there… don't run away yet. 😄",
  "Hang tight, I'm taking care of the boring bits for you.",
  "Just a moment… Mitra is cooking something useful. ✨",
  "Give me a little time. I'm not just spinning a loader, promise. 😏",
  "Working on it… because apparently robots need a minute too. 🤖",
  "One tiny moment… I'm making this easier for you.",
  "Hold on… I'm putting the finishing touches on this. ✨",
  "Easy there… I'm on it. 😎",
  "Give me a moment. Your request is getting the Mitra treatment.",
  "Yep, I'm working on it. You can relax now. 😌",
  "Almost done… I've got fewer excuses than your Wi-Fi. 😄",
];

/**
 * Pick a random message without repeating the same message
 * immediately when possible.
 */
const getRandomMessage = (previous?: string) => {
  const available = frankMessages.filter((message) => message !== previous);

  return available[Math.floor(Math.random() * available.length)];
};

export const MitraLoadingOverlay: React.FC<MitraLoadingOverlayProps> = ({
  visible,
  message,
  detail = "You can keep this window open while I finish the details.",
}) => {
  const reduceMotion = useReducedMotion();
  const displayName = useDisplayName();

  const [frankMessage, setFrankMessage] = useState(frankMessages[0]);

  /**
   * Pick a fresh frank message whenever a new loading
   * session starts.
   */
  useEffect(() => {
    if (!visible) return;

    setFrankMessage((previous) => getRandomMessage(previous));
  }, [visible]);

  if (typeof document === "undefined") return null;

  /*
   * If a custom message is provided, use it.
   * Otherwise, fall back to Mitra's frank personality.
   */
  const activeMessage = message?.trim() ? message : frankMessage;

  const personalizedMessage = `${displayName}, ${activeMessage}`;

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{
            duration: 0.22,
            ease: "easeOut",
          }}
          className="
            fixed inset-0 z-[1000]
            flex items-center justify-center
            bg-slate-950/70
            p-4 sm:p-6
            backdrop-blur-xl
          "
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label={personalizedMessage}
        >
          {/* Ambient background glow */}
          {!reduceMotion && (
            <>
              <motion.div
                aria-hidden="true"
                className="
                  pointer-events-none
                  absolute left-1/2 top-1/2
                  h-72 w-72
                  -translate-x-1/2
                  -translate-y-1/2
                  rounded-full
                  bg-amber-400/10
                  blur-3xl
                "
                animate={{
                  scale: [1, 1.12, 1],
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                  duration: 3.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />

              <motion.div
                aria-hidden="true"
                className="
                  pointer-events-none
                  absolute
                  h-40 w-40
                  rounded-full
                  bg-emerald-400/5
                  blur-3xl
                "
                animate={{
                  x: [-40, 40, -40],
                  y: [20, -20, 20],
                }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </>
          )}

          {/* Main card */}
          <motion.div
            initial={
              reduceMotion
                ? false
                : {
                    opacity: 0,
                    y: 18,
                    scale: 0.94,
                  }
            }
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={
              reduceMotion
                ? undefined
                : {
                    opacity: 0,
                    y: 10,
                    scale: 0.97,
                  }
            }
            transition={{
              duration: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
              relative
              w-full max-w-md
              overflow-hidden
              rounded-[30px]
              border border-amber-200/80
              bg-[#fffaf2]
              p-7
              text-center
              shadow-[0_30px_100px_rgba(0,0,0,0.45)]
              sm:p-8
              dark:border-amber-900/80
              dark:bg-[#1d1a17]
            "
          >
            {/* Decorative top-right ring */}
            <div
              aria-hidden="true"
              className="
                pointer-events-none
                absolute
                -right-16
                -top-16
                h-40
                w-40
                rounded-full
                border-[20px]
                border-amber-300/15
              "
            />

            {/* Decorative bottom-left ring */}
            <div
              aria-hidden="true"
              className="
                pointer-events-none
                absolute
                -bottom-20
                -left-16
                h-40
                w-40
                rounded-full
                border-[20px]
                border-emerald-300/10
              "
            />

            {/* AI Icon */}
            <div className="relative mx-auto mb-5 h-24 w-24">
              {!reduceMotion && (
                <motion.div
                  aria-hidden="true"
                  className="
                    absolute inset-0
                    rounded-[30px]
                    bg-amber-400/20
                  "
                  animate={{
                    scale: [1, 1.12, 1],
                    opacity: [0.4, 0.8, 0.4],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}

              <div
                className="
                  relative
                  flex h-24 w-24
                  items-center justify-center
                  rounded-[30px]
                  bg-slate-950
                  text-amber-300
                  shadow-xl
                  shadow-amber-950/30
                  ring-8
                  ring-amber-300/10
                  dark:bg-amber-100
                  dark:text-slate-950
                "
              >
                <Bot
                  size={36}
                  strokeWidth={1.8}
                  className={
                    reduceMotion
                      ? undefined
                      : "animate-[pulse_2s_ease-in-out_infinite]"
                  }
                />

                {/* Sparkle */}
                <motion.div
                  aria-hidden="true"
                  className="
                    absolute
                    -right-2
                    -top-2
                  "
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          rotate: [0, 15, -10, 0],
                          scale: [1, 1.15, 1],
                        }
                  }
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <div
                    className="
                      flex h-7 w-7
                      items-center justify-center
                      rounded-full
                      bg-amber-100
                      text-amber-600
                      shadow-md
                      dark:bg-amber-950
                      dark:text-amber-300
                    "
                  >
                    <Sparkles size={14} />
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Status badge */}
            <div
              className="
                inline-flex
                items-center
                gap-2
                rounded-full
                border
                border-amber-300/70
                bg-amber-100/70
                px-3.5
                py-1.5
                text-[10px]
                font-black
                uppercase
                tracking-[0.2em]
                text-amber-700
                dark:border-amber-800
                dark:bg-amber-950/60
                dark:text-amber-300
              "
            >
              <span className="relative flex h-2 w-2">
                {!reduceMotion && (
                  <span
                    className="
                      absolute
                      inline-flex
                      h-full
                      w-full
                      animate-ping
                      rounded-full
                      bg-emerald-400
                      opacity-75
                    "
                  />
                )}

                <span
                  className="
                    relative
                    inline-flex
                    h-2
                    w-2
                    rounded-full
                    bg-emerald-500
                  "
                />
              </span>
              Mitra's on it ✨
            </div>

            {/* Frank personalized message */}
            <motion.h2
              key={activeMessage}
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      y: 5,
                    }
              }
              animate={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                duration: 0.25,
              }}
              className="
                mt-4
                text-xl
                font-black
                leading-tight
                tracking-tight
                text-slate-900
                dark:text-amber-50
              "
            >
              {personalizedMessage}
            </motion.h2>

            {/* Detail */}
            <p
              className="
                mx-auto
                mt-2
                max-w-sm
                text-sm
                leading-relaxed
                text-slate-500
                dark:text-amber-100/60
              "
            >
              {displayName}, {detail}
            </p>

            {/* Progress animation */}
            <div
              className="
                mx-auto
                mt-6
                h-2
                w-full
                max-w-[260px]
                overflow-hidden
                rounded-full
                bg-amber-100
                dark:bg-amber-950/70
              "
            >
              <motion.div
                className="
                  h-full
                  w-1/2
                  rounded-full
                  bg-gradient-to-r
                  from-amber-400
                  via-amber-300
                  to-emerald-400
                "
                animate={
                  reduceMotion
                    ? undefined
                    : {
                        x: ["-110%", "210%"],
                      }
                }
                transition={
                  reduceMotion
                    ? undefined
                    : {
                        duration: 1.35,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }
                }
              />
            </div>

            {/* Friendly footer */}
            <div
              className="
                mt-5
                flex
                items-center
                justify-center
                gap-2
                text-[11px]
                font-medium
                text-slate-400
                dark:text-amber-100/40
              "
            >
              {reduceMotion ? (
                <ShieldCheck size={13} />
              ) : (
                <Loader2 size={13} className="animate-spin" />
              )}

              <span>Just hang tight — I've got the rest. 😌</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default MitraLoadingOverlay;
