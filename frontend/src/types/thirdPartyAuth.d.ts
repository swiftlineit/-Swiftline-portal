// Minimal ambient shapes for the Google Identity Services and reCAPTCHA v3
// scripts loaded via <Script> tags - both attach directly to `window`, and
// neither ships an official @types package for this subset of their API.
export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; width?: string | number; text?: string }
          ) => void;
        };
      };
    };
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}
