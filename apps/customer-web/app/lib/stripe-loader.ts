const STRIPE_SCRIPT_URL = "https://js.stripe.com/v3/";
const STRIPE_LOAD_TIMEOUT_MS = 10_000;

let stripeLoadPromise: Promise<void> | null = null;

function stripeIsReady() {
  return typeof (window as unknown as { Stripe?: unknown }).Stripe === "function";
}

export function loadStripeScript(): Promise<void> {
  if (stripeIsReady()) return Promise.resolve();
  if (stripeLoadPromise) return stripeLoadPromise;

  const pending = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${STRIPE_SCRIPT_URL}"]`,
    );
    const created = !script;
    script ??= document.createElement("script");

    const cleanup = () => {
      window.clearTimeout(timeout);
      script?.removeEventListener("load", loaded);
      script?.removeEventListener("error", failed);
    };
    const fail = () => {
      cleanup();
      script?.remove();
      reject(new Error("Stripe could not load."));
    };
    const loaded = () => {
      cleanup();
      if (stripeIsReady()) resolve();
      else fail();
    };
    const failed = () => fail();
    const timeout = window.setTimeout(fail, STRIPE_LOAD_TIMEOUT_MS);

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (created) {
      script.src = STRIPE_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    } else {
      queueMicrotask(() => {
        if (stripeIsReady()) loaded();
      });
    }
  });

  stripeLoadPromise = pending.catch((error) => {
    stripeLoadPromise = null;
    throw error;
  });
  return stripeLoadPromise;
}
