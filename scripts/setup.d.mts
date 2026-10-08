// Kiểu cho phần thuần của scripts/setup.mjs (test/setup-script.test.ts import).
export declare const USAGE: string;
export declare const EXIT: { error: 1; usage: 2; notLoggedIn: 3; chooseAccount: 4; noSubdomain: 5; needInput: 6 };
export type SetupOptions = {
  accountId: string | null;
  name: string | null;
  config: string;
  generatePassword: boolean;
  resetPassword: boolean;
  yes: boolean;
  help: boolean;
};
export declare function parseArgs(argv: string[], env?: Record<string, string | undefined>): SetupOptions;
export declare function generatePassword(random?: (max: number) => number): string;
export declare function readConfigString(text: string, key: string): string | null;
export declare function setConfigString(text: string, key: string, value: string): string;
export declare function setDatabaseName(text: string, value: string): string;
