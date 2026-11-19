import type { DataProvider } from "./types";
import { MAXPREPS, PERFECT_GAME, PREP_BASEBALL } from "./licensed";
import { DEMO_SHOWCASE, DEMO_TEAM_FEED } from "./demo";

export const CSV_IMPORT: DataProvider = {
  id: "csv_import",
  name: "CSV import",
  kind: "import",
  description: "Upload data your program is authorized to use: your own evaluations, camp results, or licensed exports.",
  supportsSync: false,
  status: () => ({ status: "import_only", detail: "Upload a file any time from Settings → Data sources." }),
};

export const PROVIDERS: DataProvider[] = [MAXPREPS, PERFECT_GAME, PREP_BASEBALL, CSV_IMPORT, DEMO_SHOWCASE, DEMO_TEAM_FEED];

export function getProvider(id: string): DataProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
