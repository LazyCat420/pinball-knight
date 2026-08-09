"use client";

// Legacy shell: mounts Pinball Knight directly. The braindeadbot-client site
// wrapped this in a room/router (src/main.ts); here the dungeon IS the app.
import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    let active = true;
    void (async () => {
      const { launchDungeonGame } = await import("../src/game/pinball-knight");
      if (active) launchDungeonGame(() => {});
    })();
    return () => {
      active = false;
    };
  }, []);
  return <main id="application-container" />;
}
