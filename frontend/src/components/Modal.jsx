import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.15 },
  },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export default function Modal({ isOpen, onClose, title, children, actions }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('keydown', handleKeyDown);

    const alreadyLocked = document.body.style.position === 'fixed';
    const scrollY = alreadyLocked
      ? -parseInt(document.body.style.top || '0', 10)
      : window.scrollY;

    if (!alreadyLocked) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.12 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="game-panel relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto overscroll-contain p-5"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              {title && (
                <h2 className="text-cream text-base font-semibold">
                  {title}
                </h2>
              )}
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-surface-raised transition-colors text-muted hover:text-cream flex-shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="text-cream text-sm">{children}</div>

            {/* Actions */}
            {actions && actions.length > 0 && (
              <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-border">
                {actions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={action.onClick}
                    className={action.className || 'game-btn game-btn-blue'}
                    disabled={action.disabled}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
