import { useMemo, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import {
  formatTimeZoneOffsetLabel,
  supportedTimeZones,
  type TimeZone,
} from "@sapporta/shared/temporal";
import { buttonVariants } from "@sapporta/ui/button";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";

export interface WorkspaceTimeZonePickerProps {
  /** The zone in force, which the button names and the list marks. */
  value: TimeZone;
  /** Called with the chosen IANA id. Storing it is the caller's job. */
  onSelect: (zone: string) => void;
  disabled?: boolean;
}

/**
 * The control a workspace's calendar is chosen from.
 *
 * A grid cell says `2026-08-23 16:38` and nothing about which wall clock that
 * is on, and repeating the zone in five hundred cells would cost the density
 * the format was chosen for. So it is said once, here, next to the control
 * that changes it, and again on any report whose numbers depend on it.
 *
 * The button names the zone by its id and its offset, `Asia/Kolkata
 * UTC+05:30`; see `formatTimeZoneOffsetLabel` for why an offset rather than an
 * abbreviation.
 *
 * There is no "Automatic" option. A workspace keeps a calendar rather than
 * following whichever device is looking at it, which is the whole point of
 * storing the zone on the workspace: two colleagues in two countries read one
 * dashboard and see the same day.
 */
export function WorkspaceTimeZonePicker({
  value,
  onSelect,
  disabled = false,
}: WorkspaceTimeZonePickerProps) {
  const [open, setOpen] = useState(false);
  // `UTC` is its own offset, and a button reading "UTC UTC" says nothing the
  // first word did not.
  const offset = formatTimeZoneOffsetLabel(value);

  function choose(zone: string) {
    setOpen(false);
    onSelect(zone);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "max-w-full justify-between gap-3 border-sap-border bg-sap-surface font-normal text-sap-fg",
            )}
            title={`This workspace keeps its calendar in ${value}.`}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <Globe className="shrink-0 text-sap-subtle" strokeWidth={1.7} />
          <span className="truncate">{value}</span>
          {offset !== value && (
            <span className="shrink-0 text-sap-muted">{offset}</span>
          )}
        </span>
        <ChevronDown className="shrink-0 text-sap-subtle" strokeWidth={1.7} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[320px] p-[8px] text-sap-body text-sap-fg"
      >
        <div className="flex flex-col gap-[6px]">
          <ZoneChoice
            label="UTC"
            detail="the zone the values are stored in"
            selected={value === "UTC"}
            onSelect={() => choose("UTC")}
          />
          {open && <ZoneSearch value={value} onSelect={choose} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ZoneChoice({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex items-center gap-2 rounded-[4px] px-[8px] py-[5px] text-left hover:bg-sap-row-hover"
    >
      <span className="font-medium text-sap-fg">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sap-data text-sap-muted">
        {detail}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
    </button>
  );
}

function ZoneSearch({
  value,
  onSelect,
}: {
  value: TimeZone;
  onSelect: (zone: string) => void;
}) {
  // Checking and labelling four hundred zones costs about 30ms, so it is done
  // on the first open of this popover rather than while the application is
  // starting, and kept for the rest of the session.
  const zones = useMemo(() => zoneOptions(), []);

  return (
    <Combobox.Root<ZoneOption>
      items={zones}
      value={zones.find((zone) => zone.id === value) ?? null}
      onValueChange={(picked) => {
        if (picked) onSelect(picked.id);
      }}
      itemToStringValue={(zone) => zone.id}
      itemToStringLabel={(zone) => zone.id}
      filter={(zone, query) => {
        const needle = query.trim().toLocaleLowerCase();
        if (needle === "") return true;
        return zone.search.includes(needle);
      }}
      inline
      open
    >
      <Combobox.Input
        placeholder="Search zones…"
        className={cn(
          comboboxClassNames.input,
          "h-sap-ctl w-full rounded-[4px] border border-sap-border px-[8px]",
        )}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.stopPropagation();
        }}
      />
      <div className="max-h-[220px] overflow-y-auto rounded-[4px] border border-sap-border bg-sap-surface">
        <Combobox.Empty className={comboboxClassNames.empty}>
          No matching zone
        </Combobox.Empty>
        <Combobox.List className="p-[2px]">
          {(zone: ZoneOption) => (
            <Combobox.Item
              key={zone.id}
              value={zone}
              className="flex w-full items-center gap-2 rounded-[4px] px-[8px] py-[4px] outline-none data-highlighted:bg-sap-row-hover"
            >
              <span className="min-w-0 flex-1 truncate text-sap-fg">
                {zone.id}
              </span>
              <span className="shrink-0 text-sap-data text-sap-muted">
                {zone.label}
              </span>
              <Combobox.ItemIndicator className="shrink-0 text-sap-muted">
                <Check className="h-4 w-4" aria-hidden />
              </Combobox.ItemIndicator>
            </Combobox.Item>
          )}
        </Combobox.List>
      </div>
    </Combobox.Root>
  );
}

/**
 * `search` holds the zone's id and its offset, lowercased once so filtering
 * four hundred rows on every keystroke does not redo the work.
 */
type ZoneOption = { id: TimeZone; label: string; search: string };

let cachedZoneOptions: ZoneOption[] | null = null;

function zoneOptions(): ZoneOption[] {
  cachedZoneOptions ??= supportedTimeZones().map((id) => {
    const label = formatTimeZoneOffsetLabel(id);
    return {
      id,
      label,
      search: `${id} ${label}`.toLocaleLowerCase(),
    };
  });
  return cachedZoneOptions;
}
