import { useEffect, useRef, useState } from "react";
import type {
  Client,
  ClientSummary,
  MailAddress,
  MailMessageClient,
} from "@shared/types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { messageOf } from "../../lib/errors";
import { requestOpenClient } from "../../lib/open-client";
import { ConnectClientDialog } from "./ConnectClientDialog";
import { displayName } from "./format";

type PersonChipProps = {
  person: MailAddress;
  /** Shown instead of the name, for the short "To" line. */
  label?: string;
  /** Lower-case addresses that are the owner's or an account's. Those are not clickable. */
  mine: ReadonlySet<string>;
  /** Present only for the sender: the trust switch and what it is currently set to. */
  trust?: {
    trusted: boolean;
    /** A linked client already makes the sender trusted, and that is not undone here. */
    viaClient: boolean;
    onChange: (trusted: boolean) => void;
  };
  onNotice: (message: string) => void;
  /** The address was just added to a client. */
  onConnected: (client: ClientSummary) => void;
};

type Lookup =
  | { status: "loading" }
  | { status: "ready"; match: MailMessageClient | null; client: Client | null }
  | { status: "error"; message: string };

/**
 * A name in the header that opens a small card: which client the address
 * belongs to, with a way to connect one, and for the sender the trust switch.
 * The owner's own addresses render as plain text, since there is nothing to
 * decide about them.
 */
export function PersonChip({
  person,
  label,
  mine,
  trust,
  onNotice,
  onConnected,
}: PersonChipProps) {
  const address = person.address.toLowerCase();
  const text = label ?? displayName(person);
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const isMine = mine.has(address);

  useEffect(() => {
    if (!open || isMine) return;
    let cancelled = false;
    window.juno.mail.recipients
      .clientsFor([person.address])
      .then(async (matches) => {
        const match = matches[0] ?? null;
        const client = match
          ? await window.juno.clients.get(match.clientId)
          : null;
        if (!cancelled) setLookup({ status: "ready", match, client });
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLookup({ status: "error", message: messageOf(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, isMine, person.address, version]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (connecting) return;
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !connecting) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, connecting]);

  if (isMine) return <span className="text-[var(--ink)]">{text}</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(person.address);
      onNotice("Address copied.");
    } catch {
      onNotice("Could not copy the address.");
    }
  }

  return (
    <span ref={root} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setLookup({ status: "loading" });
          setOpen((current) => !current);
        }}
        className={`rounded-[var(--radius-sm)] px-1 text-[var(--ink)] hover:bg-[var(--sunken)] ${open ? "bg-[var(--sunken)]" : ""}`}
      >
        {text}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`About ${displayName(person)}`}
          className="absolute left-0 top-full z-20 mt-1 w-[300px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 text-[length:var(--text-dense)] text-[var(--ink)] shadow-[var(--shadow-popover)]"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-[var(--weight-medium)]">
                {displayName(person)}
              </p>
              {person.name?.trim() ? (
                <p
                  data-selectable
                  className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]"
                >
                  {person.address}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Copy address"
              title="Copy address"
              onClick={() => void copy()}
              className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            >
              <Icon name="copy" size={14} />
            </button>
          </div>

          <div className="mt-2 border-t border-[var(--line)] pt-2">
            {lookup.status === "loading" ? (
              <p className="text-[var(--ink-muted)]">Loading.</p>
            ) : lookup.status === "error" ? (
              <p role="alert" className="text-[var(--risk)]">
                {lookup.message}
              </p>
            ) : lookup.match ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[length:var(--text-micro)] uppercase tracking-[0.06em] text-[var(--ink-muted)]">
                    Client
                  </p>
                  <p className="truncate font-[var(--weight-medium)]">
                    {lookup.match.clientName}
                  </p>
                  {lookup.client?.vatNumber ? (
                    <p className="tabular truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
                      {lookup.client.vatNumber}
                    </p>
                  ) : null}
                  {lookup.client?.website ? (
                    <p className="truncate text-[length:var(--text-sm)] text-[var(--ink-muted)]">
                      {lookup.client.website}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Open ${lookup.match.clientName}`}
                  title="Open client"
                  onClick={() => {
                    if (lookup.match)
                      requestOpenClient(
                        lookup.match.clientId,
                        lookup.match.clientName,
                      );
                  }}
                  className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                >
                  <Icon name="external" size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[var(--ink-muted)]">
                  Not connected to a client.
                </p>
                <Button size="dense" onClick={() => setConnecting(true)}>
                  Connect client
                </Button>
              </div>
            )}
          </div>

          {trust ? (
            <div className="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-2">
              <span className="min-w-0 flex-1">
                <span className="block">Trust sender</span>
                <span className="block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
                  {trust.viaClient
                    ? "Trusted because a client is linked."
                    : trust.trusted
                      ? "Content and links are shown."
                      : "Content and links stay blocked."}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={trust.trusted}
                aria-label="Trust sender"
                disabled={trust.viaClient}
                onClick={() => trust.onChange(!trust.trusted)}
                className={[
                  "relative h-[20px] w-[36px] shrink-0 rounded-[var(--radius-full)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] disabled:opacity-50",
                  trust.trusted
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--line-strong)]",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-[2px] h-[16px] w-[16px] rounded-[var(--radius-full)] bg-[var(--surface)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease)]",
                    trust.trusted ? "translate-x-[18px]" : "translate-x-[2px]",
                  ].join(" ")}
                />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {connecting ? (
        <ConnectClientDialog
          address={person.address}
          onClose={() => setConnecting(false)}
          onConnected={(client) => {
            setConnecting(false);
            setLookup({ status: "loading" });
            setVersion((current) => current + 1);
            onConnected(client);
          }}
        />
      ) : null}
    </span>
  );
}
