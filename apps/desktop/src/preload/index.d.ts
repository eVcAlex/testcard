import type { TestcardApi } from "../shared/ipc";

declare global {
  interface Window {
    readonly testcard: TestcardApi;
  }
}
