import { type ReactNode, useEffect, useId } from 'react';

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ open, title, description, onClose, children }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <dialog
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        className="modal-panel"
        open
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Options</p>
            <h3 id={titleId}>{title}</h3>
            {description ? (
              <p className="muted" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>

          <button className="button button-secondary" onClick={onClose} type="button">
            Close
          </button>
        </div>

        {children}
      </dialog>
    </div>
  );
}
