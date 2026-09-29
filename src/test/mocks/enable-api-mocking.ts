import { worker } from "./browser";

export async function enableApiMocking() {
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
