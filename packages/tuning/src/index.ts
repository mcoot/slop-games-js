import GUI from "lil-gui";

/** [min, max, step] for numbers; `true` for booleans or free-form numbers. */
export type FieldSpec = [number, number, number] | true;

interface Group {
  name: string;
  target: Record<string, unknown>;
  defaults: Record<string, unknown>;
  gui: GUI;
}

type Snapshot = Record<string, Record<string, unknown>>;

/**
 * A live tuning panel over plain settings objects, with named presets, browser
 * persistence and JSON import/export. Everything that affects "feel" should be
 * reachable from here so it can be tuned while playing.
 */
export class TuningPanel {
  readonly gui: GUI;
  private readonly groups: Group[] = [];
  private readonly listeners: (() => void)[] = [];

  constructor(
    title: string,
    private readonly storageKey: string,
  ) {
    this.gui = new GUI({ title });
    this.gui.close();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  addGroup<T extends object>(name: string, target: T, spec: Partial<Record<keyof T & string, FieldSpec>>): GUI {
    const folder = this.gui.addFolder(name);
    const t = target as unknown as Record<string, unknown>;
    for (const [key, s] of Object.entries(spec) as [string, FieldSpec][]) {
      const c = s === true ? folder.add(t, key) : folder.add(t, key, s[0], s[1], s[2]);
      c.onChange(() => this.changed());
    }
    folder.close();
    this.groups.push({ name, target: t, defaults: { ...t }, gui: folder });
    return folder;
  }

  /** Add preset buttons that overwrite one group. */
  addPresets<T extends object>(groupName: string, presets: Record<string, T>): void {
    const group = this.groups.find((g) => g.name === groupName);
    if (!group) throw new Error(`No tuning group ${groupName}`);
    const choice = { preset: Object.keys(presets)[0] ?? "" };
    group.gui
      .add(choice, "preset", Object.keys(presets))
      .name("load preset")
      .onChange((name: string) => {
        Object.assign(group.target, presets[name]);
        this.refresh();
        this.changed();
      });
  }

  /** Add Save / Reset / Export / Import controls. Call after all groups are added. */
  addPersistence(): void {
    const actions = {
      save: () => this.save(),
      reset: () => {
        for (const g of this.groups) Object.assign(g.target, g.defaults);
        this.refresh();
        this.changed();
        try {
          localStorage.removeItem(this.storageKey);
        } catch {
          // storage unavailable
        }
      },
      export: () => {
        const blob = new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${this.storageKey}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      import: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          this.apply(JSON.parse(await file.text()) as Snapshot);
        };
        input.click();
      },
    };
    const f = this.gui.addFolder("Save / load");
    f.add(actions, "save").name("Save in this browser");
    f.add(actions, "reset").name("Reset to defaults");
    f.add(actions, "export").name("Export JSON");
    f.add(actions, "import").name("Import JSON");
  }

  /** Restore anything saved in this browser. */
  load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) this.apply(JSON.parse(raw) as Snapshot);
    } catch {
      // storage unavailable or corrupt: keep defaults
    }
  }

  save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.snapshot()));
    } catch {
      // storage unavailable
    }
  }

  snapshot(): Snapshot {
    const out: Snapshot = {};
    for (const g of this.groups) out[g.name] = { ...g.target };
    return out;
  }

  apply(snapshot: Snapshot): void {
    for (const g of this.groups) {
      const values = snapshot[g.name];
      if (!values) continue;
      for (const key of Object.keys(g.defaults)) {
        if (key in values && typeof values[key] === typeof g.defaults[key]) g.target[key] = values[key];
      }
    }
    this.refresh();
    this.changed();
  }

  private refresh(): void {
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
