import { useEffect, useState } from "react";
import type { ClientSummary } from "@shared/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { messageOf } from "../../lib/errors";

type ConnectClientDialogProps = {
  address: string;
  onClose: () => void;
  /** The address was added to this client. */
  onConnected: (client: ClientSummary) => void;
};

/**
 * Adds one address to a client, so mail to and from it matches that client from
 * now on. Linking a whole conversation is a different action and lives in the
 * reader's menu (LinkClientDialog).
 */
export function ConnectClientDialog({
  address,
  onClose,
  onConnected,
}: ConnectClientDialogProps) {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      window.juno.clients
        .list({ search: search.trim() || undefined, limit: 50 })
        .then((rows) => {
          if (!cancelled) setClients(rows);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(messageOf(cause));
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [search]);

  async function connect(client: ClientSummary) {
    setBusy(true);
    setError(null);
    try {
      await window.juno.clientEmails.create({
        clientId: client.id,
        email: address,
        label: null,
      });
      onConnected(client);
    } catch (cause: unknown) {
      setError(messageOf(cause));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Connect to client" onClose={onClose} width="narrow">
      <p className="mt-4 text-[var(--ink-muted)]">
        Pick the client {address} belongs to. Mail from and to this address will
        match it.
      </p>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search clients"
        aria-label="Search clients"
        className="mt-3 w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
      />
      {error ? (
        <p
          role="alert"
          className="mt-3 text-[length:var(--text-sm)] text-[var(--risk)]"
        >
          {error}
        </p>
      ) : null}
      <ul className="mt-3 max-h-[320px] overflow-y-auto">
        {clients === null ? (
          <li className="px-3 py-2 text-[var(--ink-muted)]">Loading.</li>
        ) : clients.length === 0 ? (
          <li className="px-3 py-2 text-[var(--ink-muted)]">
            No clients match.
          </li>
        ) : (
          clients.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void connect(client)}
                style={{ height: "var(--row-height)" }}
                className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--hover)] disabled:opacity-50"
              >
                <span className="truncate">{client.name}</span>
                {client.city ? (
                  <span className="shrink-0 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
                    {client.city}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
