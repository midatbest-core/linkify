import { useState, useEffect, useRef } from 'react';
import { durationLabel, isDstRelevant, detectCreatorTimeZone } from '../utils/flowDraft.js';

const TIME_ZONES = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter(
  (zone, index, values) => values.indexOf(zone) === index
);

const EMPTY_INITIAL_DATA = Object.freeze({});

export default function EventSettingsModal({
  isOpen,
  isInitial = false,
  initialData = EMPTY_INITIAL_DATA,
  onSave,
  onClose,
}) {
  const [eventName, setEventName] = useState('');
  const [description, setDescription] = useState('');
  const [eventStartLocal, setEventStartLocal] = useState('');
  const [eventEndLocal, setEventEndLocal] = useState('');
  const [creatorTimeZone, setCreatorTimeZone] = useState('UTC');
  const [eventStartDisambiguation, setEventStartDisambiguation] = useState('earlier');
  const [eventEndDisambiguation, setEventEndDisambiguation] = useState('earlier');

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setEventName(initialData?.eventName ?? (isInitial ? '' : 'Untitled Event'));
      setDescription(initialData?.description ?? '');
      setEventStartLocal(initialData?.eventStartLocal ?? '');
      setEventEndLocal(initialData?.eventEndLocal ?? '');
      setCreatorTimeZone(initialData?.creatorTimeZone ?? detectCreatorTimeZone());
      setEventStartDisambiguation(initialData?.eventStartDisambiguation ?? 'earlier');
      setEventEndDisambiguation(initialData?.eventEndDisambiguation ?? 'earlier');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, isInitial]);

  if (!isOpen) return null;

  const dstActive = isDstRelevant(creatorTimeZone, eventStartLocal) || isDstRelevant(creatorTimeZone, eventEndLocal);
  const isValid = eventName.trim().length > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    onSave({
      eventName: eventName.trim(),
      description: description.trim(),
      eventStartLocal,
      eventEndLocal,
      creatorTimeZone,
      eventStartDisambiguation,
      eventEndDisambiguation,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-settings-title"
    >
      <div className="panel max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <p className="eyebrow">{isInitial ? 'NEW EVENT FLOW' : 'EVENT SETTINGS'}</p>
            <h2 id="event-settings-title" className="mt-1 text-2xl font-semibold tracking-tight text-ink">
              {isInitial ? 'Set up event schedule' : 'Edit event configuration'}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {isInitial
                ? 'Configure your event details once. You can update these anytime from Event Settings.'
                : 'Update the global schedule, event name, description, and timezone for this Flow.'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-muted hover:bg-canvas-subtle hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="event-name-input" className="block text-xs font-semibold text-ink">
              Event name <span className="text-danger">*</span>
            </label>
            <input
              id="event-name-input"
              data-testid="event-name-input"
              type="text"
              className="field-control mt-1 w-full"
              placeholder="e.g. Annual Developer Summit 2026"
              value={eventName}
              maxLength={120}
              required
              autoFocus={isInitial}
              onChange={(e) => setEventName(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">A clear name to identify this event campaign.</p>
          </div>

          <div>
            <label htmlFor="event-description-input" className="block text-xs font-semibold text-ink">
              Description <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="event-description-input"
              data-testid="event-description-input"
              className="field-control mt-1 min-h-20 w-full py-2"
              placeholder="Brief summary of the event, venue, or audience context..."
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="event-start-input" className="block text-xs font-semibold text-ink">
                Event start date & time
              </label>
              <input
                id="event-start-input"
                data-testid="event-start-input"
                type="datetime-local"
                className="field-control mt-1 w-full"
                value={eventStartLocal}
                onChange={(e) => setEventStartLocal(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="event-end-input" className="block text-xs font-semibold text-ink">
                Event end date & time
              </label>
              <input
                id="event-end-input"
                data-testid="event-end-input"
                type="datetime-local"
                className="field-control mt-1 w-full"
                value={eventEndLocal}
                onChange={(e) => setEventEndLocal(e.target.value)}
              />
            </div>
          </div>

          {(eventStartLocal || eventEndLocal) && (
            <div className="rounded-xl bg-brand-soft p-3 text-xs">
              <span className="font-semibold text-ink">Duration: </span>
              <span className="font-medium text-brand-strong">{durationLabel(eventStartLocal, eventEndLocal)}</span>
              <p className="mt-0.5 text-[11px] text-muted">
                Visitors before start route to Before phase; during event to Live phase; after end to Post phase.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="event-timezone-select" className="block text-xs font-semibold text-ink">
              Event timezone
            </label>
            <select
              id="event-timezone-select"
              data-testid="event-timezone-select"
              className="field-control mt-1 w-full"
              value={creatorTimeZone}
              onChange={(e) => setCreatorTimeZone(e.target.value)}
            >
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              All schedule dates and phase transitions are computed according to this timezone.
            </p>
          </div>

          {dstActive && (
            <div className="rounded-xl border border-line bg-canvas-subtle p-3.5">
              <label htmlFor="event-dst-select" className="block text-xs font-semibold text-ink">
                Daylight Saving Time (DST) Ambiguity Choice
              </label>
              <select
                id="event-dst-select"
                data-testid="event-dst-select"
                className="field-control mt-1 w-full"
                value={eventStartDisambiguation}
                onChange={(e) => {
                  setEventStartDisambiguation(e.target.value);
                  setEventEndDisambiguation(e.target.value);
                }}
              >
                <option value="earlier">Earlier occurrence (standard default)</option>
                <option value="later">Later occurrence</option>
              </select>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                Shown because {creatorTimeZone} observes Daylight Saving Time transitions during your scheduled dates. Used if clocks move backward during an event instant.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            <button type="button" className="button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button-primary"
              disabled={!isValid}
              data-testid="event-settings-save-button"
            >
              {isInitial ? 'Continue to Flow Builder →' : 'Save Event Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
