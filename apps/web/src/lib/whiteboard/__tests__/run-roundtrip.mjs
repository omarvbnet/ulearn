import { runUbrdRoundTripSmoke } from "../__tests__/roundtrip";

runUbrdRoundTripSmoke().then((r) => {
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
});
